import type { Logger } from "../../core/logging";
import { createSafeErrorDetails, createSecurityRepositoryError, createTrustedServiceUrl } from "../../core/security";
import type { RepositoryError } from "../../repositories/planningRepositories";
import type { AccessTokenRequest, Microsoft365AuthProvider } from "./authContracts";
import { resilientFetch } from "../http/resilientFetch";

export type GraphResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RepositoryError };

export interface GraphRequestOptions {
  readonly scopes: AccessTokenRequest["scopes"];
}

export interface MicrosoftGraphClient {
  get<T>(path: string, options: GraphRequestOptions): Promise<GraphResult<T>>;
  post<TRequest, TResponse>(path: string, body: TRequest, options: GraphRequestOptions): Promise<GraphResult<TResponse>>;
  patch<TRequest, TResponse>(path: string, body: TRequest, options: GraphRequestOptions): Promise<GraphResult<TResponse>>;
  delete(path: string, options: GraphRequestOptions): Promise<GraphResult<void>>;
}

export class FetchMicrosoftGraphClient implements MicrosoftGraphClient {
  private readonly baseUrl = "https://graph.microsoft.com/v1.0";
  private readonly allowedOrigins = ["https://graph.microsoft.com"];

  constructor(
    private readonly authProvider: Microsoft365AuthProvider,
    private readonly logger?: Logger
  ) {}

  async get<T>(path: string, options: GraphRequestOptions): Promise<GraphResult<T>> {
    return this.request<T>(path, "GET", options);
  }

  async post<TRequest, TResponse>(path: string, body: TRequest, options: GraphRequestOptions): Promise<GraphResult<TResponse>> {
    return this.request<TResponse>(path, "POST", options, body);
  }

  async patch<TRequest, TResponse>(path: string, body: TRequest, options: GraphRequestOptions): Promise<GraphResult<TResponse>> {
    return this.request<TResponse>(path, "PATCH", options, body);
  }

  async delete(path: string, options: GraphRequestOptions): Promise<GraphResult<void>> {
    return this.request<void>(path, "DELETE", options);
  }

  private async request<T>(path: string, method: "DELETE" | "GET" | "PATCH" | "POST", options: GraphRequestOptions, body?: unknown): Promise<GraphResult<T>> {
    const tokenResult = await this.authProvider.getAccessToken({ scopes: options.scopes });

    if (!tokenResult.ok) {
      return tokenResult;
    }

    try {
      const requestUrl = createGraphUrl(path, this.baseUrl, this.allowedOrigins);

      if (!requestUrl.ok || !requestUrl.value) {
        return {
          ok: false,
          error: createSecurityRepositoryError("Microsoft Graph request URL was rejected.", {
            reason: requestUrl.reason,
            path
          })
        };
      }

      const response = await resilientFetch(requestUrl.value, {
        method,
        headers: {
          Authorization: `Bearer ${tokenResult.value.token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      }, {
        component: "FetchMicrosoftGraphClient",
        operation: method.toLowerCase(),
        logger: this.logger
      });

      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: response.status === 404 ? "notFound" : response.status === 403 ? "forbidden" : "unknown",
            details: { status: response.status, statusText: response.statusText },
            message: `Microsoft Graph request failed with status ${response.status}.`,
            recoverable: response.status === 429 || response.status >= 500
          }
        };
      }

      return {
        ok: true,
        value: response.status === 204 ? undefined as T : await response.json() as T
      };
    } catch (error: unknown) {
      this.logger?.error("Microsoft Graph request failed.", {
        source: "infrastructure",
        component: "FetchMicrosoftGraphClient",
        operation: method.toLowerCase(),
        details: { path }
      }, error);

      return {
        ok: false,
        error: {
          code: "network",
          details: { path, error: createSafeErrorDetails(error) },
          message: "Microsoft Graph request failed.",
          recoverable: true
        }
      };
    }
  }
}

function createGraphUrl(pathOrUrl: string, baseUrl: string, allowedOrigins: readonly string[]) {
  return createTrustedServiceUrl(pathOrUrl, baseUrl, allowedOrigins);
}
