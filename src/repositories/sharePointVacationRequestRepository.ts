import type { Logger } from "../core/logging";
import {
  createSharePointListItemsPath,
  createSharePointListItemPath,
  type SharePointClient,
} from "../infrastructure/microsoft365";
import type {
  IVacationRequestRepository,
  VacationRequest,
  VacationRequestQuery,
  RepositoryResult,
  RepositoryPage,
} from "./approvalRepositories";

interface SharePointVacationRequestItem {
  readonly Id?: number;
  readonly RequestId: string;
  readonly TeamId: string;
  readonly UserId: string;
  readonly AbsenceType: string;
  readonly StartDate: string;
  readonly StartHalf?: string;
  readonly EndDate: string;
  readonly EndHalf?: string;
  readonly Comment?: string;
  readonly ApprovalRequired: boolean;
  readonly ApproverUserId?: string;
  readonly Status: string;
  readonly ApprovalProvider: string;
  readonly ApprovalReferenceId?: string;
  readonly DecisionBy?: string;
  readonly DecisionDate?: string;
  readonly DecisionComment?: string;
  readonly FlowRunId?: string;
  readonly SyncToOutlook: boolean;
  readonly OutlookSyncStatus?: string;
  readonly OutlookGraphEventId?: string;
  readonly OutlookLastSyncedAt?: string;
  readonly OutlookLastError?: string;
  readonly CreatedAt: string;
  readonly CreatedBy: string;
  readonly ModifiedAt: string;
  readonly ModifiedBy: string;
}

interface SharePointCollectionResponse<T> {
  readonly value: readonly T[];
  readonly ["@odata.nextLink"]?: string;
}

/**
 * SharePoint-backed implementation of IVacationRequestRepository for EO-207.
 * Uses RequestId as the business key (unique constraint enforced in list).
 */
export class SharePointVacationRequestRepository
  implements IVacationRequestRepository
{
  constructor(
    private readonly client: SharePointClient,
    private readonly logger?: Logger
  ) {}

  async listVacationRequests(
    query?: VacationRequestQuery
  ): Promise<RepositoryResult<RepositoryPage<VacationRequest>>> {
    const listQuery: Record<string, string | number | undefined> = {
      $select: "Id,RequestId,TeamId,UserId,AbsenceType,StartDate,StartHalf,EndDate,EndHalf,Comment,ApprovalRequired,ApproverUserId,Status,ApprovalProvider,ApprovalReferenceId,DecisionBy,DecisionDate,DecisionComment,FlowRunId,SyncToOutlook,OutlookSyncStatus,OutlookGraphEventId,OutlookLastSyncedAt,OutlookLastError,CreatedAt,CreatedBy,ModifiedAt,ModifiedBy",
      $orderby: "ModifiedAt desc",
    };

    if (query?.requestId) listQuery["$filter"] = `RequestId eq '${query.requestId}'`;
    const filters: string[] = [];

    if (query?.requestId) filters.push(`RequestId eq '${query.requestId}'`);
    if (query?.userId) filters.push(`UserId eq '${query.userId}'`);
    if (query?.teamId) filters.push(`TeamId eq '${query.teamId}'`);
    if (query?.status) filters.push(`Status eq '${query.status}'`);

    if (filters.length > 0) {
      listQuery["$filter"] = filters.join(" and ");
    }

    const result = await this.client.get<SharePointCollectionResponse<SharePointVacationRequestItem>>(
      createSharePointListItemsPath("VacationRequests", listQuery)
    );

    if (!result.ok) return result;

    const items = result.value.value.map((item) => this.mapToVacationRequest(item));

    return {
      ok: true,
      value: {
        items,
        nextPageToken: result.value["@odata.nextLink"],
      },
    };
  }

  async saveVacationRequest(
    request: VacationRequest
  ): Promise<RepositoryResult<VacationRequest>> {
    const item = this.mapToSharePointItem(request);

    // Try to find existing item by RequestId
    const existing = await this.findByRequestId(request.id);

    let result: RepositoryResult<unknown>;

    if (existing) {
      result = await this.client.merge(
        createSharePointListItemPath("VacationRequests", existing.Id!),
        item
      );
    } else {
      result = await this.client.post(
        createSharePointListItemsPath("VacationRequests"),
        item
      );
    }

    if (!result.ok) {
      this.logger?.error("Failed to save vacation request to SharePoint.", {
        source: "repository",
        component: "SharePointVacationRequestRepository",
        operation: "saveVacationRequest",
        details: { requestId: request.id, errorCode: result.error.code },
      }, result.error);
      return result;
    }

    // Re-read to get the full persisted entity with Id etc.
    const refreshed = await this.listVacationRequests({ requestId: request.id });
    if (!refreshed.ok || refreshed.value.items.length === 0) {
      return { ok: true, value: request }; // fallback
    }

    return { ok: true, value: refreshed.value.items[0]! };
  }

  async deleteVacationRequest(requestId: string): Promise<RepositoryResult<void>> {
    const existing = await this.findByRequestId(requestId);
    if (!existing) {
      return { ok: true, value: undefined }; // already gone
    }

    const result = await this.client.delete(
      createSharePointListItemPath("VacationRequests", existing.Id!)
    );

    if (!result.ok) {
      this.logger?.error("Failed to delete vacation request.", {
        source: "repository",
        component: "SharePointVacationRequestRepository",
        operation: "deleteVacationRequest",
        details: { requestId },
      }, result.error);
    }

    return result;
  }

  private async findByRequestId(requestId: string): Promise<SharePointVacationRequestItem | null> {
    const result = await this.client.get<SharePointCollectionResponse<SharePointVacationRequestItem>>(
      createSharePointListItemsPath("VacationRequests", {
        $filter: `RequestId eq '${requestId}'`,
        $select: "Id",
      })
    );

    if (!result.ok || result.value.value.length === 0) return null;
    return result.value.value[0]!;
  }

  private mapToVacationRequest(item: SharePointVacationRequestItem): VacationRequest {
    return {
      id: item.RequestId,
      teamId: item.TeamId,
      userId: item.UserId,
      absenceType: item.AbsenceType as VacationRequest["absenceType"],
      startDate: item.StartDate,
      startHalf: (item.StartHalf as VacationRequest["startHalf"]) || "fullDay",
      endDate: item.EndDate,
      endHalf: (item.EndHalf as VacationRequest["endHalf"]) || "fullDay",
      comment: item.Comment,
      approvalRequired: item.ApprovalRequired,
      approverUserId: item.ApproverUserId,
      status: item.Status as VacationRequest["status"],
      approvalProvider: item.ApprovalProvider as VacationRequest["approvalProvider"],
      approvalReferenceId: item.ApprovalReferenceId,
      syncToOutlook: item.SyncToOutlook,
      outlookSync: {
        enabled: item.SyncToOutlook,
        syncStatus: (item.OutlookSyncStatus as NonNullable<VacationRequest["outlookSync"]>["syncStatus"]) || "notRequired",
        graphEventId: item.OutlookGraphEventId,
        lastSyncedAt: item.OutlookLastSyncedAt,
        lastError: item.OutlookLastError,
      },
      createdAt: item.CreatedAt,
      createdBy: item.CreatedBy,
      modifiedAt: item.ModifiedAt,
      modifiedBy: item.ModifiedBy,
    };
  }

  private mapToSharePointItem(request: VacationRequest): Partial<SharePointVacationRequestItem> {
    return {
      RequestId: request.id,
      TeamId: request.teamId,
      UserId: request.userId,
      AbsenceType: request.absenceType,
      StartDate: request.startDate,
      StartHalf: request.startHalf,
      EndDate: request.endDate,
      EndHalf: request.endHalf,
      Comment: request.comment,
      ApprovalRequired: request.approvalRequired,
      ApproverUserId: request.approverUserId,
      Status: request.status,
      ApprovalProvider: request.approvalProvider,
      ApprovalReferenceId: request.approvalReferenceId,
      SyncToOutlook: request.syncToOutlook,
      OutlookSyncStatus: request.outlookSync?.syncStatus,
      OutlookGraphEventId: request.outlookSync?.graphEventId,
      OutlookLastSyncedAt: request.outlookSync?.lastSyncedAt,
      OutlookLastError: request.outlookSync?.lastError,
      CreatedAt: request.createdAt,
      CreatedBy: request.createdBy,
      ModifiedAt: request.modifiedAt,
      ModifiedBy: request.modifiedBy,
    };
  }
}

export function createSharePointVacationRequestRepository(
  client: SharePointClient,
  logger?: Logger
) {
  return new SharePointVacationRequestRepository(client, logger);
}
