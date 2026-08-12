import { graphPermissionScopes, type MicrosoftGraphClient } from "../../infrastructure/microsoft365";
import type { VacationRequest } from "../../models/approval";
import type { RepositoryResult } from "../../repositories/planningRepositories";

export interface CalendarEventReference {
  readonly graphEventId: string;
}

export interface CalendarAdapter {
  createVacationEvent(request: VacationRequest): Promise<RepositoryResult<CalendarEventReference>>;
  updateVacationEvent(request: VacationRequest): Promise<RepositoryResult<CalendarEventReference>>;
  deleteVacationEvent(graphEventId: string): Promise<RepositoryResult<void>>;
}

interface GraphCalendarEventResponse {
  readonly id: string;
}

type GraphCalendarEventPayload = {
  readonly subject: string;
  readonly showAs: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
  readonly categories: readonly string[];
  readonly isAllDay: boolean;
  readonly start: {
    readonly dateTime: string;
    readonly timeZone: string;
  };
  readonly end: {
    readonly dateTime: string;
    readonly timeZone: string;
  };
  readonly body: {
    readonly contentType: "text";
    readonly content: string;
  };
};

export class GraphCalendarAdapter implements CalendarAdapter {
  constructor(private readonly graphClient: MicrosoftGraphClient) {}

  async createVacationEvent(request: VacationRequest): Promise<RepositoryResult<CalendarEventReference>> {
    const result = await this.graphClient.post<GraphCalendarEventPayload, GraphCalendarEventResponse>(
      "/me/events",
      createEventPayload(request),
      { scopes: [graphPermissionScopes.calendarsReadWrite] }
    );

    if (!result.ok) {
      return result;
    }

    return { ok: true, value: { graphEventId: result.value.id } };
  }

  async updateVacationEvent(request: VacationRequest): Promise<RepositoryResult<CalendarEventReference>> {
    if (!request.outlookSync.graphEventId) {
      return {
        ok: false,
        error: {
          code: "validation",
          message: "Cannot update Outlook event without a Graph event id.",
          recoverable: true
        }
      };
    }

    const result = await this.graphClient.patch<GraphCalendarEventPayload, GraphCalendarEventResponse>(
      `/me/events/${request.outlookSync.graphEventId}`,
      createEventPayload(request),
      { scopes: [graphPermissionScopes.calendarsReadWrite] }
    );

    if (!result.ok) {
      return result;
    }

    return { ok: true, value: { graphEventId: request.outlookSync.graphEventId } };
  }

  async deleteVacationEvent(graphEventId: string): Promise<RepositoryResult<void>> {
    return this.graphClient.delete(`/me/events/${graphEventId}`, { scopes: [graphPermissionScopes.calendarsReadWrite] });
  }
}

export class MockCalendarAdapter implements CalendarAdapter {
  async createVacationEvent(request: VacationRequest): Promise<RepositoryResult<CalendarEventReference>> {
    return { ok: true, value: { graphEventId: `graph-event-${request.id}` } };
  }

  async updateVacationEvent(request: VacationRequest): Promise<RepositoryResult<CalendarEventReference>> {
    return { ok: true, value: { graphEventId: request.outlookSync.graphEventId ?? `graph-event-${request.id}` } };
  }

  async deleteVacationEvent(): Promise<RepositoryResult<void>> {
    return { ok: true, value: undefined };
  }
}

function createEventPayload(request: VacationRequest): GraphCalendarEventPayload {
  const isApproved = request.status === "approved";

  return {
    subject: isApproved ? "Vacation" : "Vacation (Pending Approval)",
    showAs: isApproved ? "oof" : "tentative",
    categories: [isApproved ? "Approved Vacation" : "Pending Vacation"],
    isAllDay: true,
    start: {
      dateTime: `${request.startDate}T00:00:00`,
      timeZone: "Europe/Zurich"
    },
    end: {
      dateTime: `${addOneDay(request.endDate)}T00:00:00`,
      timeZone: "Europe/Zurich"
    },
    body: {
      contentType: "text",
      content: request.comment ?? ""
    }
  };
}

function addOneDay(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + 1);

  return date.toISOString().slice(0, 10);
}
