import type { Logger } from "../core/logging";
import { getRuntimeConfiguration } from "../infrastructure/deployment/runtimeConfig";
import {
  createMicrosoft365ClientFoundation,
  type Microsoft365ClientFoundation
} from "../infrastructure/microsoft365";
import { resolveActiveTeamId } from "../infrastructure/microsoft365/currentUser";
import { resilientFetch } from "../infrastructure/http/resilientFetch";
import type { Absence } from "../models/absence";
import type { PublicHoliday } from "../models/capacity";
import type { PlanningSettings, VacationBalanceRecord, TeamPlanningConfiguration } from "../models/planningSettings";
import type { TeamMembership } from "../models/identity";
import type { PlanningEvent } from "../models/planningEvent";
import type {
  AbsenceQuery,
  PlanningEventQuery,
  PlanningRepositories,
  RepositoryError,
  RepositoryPage,
  RepositoryResult,
  RepositoryPageRequest,
  TeamMembershipQuery,
  VacationBalanceQuery
} from "./planningRepositories";

/**
 * Real API-based repository for planningDataSource = "api".
 */
export class ApiPlanningRepositories implements PlanningRepositories {
  private readonly baseUrl: string;
  private readonly logger?: Logger;
  private foundation?: Microsoft365ClientFoundation;

  constructor(baseUrl: string, logger?: Logger) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.logger = logger;
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<RepositoryResult<T>> {
    try {
      // EO-405: acquire token for the API audience and attach Bearer token (Teams SSO / Entra ID)
      const authResult = await this.getApiToken();
      const activeTeamId = await resolveActiveTeamId(this.logger);
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {})
      };
      if (authResult.ok && authResult.value.token) {
        headers.Authorization = `Bearer ${authResult.value.token}`;
      }
      if (activeTeamId) {
        headers["X-RPP-Active-TeamId"] = activeTeamId;
      }

      const response = await resilientFetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        credentials: "include"
      }, {
        component: "ApiPlanningRepositories",
        operation: init?.method?.toLowerCase() ?? "get",
        logger: this.logger
      });

      if (!response.ok) {
        // EO-428: the API answers 428 for "no team context could be resolved". Read the body code
        // rather than inferring from the status alone, so the distinction survives any proxy that
        // rewrites an unusual status.
        const bodyCode = await readErrorCode(response);
        const errorCode: RepositoryError["code"] =
          bodyCode === "noTeamContext" || response.status === 428 ? "noTeamContext"
          : bodyCode === "absenceSaveFailed" || bodyCode === "vacationRequestSaveFailed" || bodyCode === "approvalPersistFailed"
            ? "unknown"
          : response.status === 404 ? "notFound"
          // 401 and 403 used to collapse into "forbidden". They are different situations: 401 means
          // no token reached the API at all — typically an ungranted Teams SSO consent, which the
          // user resolves themselves — while 403 means the identity is known and refused.
          : response.status === 401 ? "unauthenticated"
          : response.status === 403 || bodyCode === "forbidden" ? "forbidden"
          : "unknown";

        return {
          ok: false,
          error: {
            code: errorCode,
            message: bodyCode ? `${bodyCode} (HTTP ${response.status})` : `HTTP ${response.status}`,
            details: bodyCode ? { apiCode: bodyCode } : undefined,
            // A missing team context is fixed by choosing a team, so the UI offers that rather
            // than a dead end.
            recoverable:
              response.status === 429 ||
              response.status >= 500 ||
              response.status === 404 ||
              errorCode === "noTeamContext"
          }
        };
      }

      if (response.status === 204) {
        return { ok: true, value: undefined as T };
      }

      const data = await response.json();
      return { ok: true, value: data as T };
    } catch (error) {
      this.logger?.error("API call failed", {
        source: "repository",
        component: "ApiPlanningRepositories",
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

  /**
   * EO-459: team-scoped list queries send teamId (query) in addition to X-RPP-Active-TeamId (header).
   */
  private async buildTeamScopedQueryString(
    request?: RepositoryPageRequest & { readonly teamId?: string },
    extra?: Readonly<Record<string, string | undefined>>
  ): Promise<string> {
    const resolvedTeamId = request?.teamId ?? (await resolveActiveTeamId(this.logger));
    const queryParts: string[] = [];

    if (request?.pageToken) {
      queryParts.push(`pageToken=${encodeURIComponent(request.pageToken)}`);
    }

    if (resolvedTeamId) {
      queryParts.push(`teamId=${encodeURIComponent(resolvedTeamId)}`);
    }

    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        if (value !== undefined && value !== "") {
          queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
      }
    }

    return queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
  }

  private async getApiToken() {
    // EO-405: Inside Microsoft Teams the SSO token (audience = the RPP API app registration)
    // is attached as a Bearer token. Outside Teams (plain browser during development) SSO is
    // unavailable; requests continue unauthenticated and rely on the server-side
    // ApiSettings:RequireAuthentication=false development bypass.
    try {
      const { apiAccessTokenScopes } = getRuntimeConfiguration(this.logger);

      if (apiAccessTokenScopes.length === 0) {
        this.logger?.warn("No API access token scopes are configured. API requests continue unauthenticated.", {
          source: "repository",
          component: "ApiPlanningRepositories",
          operation: "getApiToken"
        });
        return { ok: false } as const;
      }

      this.foundation ??= createMicrosoft365ClientFoundation({}, this.logger);

      const tokenResult = await this.foundation.authProvider.getAccessToken({
        scopes: apiAccessTokenScopes
      });

      if (tokenResult.ok && tokenResult.value.token) {
        return { ok: true, value: { token: tokenResult.value.token } } as const;
      }

      this.logger?.debug("No Teams SSO token available - continuing unauthenticated (development only).", {
        source: "repository",
        component: "ApiPlanningRepositories",
        operation: "getApiToken"
      });
      return { ok: false } as const;
    } catch {
      this.logger?.warn("API token acquisition failed - continuing unauthenticated.", {
        source: "repository",
        component: "ApiPlanningRepositories",
        operation: "getApiToken"
      });
      return { ok: false } as const;
    }
  }

  readonly teamMemberships = {
    listMemberships: async (request?: TeamMembershipQuery): Promise<RepositoryResult<RepositoryPage<TeamMembership>>> => {
      const resolvedTeamId = request?.teamId ?? await resolveActiveTeamId(this.logger);
      const queryParts: string[] = [];

      if (request?.pageToken) {
        queryParts.push(`pageToken=${encodeURIComponent(request.pageToken)}`);
      }

      if (resolvedTeamId) {
        queryParts.push(`teamId=${encodeURIComponent(resolvedTeamId)}`);
      }

      const qs = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
      return this.fetchJson<RepositoryPage<TeamMembership>>(`/api/planning/memberships${qs}`);
    }
  };

  readonly absences = {
    listAbsences: async (request?: AbsenceQuery): Promise<RepositoryResult<RepositoryPage<Absence>>> => {
      const qs = await this.buildTeamScopedQueryString(request);
      const result = await this.fetchJson<RepositoryPage<Absence>>(`/api/planning/absences${qs}`);

      if (!result.ok) {
        return result;
      }

      return { ok: true, value: { ...result.value, items: result.value.items.map(normalizeApiAbsence) } };
    },

    saveAbsence: async (absence: Absence): Promise<RepositoryResult<Absence>> => {
      const result = await this.fetchJson<Absence>("/api/planning/absences", {
        method: "POST",
        body: JSON.stringify(absence)
      });

      return result.ok ? { ok: true, value: normalizeApiAbsence(result.value) } : result;
    },

    deleteAbsence: async (id: string): Promise<RepositoryResult<void>> => {
      return this.fetchJson<void>(`/api/planning/absences/${encodeURIComponent(id)}`, { method: "DELETE" });
    }
  };

  readonly vacationBalances = {
    listVacationBalances: async (
      request?: VacationBalanceQuery
    ): Promise<RepositoryResult<RepositoryPage<VacationBalanceRecord>>> => {
      const qs = await this.buildTeamScopedQueryString(request, {
        year: request?.year !== undefined ? String(request.year) : undefined,
        userId: request?.userId
      });
      return this.fetchJson<RepositoryPage<VacationBalanceRecord>>(`/api/planning/vacationbalances${qs}`);
    }
  };

  readonly holidays = {
    listPublicHolidays: async (request?: RepositoryPageRequest): Promise<RepositoryResult<RepositoryPage<PublicHoliday>>> => {
      const qs = request?.pageToken ? `?pageToken=${request.pageToken}` : "";
      return this.fetchJson<RepositoryPage<PublicHoliday>>(`/api/planning/holidays${qs}`);
    }
  };

  readonly settings = {
    getPlanningSettings: async (): Promise<RepositoryResult<PlanningSettings>> => {
      return this.fetchJson<PlanningSettings>("/api/planning/settings");
    }
  };

  readonly planningEvents = {
    listPlanningEvents: async (request?: PlanningEventQuery): Promise<RepositoryResult<RepositoryPage<PlanningEvent>>> => {
      const qs = await this.buildTeamScopedQueryString(request, {
        employeeId: request?.resourceId
      });
      return this.fetchJson<RepositoryPage<PlanningEvent>>(`/api/planning/events${qs}`);
    }
  };

  readonly teamPlanningConfigurations = {
    listTeamPlanningConfigurations: async (request?: RepositoryPageRequest): Promise<RepositoryResult<RepositoryPage<TeamPlanningConfiguration>>> => {
      const qs = request?.pageToken ? `?pageToken=${request.pageToken}` : "";
      return this.fetchJson<RepositoryPage<TeamPlanningConfiguration>>(`/api/planning/teamconfigurations${qs}`);
    }
  };
}

export function createApiPlanningRepositories(baseUrl: string, logger?: Logger): PlanningRepositories {
  return new ApiPlanningRepositories(baseUrl, logger);
}

// The API serializes DateTime columns with a time component ("2026-08-17T00:00:00");
// the frontend works with plain YYYY-MM-DD date keys (timeline positioning, date
// inputs). Legacy rows may also carry an empty ApprovalStatus.
function normalizeApiAbsence(dto: Absence): Absence {
  return {
    ...dto,
    startDate: toDateOnly(dto.startDate),
    endDate: toDateOnly(dto.endDate),
    approvalStatus: dto.approvalStatus ? dto.approvalStatus : "approved",
    duration: Number(dto.duration) || 0
  };
}

function toDateOnly(value: string): string {
  return typeof value === "string" && value.length > 10 ? value.slice(0, 10) : value;
}
// EO-428: error responses may carry a machine-readable code. Reading it must never turn a failed
// request into a thrown exception, so anything unparsable simply yields no code.
async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return typeof body?.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}
