import type { Logger } from "../../core/logging";

/**
 * EO-428: the team a user chose for the personal app scope, where Microsoft Teams provides no host
 * context. Kept in this browser only — it is a convenience, not an authorization fact. Every request
 * is still checked server-side against the caller's real membership, so a tampered value buys
 * nothing but a permission error.
 */
const STORAGE_PREFIX = "rpp.activeTeamSelection";

export interface ActiveTeamSelection {
  readonly teamId: string;
  readonly teamName: string;
}

function storageKey(userId?: string): string {
  // Scoped per user: a shared browser must not hand the next person the previous person's team.
  return userId ? `${STORAGE_PREFIX}.${userId}` : STORAGE_PREFIX;
}

export function readActiveTeamSelection(userId?: string, logger?: Logger): ActiveTeamSelection | undefined {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));

    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as Partial<ActiveTeamSelection>;

    return typeof parsed.teamId === "string" && parsed.teamId.length > 0
      ? { teamId: parsed.teamId, teamName: typeof parsed.teamName === "string" ? parsed.teamName : parsed.teamId }
      : undefined;
  } catch (error) {
    // Private browsing and storage quotas make this fail in ways that must never break loading.
    logger?.debug("Could not read the stored team selection.", {
      source: "infrastructure",
      component: "activeTeamSelection",
      operation: "readActiveTeamSelection",
      details: { error: error instanceof Error ? error.message : String(error) }
    });
    return undefined;
  }
}

export function writeActiveTeamSelection(selection: ActiveTeamSelection, userId?: string, logger?: Logger): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(selection));
  } catch (error) {
    logger?.debug("Could not store the team selection.", {
      source: "infrastructure",
      component: "activeTeamSelection",
      operation: "writeActiveTeamSelection",
      details: { error: error instanceof Error ? error.message : String(error) }
    });
  }
}

export function clearActiveTeamSelection(userId?: string): void {
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    // Nothing to recover from: an unremovable selection is corrected by choosing another team.
  }
}
