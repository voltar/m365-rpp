import { getRuntimeConfiguration } from "../../../infrastructure/deployment/runtimeConfig";
import { createMicrosoft365ClientFoundation } from "../../../infrastructure/microsoft365";
import type { Logger } from "../../../core/logging";
import { resilientFetch } from "../../../infrastructure/http/resilientFetch";

export interface MailboxSyncStatus {
  readonly enabled: boolean;
  readonly isRunning: boolean;
  readonly lastSyncStartedAt: string | null;
  readonly lastSyncCompletedAt: string | null;
  readonly messagesProcessed: number;
  readonly absencesCreated: number;
  readonly absencesUpdated: number;
  readonly absencesDeleted: number;
  readonly errors: number;
  readonly skipped: number;
  /**
   * Why the last cycle failed, when it did. The API has reported this since the rejected Graph
   * call stopped being swallowed; without it the screen could only show a row of zeros, which
   * reads the same whether the mailbox was empty or Graph refused the query outright.
   */
  readonly lastError: string | null;
  readonly entries: readonly MailboxSyncEntry[];
}

export interface MailboxSyncEntry {
  readonly messageId: string | null;
  readonly messageSubject: string | null;
  readonly action: string | null;
  readonly employeeId: string | null;
  readonly detail: string | null;
}

export interface MailboxSyncConfig {
  readonly mailboxAddress: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const configuration = getRuntimeConfiguration();

    if (configuration.apiAccessTokenScopes.length === 0) {
      return {};
    }

    const foundation = createMicrosoft365ClientFoundation({});
    const tokenResult = await foundation.authProvider.getAccessToken({
      scopes: configuration.apiAccessTokenScopes
    });

    return tokenResult.ok && tokenResult.value.token
      ? { Authorization: `Bearer ${tokenResult.value.token}` }
      : {};
  } catch {
    return {};
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}, logger?: Logger): Promise<T | null> {
  const configuration = getRuntimeConfiguration(logger);
  const baseUrl = configuration.apiBaseUrl?.replace(/\/+$/, "") ?? "";

  if (!baseUrl) {
    logger?.warn("No API base URL configured. Cannot call mailbox sync API.", {
      source: "app-admin",
      component: "mailboxSyncService",
      operation: "apiFetch"
    });
    return null;
  }

  const headers = await getAuthHeaders();

  try {
    const response = await resilientFetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...headers,
        ...(options.headers as Record<string, string> | undefined)
      }
    }, {
      component: "mailboxSyncService",
      operation: options.method?.toLowerCase() ?? "get",
      logger
    });

    if (!response.ok) {
      logger?.warn(`Mailbox sync API returned HTTP ${response.status}`, {
        source: "app-admin",
        component: "mailboxSyncService",
        operation: "apiFetch",
        details: { path, status: response.status }
      });
      return null;
    }

    return (await response.json()) as T;
  } catch (error: unknown) {
    logger?.warn("Mailbox sync API call failed.", {
      source: "app-admin",
      component: "mailboxSyncService",
      operation: "apiFetch",
      details: { path, error: String(error) }
    });
    return null;
  }
}

export async function getMailboxSyncStatus(logger?: Logger): Promise<MailboxSyncStatus> {
  const result = await apiFetch<MailboxSyncStatus>("/api/admin/mailbox-sync/status", {}, logger);
  return result ?? emptyStatus();
}

export async function triggerMailboxSync(logger?: Logger): Promise<MailboxSyncStatus> {
  const result = await apiFetch<MailboxSyncStatus>(
    "/api/admin/mailbox-sync/trigger",
    { method: "POST" },
    logger
  );
  return result ?? emptyStatus();
}

export async function getMailboxSyncConfig(logger?: Logger): Promise<MailboxSyncConfig> {
  const result = await apiFetch<MailboxSyncConfig>("/api/admin/mailbox-sync/settings", {}, logger);
  return result ?? { mailboxAddress: "" };
}

export async function updateMailboxSyncConfig(
  mailboxAddress: string,
  logger?: Logger
): Promise<MailboxSyncConfig | null> {
  return apiFetch<MailboxSyncConfig>(
    "/api/admin/mailbox-sync/settings",
    {
      method: "PATCH",
      body: JSON.stringify({ mailboxAddress })
    },
    logger
  );
}

function emptyStatus(): MailboxSyncStatus {
  return {
    enabled: false,
    isRunning: false,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    messagesProcessed: 0,
    absencesCreated: 0,
    absencesUpdated: 0,
    absencesDeleted: 0,
    errors: 0,
    skipped: 0,
    lastError: null,
    entries: []
  };
}
