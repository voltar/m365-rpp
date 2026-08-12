import type { Logger } from "../core/logging";
import { getRuntimeConfiguration } from "../infrastructure/deployment/runtimeConfig";
import {
  createMicrosoft365ClientFoundation,
  type Microsoft365ClientFoundation
} from "../infrastructure/microsoft365";
import { resolveActiveTeamId } from "../infrastructure/microsoft365/currentUser";
import type { DayHalf } from "../models/absence";
import type {
  ApprovalProvider,
  PowerAutomateApprovalInput,
  PowerAutomateApprovalOutput,
  VacationRequest,
  VacationRequestStatus
} from "../models/approval";
import type {
  IApprovalIntegrationRepository,
  IVacationRequestRepository,
  VacationRequestQuery
} from "./approvalRepositories";
import type { RepositoryErrorCode, RepositoryResult } from "./planningRepositories";
import { resilientFetch } from "../infrastructure/http/resilientFetch";

/**
 * EO-410: vacation request persistence and Microsoft 365 approval start via the
 * RPP Web API. The Power Automate flow URL stays server-side; the SPA only talks
 * to the API with its Teams SSO bearer token (same pattern as ApiPlanningRepositories).
 */

interface ApiVacationRequestDto {
  readonly id: string;
  readonly employeeId: string;
  readonly type: string;
  readonly startDate: string;
  readonly startHalf: string;
  readonly endDate: string;
  readonly endHalf: string;
  readonly duration: number;
  readonly status: string;
  readonly approverId?: string;
  readonly approvalReferenceId?: string;
  readonly syncToOutlook: boolean;
  readonly comment?: string;
  readonly created: string;
  readonly modified: string;
  readonly teamId: string;
  readonly userDisplayName: string;
  readonly commentToApprover?: string;
  readonly approvalProvider: string;
  readonly graphEventId?: string;
  readonly outlookSyncStatus?: string;
  readonly outlookSyncError?: string;
}

interface ApiListResponse<T> {
  readonly items: readonly T[];
}

class ApiApprovalClient {
  private readonly baseUrl: string;
  private foundation?: Microsoft365ClientFoundation;

  constructor(baseUrl: string, private readonly logger?: Logger) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async fetchJson<T>(path: string, init?: RequestInit): Promise<RepositoryResult<T>> {
    try {
      const token = await this.getApiToken();
      const activeTeamId = await resolveActiveTeamId(this.logger);
      const headers: Record<string, string> = {
        Accept: "application/json",
        // Drive localized approval title/description (dates, day halves) on the API.
        "Accept-Language": resolveApprovalAcceptLanguage(),
        ...(init?.body ? { "Content-Type": "application/json" } : {})
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      if (activeTeamId) {
        headers["X-RPP-Active-TeamId"] = activeTeamId;
      }

      const response = await resilientFetch(
        `${this.baseUrl}${path}`,
        { ...init, headers, credentials: "include" },
        {
          component: "ApiApprovalRepositories",
          operation: init?.method?.toLowerCase() ?? "get",
          logger: this.logger
        }
      );

      if (!response.ok) {
        // Prefer the machine-readable body code from the API (approverRequired,
        // approvalFlowStartFailed, …) so the Timeline does not show a bare "(unknown)".
        const bodyCode = await readApprovalErrorCode(response);
        const code: RepositoryErrorCode =
          bodyCode === "approverRequired" || bodyCode === "approvalFlowNotConfigured" || bodyCode === "requestIdMismatch"
            ? "validation"
            : bodyCode === "approvalFlowStartFailed"
              || bodyCode === "membershipLookupFailed"
              || bodyCode === "vacationRequestSaveFailed"
              || bodyCode === "approvalPersistFailed"
              ? "unknown"
            : response.status === 404 ? "notFound"
            : response.status === 401 || response.status === 403 ? "forbidden"
            : response.status === 400 || response.status === 503 ? "validation"
            : "unknown";

        return {
          ok: false,
          error: {
            code,
            message: bodyCode ? `${bodyCode} (HTTP ${response.status})` : `HTTP ${response.status}`,
            recoverable: response.status === 429 || response.status >= 500,
            details: bodyCode ? { apiCode: bodyCode } : undefined
          }
        };
      }

      if (response.status === 204) {
        return { ok: true, value: undefined as T };
      }

      return { ok: true, value: (await response.json()) as T };
    } catch (error: unknown) {
      this.logger?.error("Approval API call failed.", {
        source: "repository",
        component: "ApiApprovalRepositories",
        operation: "fetchJson",
        details: { path, error }
      }, error);

      return {
        ok: false,
        error: {
          code: "network",
          message: error instanceof Error ? error.message : "Network error",
          recoverable: true
        }
      };
    }
  }

  private async getApiToken(): Promise<string | undefined> {
    try {
      const { apiAccessTokenScopes } = getRuntimeConfiguration(this.logger);

      if (apiAccessTokenScopes.length === 0) {
        return undefined;
      }

      this.foundation ??= createMicrosoft365ClientFoundation({}, this.logger);
      const tokenResult = await this.foundation.authProvider.getAccessToken({ scopes: apiAccessTokenScopes });

      return tokenResult.ok ? tokenResult.value.token : undefined;
    } catch {
      return undefined;
    }
  }
}

export function createApiVacationRequestRepository(baseUrl: string, logger?: Logger): IVacationRequestRepository {
  const client = new ApiApprovalClient(baseUrl, logger);

  return {
    async listVacationRequests(query?: VacationRequestQuery) {
      const parameters = new URLSearchParams();

      if (query?.requestId) parameters.set("requestId", query.requestId);
      if (query?.userId) parameters.set("userId", query.userId);
      if (query?.teamId) parameters.set("teamId", query.teamId);
      if (query?.status) parameters.set("status", query.status);

      const suffix = parameters.size > 0 ? `?${parameters.toString()}` : "";
      const result = await client.fetchJson<ApiListResponse<ApiVacationRequestDto>>(`/api/planning/vacationrequests${suffix}`);

      if (!result.ok) {
        return result;
      }

      return {
        ok: true,
        value: { items: result.value.items.map(toVacationRequest) }
      };
    },

    async saveVacationRequest(request: VacationRequest) {
      const result = await client.fetchJson<ApiVacationRequestDto>("/api/planning/vacationrequests", {
        method: "POST",
        body: JSON.stringify(toApiVacationRequest(request))
      });

      return result.ok ? { ok: true, value: toVacationRequest(result.value) } : result;
    },

    async deleteVacationRequest(requestId: string) {
      return client.fetchJson<void>(`/api/planning/vacationrequests/${encodeURIComponent(requestId)}`, { method: "DELETE" });
    }
  };
}

export function createApiApprovalIntegrationRepository(baseUrl: string, logger?: Logger): IApprovalIntegrationRepository {
  const client = new ApiApprovalClient(baseUrl, logger);

  return {
    async startApprovalFlow(input: PowerAutomateApprovalInput) {
      const result = await client.fetchJson<PowerAutomateApprovalOutput>(
        `/api/planning/vacationrequests/${encodeURIComponent(input.requestId)}/start-approval`,
        { method: "POST", body: JSON.stringify(input) }
      );

      return result;
    }
  };
}

function toVacationRequest(dto: ApiVacationRequestDto): VacationRequest {
  return {
    id: dto.id,
    teamId: dto.teamId,
    userId: dto.employeeId,
    absenceType: dto.type,
    startDate: toIsoDate(dto.startDate),
    startHalf: dto.startHalf as DayHalf,
    endDate: toIsoDate(dto.endDate),
    endHalf: dto.endHalf as DayHalf,
    comment: dto.comment ?? undefined,
    approvalRequired: dto.approvalProvider === "microsoftApprovals",
    approverUserId: dto.approverId ?? undefined,
    status: dto.status as VacationRequestStatus,
    approvalProvider: (dto.approvalProvider || "none") as ApprovalProvider,
    approvalReferenceId: dto.approvalReferenceId ?? undefined,
    syncToOutlook: dto.syncToOutlook,
    outlookSync: {
      enabled: dto.syncToOutlook,
      graphEventId: dto.graphEventId ?? undefined,
      syncStatus: toOutlookSyncStatus(dto.outlookSyncStatus),
      lastError: dto.outlookSyncError ?? undefined
    },
    createdAt: dto.created,
    createdBy: dto.employeeId,
    modifiedAt: dto.modified,
    modifiedBy: dto.employeeId
  };
}

function toApiVacationRequest(request: VacationRequest): Omit<ApiVacationRequestDto, "created" | "modified" | "duration"> & { duration: number } {
  return {
    id: request.id,
    employeeId: request.userId,
    type: request.absenceType,
    startDate: request.startDate,
    startHalf: request.startHalf,
    endDate: request.endDate,
    endHalf: request.endHalf,
    duration: 0,
    status: request.status,
    approverId: request.approverUserId,
    approvalReferenceId: request.approvalReferenceId,
    syncToOutlook: request.syncToOutlook,
    comment: request.comment,
    teamId: request.teamId,
    // EO-430: `modifiedBy` is a user id, not a name — sending it here wrote a GUID into a field
    // the approver-facing text reads from. The save path does not know the display name; the
    // approval path supplies it from `requesterDisplayName` when the approval starts, and
    // FR-430.5 removes the persisted field entirely.
    userDisplayName: "",
    approvalProvider: request.approvalProvider
  };
}

function toIsoDate(value: string): string {
  return value.length > 10 ? value.slice(0, 10) : value;
}

function toOutlookSyncStatus(value: string | undefined): VacationRequest["outlookSync"]["syncStatus"] {
  return value === "pending" || value === "synced" || value === "failed" ? value : "notRequired";
}

async function readApprovalErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return typeof body?.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/** Prefer the SPA UI language so Approvals cards match what the requester sees. */
function resolveApprovalAcceptLanguage(): string {
  if (typeof document !== "undefined") {
    const htmlLang = document.documentElement.lang?.trim();
    if (htmlLang) {
      return htmlLang;
    }
  }

  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }

  return "de-CH";
}
