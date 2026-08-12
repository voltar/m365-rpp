import type { Logger } from "../../core/logging";
import { CachedMicrosoft365AuthProvider } from "../microsoft365/cachedAuthProvider";
import type { Microsoft365AuthProvider } from "../microsoft365/authContracts";
import { TeamsSsoAuthProvider } from "../microsoft365/teamsSsoAuthProvider";
import { parseDeepLinkFromLocation, parseDeepLinkFromSubPageId } from "./deepLinkParse";
import type { HostAdapter, HostChrome, HostContext, HostDeepLink, HostThemeMode } from "./types";

const teamsChrome: HostChrome = {
  showAppHeader: false,
  showTeamsRail: false,
  showWorkspaceNav: true,
  fullPage: true
};

interface TeamsAppModule {
  readonly initializeTeamsApp: () => Promise<void>;
  readonly observeHostTheme: (onThemeChange: (mode: "light" | "dark") => void) => () => void;
}

/**
 * Microsoft Teams tab host. Loads teams-js / teamsApp only after this adapter is chosen.
 */
export function createTeamsHostAdapter(logger?: Logger): HostAdapter {
  const ssoProvider = new TeamsSsoAuthProvider(logger);
  const authProvider = new CachedMicrosoft365AuthProvider(ssoProvider, logger);
  let teamsAppModule: TeamsAppModule | undefined;
  let initPromise: Promise<void> | undefined;
  let cachedContext: HostContext | undefined;
  let contextResolved = false;

  async function loadTeamsApp(): Promise<TeamsAppModule> {
    if (!teamsAppModule) {
      teamsAppModule = await import("../microsoft365/teamsApp");
    }
    return teamsAppModule;
  }

  return {
    kind: "teams",
    chrome: teamsChrome,

    initialize(): Promise<void> {
      initPromise ??= loadTeamsApp()
        .then((module) => module.initializeTeamsApp())
        .catch((error: unknown) => {
          logger?.warn("Teams host initialization failed.", {
            source: "infrastructure",
            component: "TeamsHostAdapter",
            operation: "initialize",
            details: { error }
          });
        });
      return initPromise;
    },

    notifyReady(): void {
      // initializeTeamsApp already calls notifyAppLoaded / notifySuccess.
    },

    async getContext(): Promise<HostContext | undefined> {
      if (contextResolved) {
        return cachedContext;
      }

      await this.initialize();
      const result = await ssoProvider.getContext();
      contextResolved = true;

      if (!result.ok) {
        cachedContext = { theme: "light" };
        return cachedContext;
      }

      const value = result.value;
      cachedContext = {
        userId: value.userId,
        teamId: value.groupId ?? value.teamId,
        teamName: value.teamName,
        locale: value.locale,
        theme: "light"
      };
      return cachedContext;
    },

    invalidateContext(): void {
      cachedContext = undefined;
      contextResolved = false;
    },

    observeTheme(onThemeChange: (theme: HostThemeMode) => void): () => void {
      let disposed = false;
      let cleanup: (() => void) | undefined;

      void loadTeamsApp()
        .then((module) => {
          if (disposed) {
            return;
          }
          cleanup = module.observeHostTheme((mode) => onThemeChange(mode));
        })
        .catch(() => {
          if (!disposed) {
            onThemeChange(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
          }
        });

      return () => {
        disposed = true;
        cleanup?.();
      };
    },

    getAuthProvider(): Microsoft365AuthProvider {
      return authProvider;
    },

    async readDeepLink(): Promise<HostDeepLink | undefined> {
      await this.initialize();

      // Prefer host subPageId (EO-421); fall back to hash/query for hybrid URLs.
      const result = await ssoProvider.getContext();
      if (result.ok) {
        // Teams context page.subPageId is not on our normalized TeamsContext — read raw SDK when present.
        const rawSubPage = await readTeamsSubPageId();
        const fromTeams = parseDeepLinkFromSubPageId(rawSubPage);
        if (fromTeams) {
          return fromTeams;
        }
      }

      return parseDeepLinkFromLocation(window.location.hash, window.location.search);
    },

    buildDeepLink(target: HostDeepLink): string | undefined {
      // Outbound Teams entity links need installation-specific app id (server-side Outlook sync).
      // Client-side we can still produce an in-app hash for the current tab session.
      if (target.kind === "vacation-request" && target.id) {
        return `${window.location.origin}${window.location.pathname}#/overview?dl=vacation-request&id=${encodeURIComponent(target.id)}`;
      }
      if (target.kind === "route" && target.path) {
        return `${window.location.origin}${window.location.pathname}#${target.path.startsWith("/") ? target.path : `/${target.path}`}`;
      }
      return undefined;
    }
  };
}

async function readTeamsSubPageId(): Promise<string | undefined> {
  try {
    const teams = (window as Window & {
      microsoftTeams?: {
        app?: {
          getContext?: () => Promise<{
            page?: { subPageId?: string };
            subEntityId?: string;
          }>;
        };
      };
    }).microsoftTeams;

    const context = await teams?.app?.getContext?.();
    const subPageId = context?.page?.subPageId ?? (context as { subEntityId?: string } | undefined)?.subEntityId;
    return typeof subPageId === "string" && subPageId.length > 0 ? subPageId : undefined;
  } catch {
    return undefined;
  }
}
