import type { Logger } from "../../core/logging";
import { detectHostKind } from "../host/detectHostKind";
import { validateCriticalRuntimeConfiguration } from "./runtimeConfigValidation.js";

export type PlanningMembershipSource = "mock" | "graph";
export type PlanningDataSource = "mock" | "sharepoint" | "api";
export type ApprovalMode = "mock" | "m365";

export type ConfigurationOrigin =
  | "localOverride"
  | "deployment"
  | "build"
  | "default"
  /** Effective only outside Teams/SharePoint when standaloneBrowserUsesMock is enabled. */
  | "standaloneBrowser";

const allowedSharePointHostPattern = /^[a-z0-9-]+\.sharepoint\.com$/i;
const allowedApprovalFlowHostPattern = /(^|\.)logic\.azure\.com$|(^|\.)api\.powerplatform\.com$/i;
const localOverrideStorageKey = "resourcePresencePlanner.runtimeConfig.override";
const localOverrideStorageVersion = 1;

export interface RuntimeConfiguration {
  readonly environmentName: string;
  readonly planningMembershipSource: PlanningMembershipSource;
  readonly planningDataSource: PlanningDataSource;
  readonly approvalMode: ApprovalMode;
  /**
   * When true, a standalone browser session (not Teams, not SharePoint) uses mock
   * data/membership/approval even if the deployment targets api/m365. Teams keeps
   * the real providers. Local overrides still win. Typical for public demo hosts
   * such as rpp.example.com where browser visitors should see the mock product.
   */
  readonly standaloneBrowserUsesMock: boolean;
  readonly approvalFlowUrl?: string;
  readonly sharePointSiteUrl?: string;
  readonly apiBaseUrl?: string;
  readonly apiAccessTokenScopes: readonly string[];
  readonly healthCheckUrl?: string;
  readonly releaseVersion: string;
  readonly sourceRevision: string;
}

export type RuntimeConfigurationOrigins = {
  readonly [K in keyof RuntimeConfiguration]-?: ConfigurationOrigin;
};

export interface ResolvedRuntimeConfiguration extends RuntimeConfiguration {
  readonly origins: RuntimeConfigurationOrigins;
}

export type RuntimeConfigurationFailureCode =
  | "missingDeploymentConfiguration"
  | "invalidPlanningDataSource"
  | "invalidApiBaseUrl"
  | "invalidSharePointSiteUrl";

export type RuntimeConfigurationResult =
  | { readonly ok: true; readonly value: ResolvedRuntimeConfiguration }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: RuntimeConfigurationFailureCode;
        readonly message: string;
      };
    };

export class RuntimeConfigurationError extends Error {
  constructor(
    readonly code: RuntimeConfigurationFailureCode,
    message: string
  ) {
    super(message);
    this.name = "RuntimeConfigurationError";
  }
}

interface RuntimeConfigurationInput {
  readonly environmentName?: string;
  readonly planningMembershipSource?: string;
  readonly planningDataSource?: string;
  readonly approvalMode?: string;
  readonly standaloneBrowserUsesMock?: boolean | string;
  readonly approvalFlowUrl?: string;
  readonly sharePointSiteUrl?: string;
  readonly apiBaseUrl?: string;
  readonly apiAccessTokenScopes?: string | readonly string[];
  readonly healthCheckUrl?: string;
  readonly releaseVersion?: string;
  readonly sourceRevision?: string;
}

export interface LocalConfigurationOverride {
  readonly planningDataSource?: string;
  readonly planningMembershipSource?: string;
  readonly approvalMode?: string;
  readonly approvalFlowUrl?: string;
  readonly sharePointSiteUrl?: string;
  readonly apiBaseUrl?: string;
}

interface LocalOverrideEnvelope {
  readonly version: number;
  readonly value: LocalConfigurationOverride;
}

declare global {
  interface Window {
    readonly __RESOURCE_PRESENCE_PLANNER_CONFIG__?: RuntimeConfigurationInput;
  }
}

interface ConfigurationCandidate {
  readonly origin: ConfigurationOrigin;
  readonly raw: string | undefined;
}

export function tryGetRuntimeConfiguration(logger?: Logger): RuntimeConfigurationResult {
  const isBrowser = typeof window !== "undefined";
  const deployment = isBrowser ? window.__RESOURCE_PRESENCE_PLANNER_CONFIG__ : undefined;
  const override = loadLocalConfigurationOverride();
  const resolvedConfiguration = resolveRuntimeConfigurationValues(deployment, override, logger);
  const criticalFailure = validateCriticalRuntimeConfiguration({
    isBrowser,
    deploymentPresent: deployment !== undefined,
    planningDataSource:
      resolvedConfiguration.origins.planningDataSource === "default"
        ? undefined
        : resolvedConfiguration.planningDataSource,
    apiBaseUrlValid: resolvedConfiguration.apiBaseUrl !== undefined,
    sharePointSiteUrlValid: resolvedConfiguration.sharePointSiteUrl !== undefined
  });

  if (criticalFailure) {
    return configurationFailure(criticalFailure.code, criticalFailure.message);
  }

  return {
    ok: true,
    value: resolvedConfiguration
  };
}

export function getRuntimeConfiguration(logger?: Logger): ResolvedRuntimeConfiguration {
  const result = tryGetRuntimeConfiguration(logger);

  if (!result.ok) {
    throw new RuntimeConfigurationError(result.error.code, result.error.message);
  }

  return result.value;
}

function resolveRuntimeConfigurationValues(
  deployment: RuntimeConfigurationInput | undefined,
  override: LocalConfigurationOverride | undefined,
  logger?: Logger
): ResolvedRuntimeConfiguration {

  const planningDataSource = resolveValue(
    "planningDataSource",
    [
      { origin: "localOverride", raw: override?.planningDataSource },
      { origin: "deployment", raw: deployment?.planningDataSource },
      { origin: "build", raw: import.meta.env.VITE_PLANNING_DATA_SOURCE }
    ],
    parsePlanningDataSource,
    "mock",
    logger
  );

  const planningMembershipSource = resolveValue(
    "planningMembershipSource",
    [
      { origin: "localOverride", raw: override?.planningMembershipSource },
      { origin: "deployment", raw: deployment?.planningMembershipSource },
      { origin: "build", raw: import.meta.env.VITE_PLANNING_MEMBERSHIP_SOURCE }
    ],
    parsePlanningMembershipSource,
    "mock",
    logger
  );

  const approvalMode = resolveValue(
    "approvalMode",
    [
      { origin: "localOverride", raw: override?.approvalMode },
      { origin: "deployment", raw: deployment?.approvalMode },
      { origin: "build", raw: import.meta.env.VITE_APPROVAL_MODE }
    ],
    parseApprovalMode,
    "mock",
    logger
  );

  const approvalFlowUrl = resolveValue(
    "approvalFlowUrl",
    [
      { origin: "localOverride", raw: override?.approvalFlowUrl },
      { origin: "deployment", raw: deployment?.approvalFlowUrl },
      { origin: "build", raw: import.meta.env.VITE_APPROVAL_FLOW_URL }
    ],
    validateApprovalFlowUrl,
    undefined,
    logger
  );

  const sharePointSiteUrl = resolveValue(
    "sharePointSiteUrl",
    [
      { origin: "localOverride", raw: override?.sharePointSiteUrl },
      { origin: "deployment", raw: deployment?.sharePointSiteUrl },
      { origin: "build", raw: import.meta.env.VITE_SHAREPOINT_SITE_URL }
    ],
    validateSharePointSiteUrl,
    undefined,
    logger
  );

  const apiBaseUrl = resolveValue(
    "apiBaseUrl",
    [
      { origin: "localOverride", raw: override?.apiBaseUrl },
      { origin: "deployment", raw: deployment?.apiBaseUrl },
      { origin: "build", raw: import.meta.env.VITE_API_BASE_URL }
    ],
    validateApiBaseUrl,
    undefined,
    logger
  );

  const apiAccessTokenScopes = resolveScopeListValue(
    [
      { origin: "deployment", raw: deployment?.apiAccessTokenScopes },
      { origin: "build", raw: import.meta.env.VITE_API_ACCESS_TOKEN_SCOPES }
    ],
    [],
    logger
  );

  const environmentName = resolveValue(
    "environmentName",
    [
      { origin: "deployment", raw: deployment?.environmentName },
      { origin: "build", raw: import.meta.env.VITE_DEPLOYMENT_ENVIRONMENT }
    ],
    parseNonEmptyString,
    "local",
    logger
  );

  const healthCheckUrl = resolveValue(
    "healthCheckUrl",
    [
      { origin: "deployment", raw: deployment?.healthCheckUrl },
      { origin: "build", raw: import.meta.env.VITE_HEALTH_CHECK_URL }
    ],
    validateRelativeUrl,
    undefined,
    logger
  );

  const releaseVersion = resolveValue(
    "releaseVersion",
    [
      { origin: "deployment", raw: deployment?.releaseVersion },
      { origin: "build", raw: import.meta.env.VITE_RELEASE_VERSION }
    ],
    parseNonEmptyString,
    "local",
    logger
  );

  const sourceRevision = resolveValue(
    "sourceRevision",
    [
      { origin: "deployment", raw: deployment?.sourceRevision },
      { origin: "build", raw: import.meta.env.VITE_SOURCE_REVISION }
    ],
    parseNonEmptyString,
    "local",
    logger
  );

  const standaloneBrowserUsesMock = resolveStandaloneBrowserUsesMock(deployment, logger);

  let effectivePlanningDataSource = planningDataSource;
  let effectivePlanningMembershipSource = planningMembershipSource;
  let effectiveApprovalMode = approvalMode;

  // Public demo hosts (e.g. rpp.example.com): plain browser → mock; Teams/SharePoint keep
  // deployment providers (api/m365). Host kind is the gate — not top-level alone. Teams desktop
  // often runs the tab as a top-level WebView (self === top); treating that as "browser" forced
  // mock inside Teams. detectHostKind no longer treats chat referrers or window.microsoftTeams
  // as Teams (those false positives are fixed). Prefer contentUrl ?host=teams as a hard signal.
  // Local overrides still win.
  const hostKind = detectHostKind();
  if (standaloneBrowserUsesMock.value && hostKind === "browser") {
    if (planningDataSource.origin !== "localOverride") {
      effectivePlanningDataSource = { value: "mock", origin: "standaloneBrowser" };
    }

    if (planningMembershipSource.origin !== "localOverride") {
      effectivePlanningMembershipSource = { value: "mock", origin: "standaloneBrowser" };
    }

    if (approvalMode.origin !== "localOverride") {
      effectiveApprovalMode = { value: "mock", origin: "standaloneBrowser" };
    }

    logger?.info("Standalone browser session uses mock providers.", {
      source: "infrastructure",
      component: "runtimeConfig",
      operation: "applyStandaloneBrowserMock",
      details: {
        hostKind,
        deploymentPlanningDataSource: planningDataSource.value,
        effectivePlanningDataSource: effectivePlanningDataSource.value
      }
    });
  }

  return {
    environmentName: environmentName.value,
    planningMembershipSource: effectivePlanningMembershipSource.value,
    planningDataSource: effectivePlanningDataSource.value,
    approvalMode: effectiveApprovalMode.value,
    standaloneBrowserUsesMock: standaloneBrowserUsesMock.value,
    approvalFlowUrl: approvalFlowUrl.value,
    sharePointSiteUrl: sharePointSiteUrl.value,
    apiBaseUrl: apiBaseUrl.value,
    apiAccessTokenScopes: apiAccessTokenScopes.value,
    healthCheckUrl: healthCheckUrl.value,
    releaseVersion: releaseVersion.value,
    sourceRevision: sourceRevision.value,
    origins: {
      environmentName: environmentName.origin,
      planningMembershipSource: effectivePlanningMembershipSource.origin,
      planningDataSource: effectivePlanningDataSource.origin,
      approvalMode: effectiveApprovalMode.origin,
      standaloneBrowserUsesMock: standaloneBrowserUsesMock.origin,
      approvalFlowUrl: approvalFlowUrl.origin,
      sharePointSiteUrl: sharePointSiteUrl.origin,
      apiBaseUrl: apiBaseUrl.origin,
      apiAccessTokenScopes: apiAccessTokenScopes.origin,
      healthCheckUrl: healthCheckUrl.origin,
      releaseVersion: releaseVersion.origin,
      sourceRevision: sourceRevision.origin
    }
  };
}

function resolveStandaloneBrowserUsesMock(
  deployment: RuntimeConfigurationInput | undefined,
  logger?: Logger
): { readonly value: boolean; readonly origin: ConfigurationOrigin } {
  const fromDeployment = parseBooleanFlag(deployment?.standaloneBrowserUsesMock);

  if (fromDeployment !== undefined) {
    return { value: fromDeployment, origin: "deployment" };
  }

  const fromBuild = parseBooleanFlag(import.meta.env.VITE_STANDALONE_BROWSER_USES_MOCK);

  if (fromBuild !== undefined) {
    return { value: fromBuild, origin: "build" };
  }

  if (deployment?.standaloneBrowserUsesMock !== undefined) {
    logger?.warn("Runtime configuration value was rejected. Falling back to the next source.", {
      source: "infrastructure",
      component: "runtimeConfig",
      operation: "resolveStandaloneBrowserUsesMock",
      details: { fieldName: "standaloneBrowserUsesMock", origin: "deployment" }
    });
  }

  return { value: false, origin: "default" };
}

function parseBooleanFlag(value: boolean | string | undefined): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "false" || normalized === "0") {
    return false;
  }

  return undefined;
}

function configurationFailure(
  code: RuntimeConfigurationFailureCode,
  message: string
): RuntimeConfigurationResult {
  return { ok: false, error: { code, message } };
}

export function loadLocalConfigurationOverride(): LocalConfigurationOverride | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const raw = window.localStorage.getItem(localOverrideStorageKey);

    if (!raw) {
      return undefined;
    }

    const envelope = JSON.parse(raw) as LocalOverrideEnvelope;

    if (envelope.version !== localOverrideStorageVersion || !envelope.value || typeof envelope.value !== "object") {
      return undefined;
    }

    return envelope.value;
  } catch {
    return undefined;
  }
}

export function saveLocalConfigurationOverride(override: LocalConfigurationOverride): void {
  const envelope: LocalOverrideEnvelope = {
    version: localOverrideStorageVersion,
    value: {
      planningDataSource: override.planningDataSource,
      planningMembershipSource: override.planningMembershipSource,
      approvalMode: override.approvalMode,
      approvalFlowUrl: override.approvalFlowUrl,
      sharePointSiteUrl: override.sharePointSiteUrl,
      apiBaseUrl: override.apiBaseUrl
    }
  };

  window.localStorage.setItem(localOverrideStorageKey, JSON.stringify(envelope));
}

export function clearLocalConfigurationOverride(): void {
  window.localStorage.removeItem(localOverrideStorageKey);
}

export function hasLocalConfigurationOverride(): boolean {
  return loadLocalConfigurationOverride() !== undefined;
}

export function parsePlanningDataSource(value: string | undefined): PlanningDataSource | undefined {
  return value === "mock" || value === "sharepoint" || value === "api" ? value : undefined;
}

export function parsePlanningMembershipSource(value: string | undefined): PlanningMembershipSource | undefined {
  return value === "mock" || value === "graph" ? value : undefined;
}

export function parseApprovalMode(value: string | undefined): ApprovalMode | undefined {
  return value === "mock" || value === "m365" ? value : undefined;
}

export function validateApprovalFlowUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    const url = new URL(value.trim());

    if (url.protocol === "https:" && allowedApprovalFlowHostPattern.test(url.hostname)) {
      return url.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function validateSharePointSiteUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    const url = new URL(value.trim());

    if (url.protocol === "https:" && allowedSharePointHostPattern.test(url.hostname)) {
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function validateApiBaseUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    const url = new URL(value.trim());
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";

    if (url.protocol === "https:" || (url.protocol === "http:" && isLocal)) {
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function parseNonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed || undefined;
}

function validateRelativeUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  return undefined;
}

function resolveScopeListValue(
  candidates: readonly { readonly origin: ConfigurationOrigin; readonly raw: string | readonly string[] | undefined }[],
  fallback: readonly string[],
  logger?: Logger
): { readonly value: readonly string[]; readonly origin: ConfigurationOrigin } {
  for (const candidate of candidates) {
    const parsed = parseScopeList(candidate.raw);

    if (parsed !== undefined) {
      return { value: parsed, origin: candidate.origin };
    }

    if (candidate.raw !== undefined) {
      logger?.warn("Runtime configuration value was rejected. Falling back to the next source.", {
        source: "infrastructure",
        component: "runtimeConfig",
        operation: "resolveScopeListValue",
        details: { fieldName: "apiAccessTokenScopes", origin: candidate.origin }
      });
    }
  }

  return { value: fallback, origin: "default" };
}

function parseScopeList(value: string | readonly string[] | undefined): readonly string[] | undefined {
  if (Array.isArray(value)) {
    const scopes = value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    return scopes.length > 0 ? scopes : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return undefined;
  }

  const scopes = trimmedValue
    .split(/[\s,]+/)
    .map((entry: string) => entry.trim())
    .filter((entry: string) => entry.length > 0);

  return scopes.length > 0 ? scopes : undefined;
}

function resolveValue<T>(
  fieldName: keyof RuntimeConfiguration,
  candidates: readonly ConfigurationCandidate[],
  parse: (raw: string | undefined) => T | undefined,
  fallback: T,
  logger?: Logger
): { readonly value: T; readonly origin: ConfigurationOrigin } {
  for (const candidate of candidates) {
    if (candidate.raw === undefined || candidate.raw.trim() === "") {
      continue;
    }

    const parsed = parse(candidate.raw);

    if (parsed !== undefined) {
      return { value: parsed, origin: candidate.origin };
    }

    logger?.warn("Runtime configuration value was rejected. Falling back to the next source.", {
      source: "infrastructure",
      component: "runtimeConfig",
      operation: "resolveValue",
      details: { fieldName, origin: candidate.origin }
    });
  }

  return { value: fallback, origin: "default" };
}
