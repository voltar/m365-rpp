import type { Logger } from "../../core/logging";
import { CachedMicrosoft365AuthProvider } from "../microsoft365/cachedAuthProvider";
import type { AccessTokenRequest, AccessTokenResult, Microsoft365AuthProvider } from "../microsoft365/authContracts";
import { parseDeepLinkFromLocation } from "./deepLinkParse";
import type { HostAdapter, HostChrome, HostContext, HostDeepLink, HostThemeMode, SharePointHostBootstrap } from "./types";

/**
 * SharePoint page / Web Part host. Uses explicit bootstrap context when provided;
 * never loads the Teams SDK.
 */
export function createSharePointHostAdapter(logger?: Logger): HostAdapter {
  const bootstrap: SharePointHostBootstrap = window.__RPP_HOST_CONTEXT__ ?? {};
  const fullPage = bootstrap.fullPage !== false;
  const chrome: HostChrome = {
    showAppHeader: false,
    showTeamsRail: false,
    showWorkspaceNav: true,
    fullPage
  };

  const innerAuth = bootstrap.authProvider ?? new UnavailableSharePointAuthProvider(logger);
  const authProvider = new CachedMicrosoft365AuthProvider(innerAuth, logger);
  let cachedContext: HostContext | undefined;
  let contextResolved = false;

  return {
    kind: "sharepoint",
    chrome,

    async initialize(): Promise<void> {
      // SPFx / page context is supplied before mount.
    },

    notifyReady(): void {
      // No Teams spinner.
    },

    async getContext(): Promise<HostContext | undefined> {
      if (contextResolved) {
        return cachedContext;
      }

      const sp = window._spPageContextInfo;
      cachedContext = {
        userId: bootstrap.userId ?? sp?.aadObjectId,
        tenantId: bootstrap.tenantId ?? sp?.aadTenantId,
        teamId: bootstrap.teamId,
        teamName: bootstrap.teamName,
        locale: bootstrap.locale ?? sp?.currentUICultureName ?? sp?.currentCultureName,
        theme: resolveBrowserTheme()
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
      if (target.kind === "route" && target.path) {
        url.hash = target.path.startsWith("#") ? target.path.slice(1) : target.path;
      } else {
        const path = target.path ?? "/overview";
        const params = new URLSearchParams();
        params.set("dl", target.kind);
        if (target.id) {
          params.set("id", target.id);
        }
        url.hash = `${path}?${params.toString()}`;
      }
      return url.toString();
    }
  };
}

function resolveBrowserTheme(): HostThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

class UnavailableSharePointAuthProvider implements Microsoft365AuthProvider {
  constructor(private readonly logger?: Logger) {}

  async getAccessToken(request: AccessTokenRequest): Promise<AccessTokenResult> {
    void request;
    this.logger?.warn("SharePoint host has no auth bridge configured (pass __RPP_HOST_CONTEXT__.authProvider).", {
      source: "infrastructure",
      component: "SharePointHostAdapter",
      operation: "getAccessToken"
    });

    return {
      ok: false,
      error: {
        code: "forbidden",
        message: "SharePoint host auth bridge is not configured.",
        recoverable: true
      }
    };
  }
}
