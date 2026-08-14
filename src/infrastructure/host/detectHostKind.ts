import type { HostKind } from "./types";

/**
 * Synchronous host detection. Must not load or call the Teams SDK (EO-455 FR-455.2).
 */
export function detectHostKind(): HostKind {
  if (typeof window === "undefined") {
    return "browser";
  }

  const explicit = window.__RPP_HOST__;
  if (explicit === "teams" || explicit === "browser" || explicit === "sharepoint") {
    return explicit;
  }

  if (isLikelyTeamsHost()) {
    return "teams";
  }

  if (isLikelySharePointHost()) {
    return "sharepoint";
  }

  return "browser";
}

/**
 * True when this document is a top-level browsing context (address bar URL),
 * not an embedded iframe child. Do not use this alone to choose mock vs API:
 * Teams desktop tabs are often top-level WebViews. Prefer `detectHostKind()`.
 */
export function isTopLevelBrowsingContext(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    return window.self === window.top;
  } catch {
    // Accessing window.top can throw when cross-origin framed; treat as embedded.
    return false;
  }
}

function isLikelyTeamsHost(): boolean {
  try {
    // Do NOT treat window.microsoftTeams as proof of Teams. The ESM teams-js build
    // does not set it, and teamsApp.ts assigns the module onto window for SSO helpers
    // even outside Teams — that false-positive kept standaloneBrowserUsesMock off.

    const search = window.location.search.toLowerCase();
    if (search.includes("inteams") || search.includes("teamsframe") || /[?&]host=teams\b/.test(search)) {
      return true;
    }

    // Framed by the Teams client (web or desktop tab host).
    const ancestorOrigins = (window.location as Location & { readonly ancestorOrigins?: DOMStringList })
      .ancestorOrigins;
    if (ancestorOrigins) {
      for (let index = 0; index < ancestorOrigins.length; index += 1) {
        const origin = ancestorOrigins.item(index)?.toLowerCase() ?? "";
        if (origin.includes("teams.microsoft.com") || origin.includes("teams.cloud.microsoft")) {
          return true;
        }
      }
    }

    // Desktop / mobile Teams webviews sometimes omit ancestorOrigins; UA still marks the client.
    // Do not use document.referrer: opening the public demo URL from a Teams chat link in an
    // external browser keeps a Teams referrer but is a standalone browser session.
    if (isTeamsClientUserAgent(navigator.userAgent)) {
      return true;
    }
  } catch {
    // Cross-origin frame access can throw; treat as non-Teams.
  }

  return false;
}

function isTeamsClientUserAgent(userAgent: string): boolean {
  // Electron desktop client and mobile wrappers commonly include these tokens.
  return /\bTeams\/\d/i.test(userAgent) || /\bTeamProducts\b/i.test(userAgent);
}

function isLikelySharePointHost(): boolean {
  try {
    if (window.__RPP_HOST_CONTEXT__) {
      return true;
    }

    if (window._spPageContextInfo) {
      return true;
    }

    const host = window.location.hostname.toLowerCase();
    if (host.endsWith(".sharepoint.com") || host.endsWith(".sharepoint-df.com")) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}
