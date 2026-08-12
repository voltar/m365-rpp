import { profile } from "@microsoft/teams-js";
import type { Logger } from "../../core/logging";
import type { ResourceSummary } from "../../models/resource";
import { initializeTeamsApp } from "./teamsApp";

// Native profile cards resolve the persona via Microsoft Entra; mock resource ids
// ("resource-*") can never resolve, so only Graph GUID ids are handed to the host.
const AAD_OBJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shows the native Microsoft Teams profile card for the given resource.
 * Returns false when the host does not support profile cards (browser, mock data)
 * so callers can fall back to the in-app person card.
 */
export async function tryShowTeamsProfileCard(
  resource: Pick<ResourceSummary, "id" | "displayName">,
  targetElementBoundingRect: DOMRect,
  logger?: Logger
): Promise<boolean> {
  if (!AAD_OBJECT_ID_PATTERN.test(resource.id)) {
    return false;
  }

  try {
    await initializeTeamsApp();

    if (!profile.isSupported()) {
      // FR-413.5: surface the host capability decision in monitoring instead of a
      // silent fallback — profile.showProfile is a beta capability and hosts may
      // simply not offer it yet.
      logger?.warn("Teams host does not support the profile card capability; falling back to the in-app card.", {
        source: "infrastructure",
        component: "TeamsProfileCard",
        operation: "isSupported",
        details: { supported: false, resourceId: resource.id }
      });

      return false;
    }

    await profile.showProfile({
      modality: "Card",
      persona: {
        identifiers: { AadObjectId: resource.id },
        displayName: resource.displayName
      },
      targetElementBoundingRect,
      triggerType: "Press"
    });

    return true;
  } catch (error: unknown) {
    logger?.warn("Native Teams profile card could not be shown.", {
      source: "infrastructure",
      component: "TeamsProfileCard",
      operation: "showProfile",
      details: { resourceId: resource.id, error }
    });

    return false;
  }
}
