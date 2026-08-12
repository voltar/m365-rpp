import type { Microsoft365AuthProvider } from "../microsoft365/authContracts";

/** EO-455 / ADR-004: runtime host of the single SPA artefact. */
export type HostKind = "teams" | "browser" | "sharepoint";

export type HostThemeMode = "light" | "dark" | "contrast";

export interface HostContext {
  readonly userId?: string;
  readonly tenantId?: string;
  /** M365 group / host team id used for X-RPP-Active-TeamId when in team scope. */
  readonly teamId?: string;
  readonly teamName?: string;
  readonly locale?: string;
  readonly theme: HostThemeMode;
}

export interface HostChrome {
  readonly showAppHeader: boolean;
  readonly showTeamsRail: boolean;
  readonly showWorkspaceNav: boolean;
  readonly fullPage: boolean;
}

export type DeepLinkTargetKind = "vacation-request" | "absence" | "route" | "help";

export interface HostDeepLink {
  readonly kind: DeepLinkTargetKind;
  readonly id?: string;
  readonly path?: string;
  readonly raw?: string;
}

/**
 * Session-scoped façade for everything host-specific. UI and repositories must not
 * import @microsoft/teams-js or SPFx types directly (ADR-004 / EO-455).
 */
export interface HostAdapter {
  readonly kind: HostKind;
  readonly chrome: HostChrome;
  initialize(): Promise<void>;
  notifyReady(): void;
  getContext(): Promise<HostContext | undefined>;
  /** Drop the memoized context (e.g. after the user picks another team). */
  invalidateContext(): void;
  observeTheme(onThemeChange: (theme: HostThemeMode) => void): () => void;
  getAuthProvider(): Microsoft365AuthProvider;
  readDeepLink(): Promise<HostDeepLink | undefined>;
  buildDeepLink(target: HostDeepLink): string | undefined;
}

export interface SharePointHostBootstrap {
  readonly userId?: string;
  readonly userPrincipalName?: string;
  readonly tenantId?: string;
  readonly locale?: string;
  readonly teamId?: string;
  readonly teamName?: string;
  readonly fullPage?: boolean;
  readonly authProvider?: Microsoft365AuthProvider;
}

declare global {
  interface Window {
    /** Explicit host kind set by an embedder before mount (SPFx, tests). */
    __RPP_HOST__?: HostKind;
    /** Optional host context / token bridge for in-page SharePoint mounts. */
    __RPP_HOST_CONTEXT__?: SharePointHostBootstrap;
    _spPageContextInfo?: {
      readonly userId?: number;
      readonly userLoginName?: string;
      readonly aadObjectId?: string;
      readonly aadTenantId?: string;
      readonly currentUICultureName?: string;
      readonly currentCultureName?: string;
    };
  }
}
