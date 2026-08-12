import type { Logger } from "../../../core/logging";
import { createMicrosoft365ClientFoundation } from "../../../infrastructure/microsoft365";
import {
  validateApiBaseUrl,
  validateSharePointSiteUrl,
  type ResolvedRuntimeConfiguration,
  type RuntimeConfiguration
} from "../../../infrastructure/deployment/runtimeConfig";
import { createMockPlanningRepositories } from "../../../repositories/mockPlanningRepositories";
import { resilientFetch } from "../../../infrastructure/http/resilientFetch";

export type ConnectionTestStatus = "healthy" | "failed";

export interface ConnectionTestResult {
  readonly status: ConnectionTestStatus;
  readonly latencyMs: number;
  readonly detailCode?: string;
}

const apiHealthProbeTimeoutMs = 10000;

export async function testMockConnection(): Promise<ConnectionTestResult> {
  const startedAt = performance.now();

  try {
    const repositories = createMockPlanningRepositories();
    const result = await repositories.absences.listAbsences({ pageSize: 1 });

    return {
      status: result.ok ? "healthy" : "failed",
      latencyMs: Math.round(performance.now() - startedAt),
      detailCode: result.ok ? undefined : result.error.code
    };
  } catch {
    return {
      status: "failed",
      latencyMs: Math.round(performance.now() - startedAt),
      detailCode: "unknown"
    };
  }
}

export async function testSharePointConnection(
  siteUrl: string | undefined,
  logger?: Logger
): Promise<ConnectionTestResult> {
  const startedAt = performance.now();
  const trustedSiteUrl = validateSharePointSiteUrl(siteUrl);

  if (!trustedSiteUrl) {
    return { status: "failed", latencyMs: 0, detailCode: "invalid-url" };
  }

  const foundation = createMicrosoft365ClientFoundation({ sharePointSiteUrl: trustedSiteUrl }, logger);
  const client = foundation.createSharePointClient();

  if (!client) {
    return { status: "failed", latencyMs: 0, detailCode: "not-configured" };
  }

  const result = await client.get<{ readonly Title?: string }>("/_api/web?$select=Title");

  return {
    status: result.ok ? "healthy" : "failed",
    latencyMs: Math.round(performance.now() - startedAt),
    detailCode: result.ok ? undefined : result.error.code
  };
}

export async function testApiConnection(apiBaseUrl: string | undefined): Promise<ConnectionTestResult> {
  const startedAt = performance.now();
  const trustedApiBaseUrl = validateApiBaseUrl(apiBaseUrl);

  if (!trustedApiBaseUrl) {
    return { status: "failed", latencyMs: 0, detailCode: "invalid-url" };
  }

  const abortController = new AbortController();
  const timeoutHandle = window.setTimeout(() => abortController.abort(), apiHealthProbeTimeoutMs);

  try {
    const response = await resilientFetch(`${trustedApiBaseUrl}/health`, {
      headers: { Accept: "application/json" },
      signal: abortController.signal
    }, {
      component: "appConfigService",
      operation: "testApiConnection"
    });

    return {
      status: response.ok ? "healthy" : "failed",
      latencyMs: Math.round(performance.now() - startedAt),
      detailCode: response.ok ? undefined : `http-${response.status}`
    };
  } catch (error: unknown) {
    return {
      status: "failed",
      latencyMs: Math.round(performance.now() - startedAt),
      detailCode: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network"
    };
  } finally {
    window.clearTimeout(timeoutHandle);
  }
}

export function generateRuntimeConfigScript(
  configuration: RuntimeConfiguration | ResolvedRuntimeConfiguration
): string {
  // When the effective session forced mock for a plain browser, export the underlying
  // deployment providers so a downloaded runtime-config.js still targets Teams correctly.
  const deployment =
    typeof window !== "undefined" ? window.__RESOURCE_PRESENCE_PLANNER_CONFIG__ : undefined;
  const origins = "origins" in configuration ? configuration.origins : undefined;
  const useDeploymentProviders = origins?.planningDataSource === "standaloneBrowser";

  const exportedConfiguration = {
    environmentName: configuration.environmentName,
    planningMembershipSource: useDeploymentProviders
      ? (deployment?.planningMembershipSource ?? configuration.planningMembershipSource)
      : configuration.planningMembershipSource,
    planningDataSource: useDeploymentProviders
      ? (deployment?.planningDataSource ?? configuration.planningDataSource)
      : configuration.planningDataSource,
    approvalMode: useDeploymentProviders
      ? (deployment?.approvalMode ?? configuration.approvalMode)
      : configuration.approvalMode,
    standaloneBrowserUsesMock: configuration.standaloneBrowserUsesMock,
    approvalFlowUrl: configuration.approvalFlowUrl ?? "",
    sharePointSiteUrl: configuration.sharePointSiteUrl ?? "",
    apiBaseUrl: configuration.apiBaseUrl ?? "",
    apiAccessTokenScopes: configuration.apiAccessTokenScopes,
    healthCheckUrl: configuration.healthCheckUrl ?? "",
    releaseVersion: configuration.releaseVersion,
    sourceRevision: configuration.sourceRevision
  };

  return `window.__RESOURCE_PRESENCE_PLANNER_CONFIG__ = ${JSON.stringify(exportedConfiguration, null, 2)};\n`;
}

export function downloadRuntimeConfigScript(
  configuration: RuntimeConfiguration | ResolvedRuntimeConfiguration
): void {
  const script = generateRuntimeConfigScript(configuration);
  const blob = new Blob([script], { type: "text/javascript;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = "runtime-config.js";
  anchor.click();
  window.URL.revokeObjectURL(url);
}
