import type { Logger } from "../../core/logging";
import type { VacationRequestLifecycleEvent } from "../../models/approval";
import type { IVacationRequestRepository } from "../../repositories/approvalRepositories";
import type { OutlookSyncResult, OutlookSyncService } from "./OutlookSyncService";

export interface SyncQueue {
  enqueue(event: VacationRequestLifecycleEvent): Promise<OutlookSyncResult>;
}

export function createSyncQueue(service: OutlookSyncService, logger?: Logger): SyncQueue {
  return {
    async enqueue(event) {
      logger?.info("Outlook sync event queued.", {
        source: "outlook-sync",
        component: "SyncQueue",
        operation: "enqueue",
        details: { eventType: event.type, requestId: event.request.id }
      });

      return service.synchronizeVacationRequest(event);
    }
  };
}

export function createPersistingSyncQueue(
  service: OutlookSyncService,
  vacationRequests: IVacationRequestRepository,
  logger?: Logger
): SyncQueue {
  const queue = createSyncQueue(service, logger);

  return {
    async enqueue(event) {
      const syncResult = await queue.enqueue(event);
      const saveResult = await vacationRequests.saveVacationRequest(syncResult.request);

      if (!saveResult.ok) {
        return {
          ok: false,
          error: saveResult.error,
          request: syncResult.request
        };
      }

      return syncResult.ok
        ? { ok: true, request: saveResult.value }
        : { ok: false, error: syncResult.error, request: saveResult.value };
    }
  };
}
