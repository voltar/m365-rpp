import type { Logger } from "../../core/logging";
import type { RepositoryError } from "../../repositories/planningRepositories";
import { initializeTeamsApp } from "./teamsApp";
import type {
  AccessTokenRequest,
  AccessTokenResult,
  Microsoft365AuthProvider,
  TeamsContext,
  TeamsContextProvider,
  TeamsContextResult
} from "./authContracts";

interface TeamsAppContext {
  readonly app?: {
    readonly locale?: string;
    readonly host?: {
      readonly name?: string;
    };
  };
  readonly team?: {
    readonly groupId?: string;
    readonly internalId?: string;
    readonly displayName?: string;
  };
  readonly user?: {
    readonly id?: string;
  };
  readonly locale?: string;
  readonly groupId?: string;
  readonly teamId?: string;
  readonly teamName?: string;
  readonly userObjectId?: string;
}

interface TeamsAuthentication {
  readonly getAuthToken?: (request?: { readonly resources?: readonly string[] }) => Promise<string> | void;
}

interface TeamsApp {
  readonly getContext?: () => Promise<TeamsAppContext>;
}

interface TeamsSdkLike {
  readonly app?: TeamsApp;
  readonly authentication?: TeamsAuthentication;
  readonly context?: TeamsAppContext;
}

interface M365Window extends Window {
  readonly microsoftTeams?: TeamsSdkLike;
}

export class TeamsSsoAuthProvider implements Microsoft365AuthProvider, TeamsContextProvider {
  constructor(private readonly logger?: Logger) {}

  async getAccessToken(request: AccessTokenRequest): Promise<AccessTokenResult> {
    try {
      await withTimeout(initializeTeamsApp(), 5_000).catch(() => undefined);
      const teamsSdk = getTeamsSdk();
      const getAuthToken = teamsSdk?.authentication?.getAuthToken;

      if (!getAuthToken) {
        return failure("forbidden", "Microsoft Teams SSO is not available in the current host.", false);
      }

      const resources = toTeamsResources(request.scopes);
      const tokenPromise = resources.length > 0
        ? getAuthToken({ resources })
        : getAuthToken();
      // getAuthToken can hang indefinitely on host/AAD misconfiguration; never block the UI forever.
      const token = await withTimeout(Promise.resolve(tokenPromise), 10_000);

      if (typeof token !== "string" || token.trim().length === 0) {
        return failure("unknown", "Microsoft Teams SSO returned an empty access token.", true);
      }

      return { ok: true, value: { token } };
    } catch (error: unknown) {
      this.logger?.error("Microsoft Teams SSO token acquisition failed.", {
        source: "infrastructure",
        component: "TeamsSsoAuthProvider",
        operation: "getAccessToken"
      }, error);

      return failure("forbidden", "Microsoft Teams SSO token acquisition failed.", true, { error });
    }
  }

  async getContext(): Promise<TeamsContextResult> {
    try {
      await withTimeout(initializeTeamsApp(), 5_000).catch(() => undefined);
      const teamsSdk = getTeamsSdk();
      // EO-421: like initialize above, getContext never settles in a non-Teams
      // iframe host (handshake pending) — guard it so bootstrap always proceeds.
      const context = await withTimeout(
        Promise.resolve(teamsSdk?.app?.getContext?.() ?? teamsSdk?.context),
        5_000
      ).catch(() => undefined);

      if (!context) {
        // EO-428: report the missing context instead of substituting a team. This used to return a
        // specific tenant's group id as a "local development fallback", which meant every host
        // without Teams context silently claimed to be that team — including the personal app
        // scope in production, where a caller who is not a member then got a permission error.
        this.logger?.warn("Microsoft Teams context is not available in the current host.", {
          source: "infrastructure",
          component: "TeamsSsoAuthProvider",
          operation: "getContext",
          details: { isLikelyTeamsHost: (window.self !== window.top || window.location.search.toLowerCase().includes("teams")) }
        });
        return failure(
          "noTeamContext",
          "Microsoft Teams context is not available in the current host.",
          true
        );
      }

      return {
        ok: true,
        value: normalizeContext(context)
      };
    } catch (error: unknown) {
      this.logger?.error("Microsoft Teams context resolution failed.", {
        source: "infrastructure",
        component: "TeamsSsoAuthProvider",
        operation: "getContext"
      }, error);

      return failure("unknown", "Microsoft Teams context resolution failed.", true, { error });
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`Teams SSO token acquisition timed out after ${timeoutMs}ms.`)),
      timeoutMs
    );

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function getTeamsSdk(): TeamsSdkLike | undefined {
  return (window as M365Window).microsoftTeams;
}

function normalizeContext(context: TeamsAppContext): TeamsContext {
  return {
    groupId: context.team?.groupId ?? context.groupId,
    locale: context.app?.locale ?? context.locale,
    teamId: context.team?.internalId ?? context.teamId,
    teamName: context.team?.displayName ?? context.teamName,
    userId: context.user?.id ?? context.userObjectId
  };
}

function toTeamsResources(scopes: readonly string[]): readonly string[] {
  const resources = scopes
    .map((scope) => {
      const schemeIndex = scope.indexOf("://");

      if (schemeIndex < 0) {
        return undefined;
      }

      const lastSlashIndex = scope.lastIndexOf("/");

      if (lastSlashIndex <= schemeIndex + 2) {
        return scope;
      }

      return scope.slice(0, lastSlashIndex);
    })
    .filter((resource): resource is string => typeof resource === "string" && resource.length > 0);

  return [...new Set(resources)];
}

function failure(
  code: RepositoryError["code"],
  message: string,
  recoverable: boolean,
  details?: Record<string, unknown>
): AccessTokenResult & TeamsContextResult {
  return {
    ok: false,
    error: {
      code,
      details,
      message,
      recoverable
    }
  };
}
