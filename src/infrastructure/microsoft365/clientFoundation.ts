import type { Logger } from "../../core/logging";
import { resolveHostAdapter } from "../host";
import {
  sharePointPermissionScopes,
  type AccessTokenRequest,
  type AccessTokenResult,
  type Microsoft365AuthProvider,
  type TeamsContextProvider,
  type TeamsContextResult
} from "./authContracts";
import { FetchMicrosoftGraphClient, type MicrosoftGraphClient } from "./graphClient";
import { FetchSharePointClient, type SharePointClient } from "./sharePointClient";

export interface Microsoft365ClientFoundationConfiguration {
  readonly sharePointSiteUrl?: string;
}

export interface Microsoft365ClientFoundation {
  readonly authProvider: Microsoft365AuthProvider;
  readonly teamsContextProvider: TeamsContextProvider;
  createGraphClient(): MicrosoftGraphClient;
  createSharePointClient(): SharePointClient | undefined;
}

/**
 * EO-455: foundation auth and context come from the session host adapter
 * (Teams SSO, SharePoint bridge, or browser). Creation stays synchronous; the
 * host is resolved on first use.
 */
export function createMicrosoft365ClientFoundation(
  configuration: Microsoft365ClientFoundationConfiguration = {},
  logger?: Logger
): Microsoft365ClientFoundation {
  const authProvider = new HostBackedAuthProvider(logger);
  const teamsContextProvider = new HostBackedContextProvider(logger);

  return {
    authProvider,
    teamsContextProvider,
    createGraphClient: () => new FetchMicrosoftGraphClient(authProvider, logger),
    createSharePointClient: () => {
      if (!configuration.sharePointSiteUrl) {
        logger?.warn("SharePoint client was requested without a configured site URL.", {
          source: "infrastructure",
          component: "Microsoft365ClientFoundation",
          operation: "createSharePointClient"
        });

        return undefined;
      }

      return new FetchSharePointClient({
        siteUrl: configuration.sharePointSiteUrl,
        defaultScopes: [sharePointPermissionScopes.sitesReadAll]
      }, authProvider, logger);
    }
  };
}

class HostBackedAuthProvider implements Microsoft365AuthProvider {
  private inner?: Microsoft365AuthProvider;

  constructor(private readonly logger?: Logger) {}

  async getAccessToken(request: AccessTokenRequest): Promise<AccessTokenResult> {
    this.inner ??= (await resolveHostAdapter(this.logger)).getAuthProvider();
    return this.inner.getAccessToken(request);
  }
}

class HostBackedContextProvider implements TeamsContextProvider {
  constructor(private readonly logger?: Logger) {}

  async getContext(): Promise<TeamsContextResult> {
    try {
      const host = await resolveHostAdapter(this.logger);
      const context = await host.getContext();

      if (!context?.userId && !context?.teamId) {
        return {
          ok: false,
          error: {
            code: "noTeamContext",
            message: "Host context is not available.",
            recoverable: true
          }
        };
      }

      return {
        ok: true,
        value: {
          userId: context.userId,
          teamId: context.teamId,
          teamName: context.teamName,
          groupId: context.teamId,
          locale: context.locale
        }
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: {
          code: "unknown",
          message: "Host context resolution failed.",
          recoverable: true,
          details: { error }
        }
      };
    }
  }
}
