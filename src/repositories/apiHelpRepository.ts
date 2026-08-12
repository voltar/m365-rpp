import type { Logger } from "../core/logging";
import { getRuntimeConfiguration } from "../infrastructure/deployment/runtimeConfig";
import {
  createMicrosoft365ClientFoundation,
  type Microsoft365ClientFoundation
} from "../infrastructure/microsoft365";
import { resolveActiveTeamId } from "../infrastructure/microsoft365/currentUser";
import type { HelpChatAnswer, HelpChatRequest, HelpFeedback } from "../models/helpAssistant";
import type { HelpRepository } from "./helpRepositories";
import type { RepositoryError, RepositoryResult } from "./planningRepositories";
import { resilientFetch } from "../infrastructure/http/resilientFetch";

/**
 * EO-450 FR-450.4: calls the RPP Web API, which reaches the Foundry Agent
 * Service via Managed Identity. No AI endpoint and no key is ever known to the
 * browser - the client only ever sees its own backend.
 */
export class ApiHelpRepository implements HelpRepository {
  private readonly baseUrl: string;
  private readonly logger?: Logger;
  private foundation?: Microsoft365ClientFoundation;

  constructor(baseUrl: string, logger?: Logger) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.logger = logger;
  }

  async askQuestion(request: HelpChatRequest): Promise<RepositoryResult<HelpChatAnswer>> {
    // EO-450 FR-450.5: the workspace comes from the resolved Teams context, not from the
    // UI - the component layer must not reach into the Microsoft 365 infrastructure.
    const workspaceId = (await resolveActiveTeamId(this.logger)) ?? undefined;

    return this.postJson<HelpChatAnswer>("/api/help/chat", {
      question: request.question,
      context: { ...request.context, workspaceId },
      // Only the transcript is sent; message ids and local feedback stay client-side.
      history: request.history.map((message) => ({
        author: message.author,
        content: message.content
      }))
    });
  }

  async submitFeedback(feedback: HelpFeedback): Promise<RepositoryResult<void>> {
    return this.postJson<void>("/api/help/feedback", {
      messageId: feedback.messageId,
      rating: feedback.rating,
      context: feedback.context
    });
  }

  private async postJson<T>(path: string, body: unknown): Promise<RepositoryResult<T>> {
    try {
      const authResult = await this.getApiToken();
      const activeTeamId = await resolveActiveTeamId(this.logger);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json"
      };

      if (authResult.ok && authResult.value.token) {
        headers.Authorization = `Bearer ${authResult.value.token}`;
      }

      if (activeTeamId) {
        headers["X-RPP-Active-TeamId"] = activeTeamId;
      }

      const response = await resilientFetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(body)
      }, {
        component: "ApiHelpRepository",
        operation: "post",
        logger: this.logger
      });

      if (!response.ok) {
        const code: RepositoryError["code"] =
          response.status === 404 ? "notFound"
          : response.status === 401 || response.status === 403 ? "forbidden"
          : response.status === 408 || response.status === 504 ? "timeout"
          : "unknown";

        return {
          ok: false,
          error: {
            code,
            message: `HTTP ${response.status}`,
            recoverable:
              response.status === 429 ||
              response.status >= 500 ||
              response.status === 408 ||
              response.status === 504
          }
        };
      }

      if (response.status === 204) {
        return { ok: true, value: undefined as T };
      }

      return { ok: true, value: (await response.json()) as T };
    } catch (error) {
      this.logger?.error(
        "Help assistant request failed.",
        {
          source: "repository",
          component: "ApiHelpRepository",
          operation: "postJson",
          details: { path }
        },
        error
      );

      return {
        ok: false,
        error: { code: "network", message: "Help assistant request failed.", recoverable: true }
      };
    }
  }

  private async getApiToken(): Promise<{ readonly ok: false } | { readonly ok: true; readonly value: { readonly token: string } }> {
    // EO-405: inside Teams the SSO token (audience = the RPP API app registration) is attached
    // as a Bearer token. Outside Teams SSO is unavailable and the request continues
    // unauthenticated, relying on the server-side development bypass.
    try {
      const { apiAccessTokenScopes } = getRuntimeConfiguration(this.logger);

      if (apiAccessTokenScopes.length === 0) {
        return { ok: false };
      }

      this.foundation ??= createMicrosoft365ClientFoundation({}, this.logger);

      const tokenResult = await this.foundation.authProvider.getAccessToken({ scopes: apiAccessTokenScopes });

      if (tokenResult.ok && tokenResult.value.token) {
        return { ok: true, value: { token: tokenResult.value.token } };
      }

      return { ok: false };
    } catch {
      this.logger?.warn("Help assistant token acquisition failed - continuing unauthenticated.", {
        source: "repository",
        component: "ApiHelpRepository",
        operation: "getApiToken"
      });

      return { ok: false };
    }
  }
}

export function createApiHelpRepository(baseUrl: string, logger?: Logger): HelpRepository {
  return new ApiHelpRepository(baseUrl, logger);
}
