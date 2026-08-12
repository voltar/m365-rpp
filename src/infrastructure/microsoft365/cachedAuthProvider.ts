import type { Logger } from "../../core/logging";
import type { AccessToken, AccessTokenRequest, AccessTokenResult, Microsoft365AuthProvider } from "./authContracts";

interface CachedAccessToken {
  readonly token: AccessToken;
  readonly cachedUntil: number;
}

const defaultTokenTtlMs = 5 * 60 * 1000;
const tokenExpirySkewMs = 60 * 1000;

export class CachedMicrosoft365AuthProvider implements Microsoft365AuthProvider {
  private readonly tokensByScopeKey = new Map<string, CachedAccessToken>();

  constructor(
    private readonly innerProvider: Microsoft365AuthProvider,
    private readonly logger?: Logger
  ) {}

  async getAccessToken(request: AccessTokenRequest): Promise<AccessTokenResult> {
    const scopeKey = createScopeKey(request);
    const cachedToken = this.tokensByScopeKey.get(scopeKey);

    if (cachedToken && cachedToken.cachedUntil > Date.now()) {
      this.logger?.debug("Microsoft 365 access token served from cache.", {
        source: "infrastructure",
        component: "CachedMicrosoft365AuthProvider",
        operation: "getAccessToken",
        details: { scopeKey }
      });

      return { ok: true, value: cachedToken.token };
    }

    const tokenResult = await this.innerProvider.getAccessToken(request);

    if (!tokenResult.ok) {
      this.tokensByScopeKey.delete(scopeKey);
      return tokenResult;
    }

    this.tokensByScopeKey.set(scopeKey, {
      token: tokenResult.value,
      cachedUntil: resolveCachedUntil(tokenResult.value)
    });

    return tokenResult;
  }

  clear(): void {
    this.tokensByScopeKey.clear();
  }
}

function createScopeKey(request: AccessTokenRequest): string {
  return [...request.scopes].sort().join(" ");
}

function resolveCachedUntil(token: AccessToken): number {
  if (!token.expiresOn) {
    return Date.now() + defaultTokenTtlMs;
  }

  return Math.max(Date.now(), token.expiresOn.getTime() - tokenExpirySkewMs);
}
