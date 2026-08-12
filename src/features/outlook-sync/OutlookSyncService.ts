import type { Logger } from "../../core/logging";
import type {
  OutlookSync,
  VacationRequest,
  VacationRequestLifecycleEvent
} from "../../models/approval";
import type { RepositoryError } from "../../repositories/planningRepositories";
import type { CalendarAdapter } from "./GraphCalendarAdapter";

export type OutlookSyncResult =
  | { readonly ok: true; readonly request: VacationRequest }
  | { readonly ok: false; readonly error: RepositoryError; readonly request: VacationRequest };

export interface OutlookSyncService {
  synchronizeVacationRequest(event: VacationRequestLifecycleEvent): Promise<OutlookSyncResult>;
  retrySynchronization(request: VacationRequest): Promise<OutlookSyncResult>;
}

export function createOutlookSyncService(adapter: CalendarAdapter, logger?: Logger): OutlookSyncService {
  return {
    async synchronizeVacationRequest(event) {
      return synchronize(event.request, event.type);
    },

    async retrySynchronization(request) {
      if (request.outlookSync.syncStatus !== "failed") {
        return { ok: true, request };
      }

      return synchronize(request, request.status === "approved" ? "vacationApproved" : "vacationSubmitted");
    }
  };

  async function synchronize(
    request: VacationRequest,
    eventType: VacationRequestLifecycleEvent["type"]
  ): Promise<OutlookSyncResult> {
    if ((!request.outlookSync.enabled && !request.outlookSync.graphEventId) || eventType === "vacationUpdated" && request.status === "draft") {
      return {
        ok: true,
        request: withOutlookSync(request, {
          ...request.outlookSync,
          syncStatus: request.outlookSync.enabled ? request.outlookSync.syncStatus : "notRequired"
        })
      };
    }

    try {
      if (eventType === "vacationRejected" || eventType === "vacationCancelled") {
        if (!request.outlookSync.graphEventId) {
          return { ok: true, request: withOutlookSync(request, notRequired(request.outlookSync.enabled)) };
        }

        const deleteResult = await adapter.deleteVacationEvent(request.outlookSync.graphEventId);

        if (!deleteResult.ok) {
          return failed(request, deleteResult.error);
        }

        return { ok: true, request: withOutlookSync(request, notRequired(request.outlookSync.enabled)) };
      }

      if (request.status !== "submitted" && request.status !== "pendingApproval" && request.status !== "approved") {
        return { ok: true, request: withOutlookSync(request, notRequired(request.outlookSync.enabled)) };
      }

      const pendingRequest = withOutlookSync(request, { ...request.outlookSync, syncStatus: "pending" });
      const result = pendingRequest.outlookSync.graphEventId
        ? await adapter.updateVacationEvent(pendingRequest)
        : await adapter.createVacationEvent(pendingRequest);

      if (!result.ok) {
        return failed(request, result.error);
      }

      return {
        ok: true,
        request: withOutlookSync(request, {
          enabled: true,
          graphEventId: result.value.graphEventId,
          lastSyncedAt: new Date().toISOString(),
          syncStatus: "synced"
        })
      };
    } catch (error: unknown) {
      logger?.error("Outlook synchronization failed.", {
        source: "outlook-sync",
        component: "OutlookSyncService",
        operation: "synchronizeVacationRequest",
        details: { requestId: request.id, eventType }
      }, error);

      return failed(request, {
        code: "unknown",
        message: "Outlook synchronization failed.",
        recoverable: true,
        details: { error }
      });
    }
  }
}

function failed(request: VacationRequest, error: RepositoryError): OutlookSyncResult {
  return {
    ok: false,
    error,
    request: withOutlookSync(request, {
      ...request.outlookSync,
      lastError: error.message,
      syncStatus: "failed"
    })
  };
}

function notRequired(enabled: boolean): OutlookSync {
  return {
    enabled,
    syncStatus: "notRequired"
  };
}

function withOutlookSync(request: VacationRequest, outlookSync: OutlookSync): VacationRequest {
  return {
    ...request,
    outlookSync
  };
}
