import * as microsoftTeams from "@microsoft/teams-js";

const { app } = microsoftTeams;

// The bundled ESM build of @microsoft/teams-js does not attach itself to window.
// TeamsSsoAuthProvider and localizationService resolve the SDK via window.microsoftTeams,
// so expose the module there (a script-tag loaded SDK, if any, takes precedence).
const hostWindow = window as Window & { microsoftTeams?: unknown };
hostWindow.microsoftTeams ??= microsoftTeams;

let initializationPromise: Promise<void> | undefined;

export function initializeTeamsApp(): Promise<void> {
  initializationPromise ??= app
    .initialize()
    .then(() => {
      // showLoadingIndicator in the manifest keeps the Teams spinner up until the
      // app reports readiness; without these calls the tab never becomes visible.
      app.notifyAppLoaded();
      app.notifySuccess();
    })
    .catch((error: unknown) => {
      if (isLikelyTeamsHost()) {
        console.warn("Teams app initialization failed.", error);
      }
    });

  return initializationPromise;
}

function isLikelyTeamsHost(): boolean {
  try {
    return window.self !== window.top || window.location.search.toLowerCase().includes("teams");
  } catch {
    return true;
  }
}

export type HostThemeMode = "light" | "dark";

/**
 * Follows the Microsoft Teams host theme (default/dark/contrast). Outside a Teams host
 * the browser color scheme is used instead. Returns a cleanup function.
 */
export function observeHostTheme(onThemeChange: (mode: HostThemeMode) => void): () => void {
  let disposed = false;
  let removeMediaListener: (() => void) | undefined;

  const applyHostTheme = (theme: string | undefined) => {
    if (!disposed) {
      onThemeChange(theme === "dark" || theme === "contrast" ? "dark" : "light");
    }
  };

  // Like the SSO provider, never trust the Teams SDK to reject outside a Teams
  // host: initialize/getContext can hang there, so fall back after a timeout.
  const contextTimeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error("Teams host context timed out.")), 3_000);
  });

  Promise.race([initializeTeamsApp().then(() => app.getContext()), contextTimeout])
    .then((context) => {
      applyHostTheme(context.app.theme);
      app.registerOnThemeChangeHandler(applyHostTheme);
    })
    .catch(() => {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const applyMediaTheme = () => applyHostTheme(media.matches ? "dark" : "light");

      applyMediaTheme();
      media.addEventListener("change", applyMediaTheme);
      removeMediaListener = () => media.removeEventListener("change", applyMediaTheme);
    });

  return () => {
    disposed = true;
    removeMediaListener?.();
  };
}
