import type { Logger } from "../../core/logging";
import { CachedMicrosoft365AuthProvider } from "../microsoft365/cachedAuthProvider";
import type { AccessTokenRequest, AccessTokenResult, Microsoft365AuthProvider } from "../microsoft365/authContracts";
import { parseDeepLinkFromLocation } from "./deepLinkParse";
import type { HostAdapter, HostChrome, HostContext, HostDeepLink, HostThemeMode } from "./types";

const browserChrome: HostChrome = {
  showAppHeader: true,
  showTeamsRail: true,
  showWorkspaceNav: true,
  fullPage: true
};

/**
 * Direct HTTPS / localhost host. Never touches the Teams SDK (EO-455).
 */
export function createBrowserHostAdapter(logger?: Logger): HostAdapter {
  let cachedContext: HostContext | undefined;
  let contextResolved = false;
  const authProvider = new CachedMicrosoft365AuthProvider(new UnavailableBrowserAuthProvider(logger), logger);

  return {
    kind: "browser",
    chrome: browserChrome,

    async initialize(): Promise<void> {
      // No host handshake.
    },

    notifyReady(): void {
      // No host loading indicator.
    },

    async getContext(): Promise<HostContext | undefined> {
      if (contextResolved) {
        return cachedContext;
      }

      const theme = resolveBrowserTheme();
      cachedContext = {
        theme,
        locale: document.documentElement.lang || navigator.language
      };
      contextResolved = true;
      return cachedContext;
    },

    invalidateContext(): void {
      cachedContext = undefined;
      contextResolved = false;
    },

    observeTheme(onThemeChange: (theme: HostThemeMode) => void): () => void {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = () => onThemeChange(media.matches ? "dark" : "light");
      apply();
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    },

    getAuthProvider(): Microsoft365AuthProvider {
      return authProvider;
    },

    async readDeepLink(): Promise<HostDeepLink | undefined> {
      return parseDeepLinkFromLocation(window.location.hash, window.location.search);
    },

    buildDeepLink(target: HostDeepLink): string | undefined {
      const url = new URL(window.location.href);
      url.hash = buildHashForTarget(target);
      return url.toString();
    }
  };
}

function buildHashForTarget(target: HostDeepLink): string {
  if (target.kind === "route" && target.path) {
    return target.path.startsWith("#") ? target.path.slice(1) : target.path;
  }

  const path = target.path ?? "/overview";
  const params = new URLSearchParams();
  params.set("dl", target.kind);
  if (target.id) {
    params.set("id", target.id);
  }
  return `${path}?${params.toString()}`;
}

function resolveBrowserTheme(): HostThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Browser sessions without MSAL configuration cannot mint API tokens. */
class UnavailableBrowserAuthProvider implements Microsoft365AuthProvider {
  constructor(private readonly logger?: Logger) {}

  async getAccessToken(request: AccessTokenRequest): Promise<AccessTokenResult> {
    void request;
    this.logger?.debug("No browser auth provider is configured for this session.", {
      source: "infrastructure",
      component: "BrowserHostAdapter",
      operation: "getAccessToken"
    });

    return {
      ok: false,
      error: {
        code: "forbidden",
        message: "Browser host has no Microsoft 365 auth provider configured.",
        recoverable: true
      }
    };
  }
}
