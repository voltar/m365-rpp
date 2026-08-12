import { resolveHostAdapter, vacationRequestIdFromDeepLink } from "../infrastructure/host";

// EO-421 / EO-455: Outlook-synced events carry a deep link whose target is the vacation
// request id. AppShell resolves it via the host adapter and navigates to the timeline;
// the page consumes the pending id and highlights the request.

let pendingVacationRequestId: string | undefined;

export function consumePendingVacationRequestId(): string | undefined {
  const requestId = pendingVacationRequestId;
  pendingVacationRequestId = undefined;

  return requestId;
}

// Re-arms the pending id when a consumer cannot resolve it and hands over to the
// fallback page (Timeline → "Meine Anträge" when the linked absence is gone).
export function storePendingVacationRequestId(requestId: string): void {
  pendingVacationRequestId = requestId;
}

/**
 * Resolves the vacation request id from the host deep-link, or undefined when none.
 * The resolved id is also stored for {@link consumePendingVacationRequestId}.
 */
export function resolveDeepLinkVacationRequestId(): Promise<string | undefined> {
  return resolveHostAdapter()
    .then((host) => host.readDeepLink())
    .then((deepLink) => {
      const requestId = vacationRequestIdFromDeepLink(deepLink);

      if (requestId) {
        pendingVacationRequestId = requestId;
        return requestId;
      }

      return undefined;
    })
    .catch(() => undefined);
}
