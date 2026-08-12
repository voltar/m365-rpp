import type { Logger } from "../../core/logging";
import type { AccessTokenRequest, AccessTokenResult, Microsoft365AuthProvider } from "./authContracts";

export interface MsalTokenResponse {
  readonly accessToken: string;
  readonly expiresOn?: Date | null;
}

export interface MsalTokenClient {
  acquireTokenSilent(request: { readonly scopes: readonly string[] }): Promise<MsalTokenResponse>;
}

export class MsalAuthProvider implements Microsoft365AuthProvider {
  constructor(
    private readonly tokenClient: MsalTokenClient,
    private readonly logger?: Logger
  ) {}

  async getAccessToken(request: AccessTokenRequest): Promise<AccessTokenResult> {
    try {
      const response = await this.tokenClient.acquireTokenSilent({ scopes: request.scopes });

      if (!response.accessToken) {
        return {
          ok: false,
          error: {
            code: "forbidden",
            message: "MSAL did not return an access token.",
            recoverable: true
          }
        };
      }

      return {
        ok: true,
        value: {
          token: response.accessToken,
          expiresOn: response.expiresOn ?? undefined
        }
      };
    } catch (error: unknown) {
      this.logger?.error("MSAL token acquisition failed.", {
        source: "infrastructure",
        component: "MsalAuthProvider",
        operation: "getAccessToken"
      }, error);

      return {
        ok: false,
        error: {
          code: "forbidden",
          details: { error },
          message: "MSAL token acquisition failed.",
          recoverable: true
        }
      };
    }
  }
}
