import type { Logger } from "../../core/logging";
import { createSafeErrorDetails, createSecurityRepositoryError, createTrustedServiceUrl } from "../../core/security";
import type { RepositoryError } from "../../repositories/planningRepositories";
import type { AccessTokenRequest, Microsoft365AuthProvider } from "./authContracts";
import { resilientFetch } from "../http/resilientFetch";

export type SharePointResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RepositoryError };

export interface SharePointRequestOptions {
  readonly scopes: AccessTokenRequest["scopes"];
}

export interface SharePointClient {
  get<T>(path: string, options?: Partial<SharePointRequestOptions>): Promise<SharePointResult<T>>;
  post<T>(path: string, body: unknown, options?: Partial<SharePointRequestOptions>): Promise<SharePointResult<T>>;
  merge(path: string, body: unknown, options?: Partial<SharePointRequestOptions>): Promise<SharePointResult<void>>;
  delete(path: string, options?: Partial<SharePointRequestOptions>): Promise<SharePointResult<void>>;
}

export interface SharePointClientConfiguration {
  readonly siteUrl: string;
  readonly defaultScopes: AccessTokenRequest["scopes"];
}

interface SharePointSendOptions {
  readonly method: "GET" | "POST";
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly scopes?: AccessTokenRequest["scopes"];
}

export class FetchSharePointClient implements SharePointClient {
  constructor(
    private readonly configuration: SharePointClientConfiguration,
    private readonly authProvider: Microsoft365AuthProvider,
    private readonly logger?: Logger
  ) {}

  async get<T>(path: string, options?: Partial<SharePointRequestOptions>): Promise<SharePointResult<T>> {
    return this.send<T>(path, { method: "GET", scopes: options?.scopes }, "get");
  }

  async post<T>(path: string, body: unknown, options?: Partial<SharePointRequestOptions>): Promise<SharePointResult<T>> {
    return this.send<T>(path, { method: "POST", body, scopes: options?.scopes }, "post");
  }

  async merge(path: string, body: unknown, options?: Partial<SharePointRequestOptions>): Promise<SharePointResult<void>> {
    return this.send<void>(path, {
      method: "POST",
      body,
      headers: { "IF-MATCH": "*", "X-HTTP-Method": "MERGE" },
      scopes: options?.scopes
    }, "merge");
  }

  async delete(path: string, options?: Partial<SharePointRequestOptions>): Promise<SharePointResult<void>> {
    return this.send<void>(path, {
      method: "POST",
      headers: { "IF-MATCH": "*", "X-HTTP-Method": "DELETE" },
      scopes: options?.scopes
    }, "delete");
  }

  private async send<T>(path: string, options: SharePointSendOptions, operation: string): Promise<SharePointResult<T>> {
    const tokenResult = await this.authProvider.getAccessToken({
      scopes: options.scopes ?? this.configuration.defaultScopes
    });

    if (!tokenResult.ok) {
      return tokenResult;
    }

    const urlResult = createSharePointUrl(path, this.configuration.siteUrl);

    if (!urlResult.ok || !urlResult.value) {
      return {
        ok: false,
        error: createSecurityRepositoryError("SharePoint request URL was rejected.", {
          reason: urlResult.reason,
          path
        })
      };
    }

    try {
      const response = await resilientFetch(urlResult.value, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${tokenResult.value.token}`,
          Accept: "application/json;odata=nometadata",
          ...(options.body !== undefined ? { "Content-Type": "application/json;odata=nometadata" } : {}),
          ...options.headers
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined
      }, {
        component: "FetchSharePointClient",
        operation,
        logger: this.logger
      });

      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: response.status === 404 ? "notFound" : response.status === 403 ? "forbidden" : "unknown",
            details: { status: response.status, statusText: response.statusText },
            message: `SharePoint request failed with status ${response.status}.`,
            recoverable: response.status === 429 || response.status >= 500
          }
        };
      }

      if (response.status === 204 || response.headers.get("Content-Length") === "0") {
        return { ok: true, value: undefined as T };
      }

      const responseText = await response.text();

      if (!responseText) {
        return { ok: true, value: undefined as T };
      }

      return {
        ok: true,
        value: JSON.parse(responseText) as T
      };
    } catch (error: unknown) {
      this.logger?.error("SharePoint request failed.", {
        source: "infrastructure",
        component: "FetchSharePointClient",
        operation,
        details: { path }
      }, error);

      return {
        ok: false,
        error: {
          code: "network",
          details: { path, error: createSafeErrorDetails(error) },
          message: "SharePoint request failed.",
          recoverable: true
        }
      };
    }
  }
}

function createSharePointUrl(pathOrUrl: string, siteUrl: string) {
  let origin: string;

  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return { ok: false, reason: "invalid-site-url" };
  }

  return createTrustedServiceUrl(pathOrUrl, siteUrl, [origin]);
}

export function createSharePointListItemsPath(
  listTitle: string,
  query: Readonly<Record<string, string | number | undefined>> = {}
): string {
  const queryParameters = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      queryParameters.set(key, `${value}`);
    }
  });

  const encodedListTitle = listTitle.replace(/'/g, "''");
  const queryString = queryParameters.toString();

  return `/_api/web/lists/getbytitle('${encodedListTitle}')/items${queryString ? `?${queryString}` : ""}`;
}

export function createSharePointListItemPath(listTitle: string, itemId: number): string {
  const encodedListTitle = listTitle.replace(/'/g, "''");

  return `/_api/web/lists/getbytitle('${encodedListTitle}')/items(${itemId})`;
}
