import type { LogContext } from "../../core/logging";
import { getRuntimeConfiguration } from "../deployment/runtimeConfig";
import type {
  MonitoringHealthCheck,
  MonitoringHealthSnapshot,
  MonitoringHealthStatus,
  MonitoringLogEntry,
  MonitoringMetric
} from "./monitoringTypes";

const maxRecentEvents = 100;
const maxMetrics = 100;
const sensitiveKeyPattern = /token|secret|password|authorization|cookie|apikey|apiKey/i;

const recentEvents: MonitoringLogEntry[] = [];
const metrics: MonitoringMetric[] = [];

export function recordMonitoringEvent(entry: MonitoringLogEntry): void {
  recentEvents.push({
    ...entry,
    details: sanitizeDetails(entry.details)
  });

  if (recentEvents.length > maxRecentEvents) {
    recentEvents.splice(0, recentEvents.length - maxRecentEvents);
  }
}

export function recordMonitoringMetric(metric: Omit<MonitoringMetric, "timestamp">): void {
  metrics.push({
    ...metric,
    timestamp: new Date().toISOString()
  });

  if (metrics.length > maxMetrics) {
    metrics.splice(0, metrics.length - maxMetrics);
  }
}

export function createMonitoringLogEntry(
  level: MonitoringLogEntry["level"],
  message: string,
  context: LogContext,
  correlationId?: string
): MonitoringLogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    source: context.source,
    component: context.component,
    operation: context.operation,
    correlationId,
    details: sanitizeDetails(context.details)
  };
}

export function getMonitoringHealthSnapshot(): MonitoringHealthSnapshot {
  const runtimeConfiguration = getRuntimeConfiguration();
  const configurationChecks = getConfigurationChecks(runtimeConfiguration);
  const status = summarizeStatus(configurationChecks);

  return {
    status,
    checkedAt: new Date().toISOString(),
    applicationVersion: runtimeConfiguration.releaseVersion,
    sourceRevision: runtimeConfiguration.sourceRevision,
    environmentName: runtimeConfiguration.environmentName,
    configurationStatus: status,
    checks: configurationChecks,
    recentEvents: [...recentEvents].reverse(),
    metrics: [...metrics].reverse()
  };
}

function getConfigurationChecks(runtimeConfiguration: ReturnType<typeof getRuntimeConfiguration>): readonly MonitoringHealthCheck[] {
  const checks: MonitoringHealthCheck[] = [
    {
      name: "runtimeConfiguration",
      status: "healthy",
      message: "Runtime configuration loaded."
    },
    {
      name: "releaseMetadata",
      status: runtimeConfiguration.releaseVersion === "local" ? "degraded" : "healthy",
      message: runtimeConfiguration.releaseVersion === "local"
        ? "Release metadata uses local fallback values."
        : "Release metadata configured."
    }
  ];

  if (runtimeConfiguration.planningDataSource === "sharepoint" && !runtimeConfiguration.sharePointSiteUrl) {
    checks.push({
      name: "sharePointConfiguration",
      status: "unhealthy",
      message: "SharePoint data source is enabled without a SharePoint site URL."
    });
  } else if (runtimeConfiguration.planningDataSource === "api" && !runtimeConfiguration.apiBaseUrl) {
    checks.push({
      name: "apiConfiguration",
      status: "unhealthy",
      message: "API data source is enabled without an API base URL."
    });
  } else {
    checks.push({
      name: "planningDataSourceConfiguration",
      status: "healthy",
      message: "Planning data source configuration is valid."
    });
  }

  return checks;
}

function summarizeStatus(checks: readonly MonitoringHealthCheck[]): MonitoringHealthStatus {
  if (checks.some((check) => check.status === "unhealthy")) {
    return "unhealthy";
  }

  if (checks.some((check) => check.status === "degraded")) {
    return "degraded";
  }

  return "healthy";
}

function sanitizeDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[redacted]" : sanitizeValue(value)
    ])
  );
}

function sanitizeValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  try {
    return sanitizeDetails(value as Record<string, unknown>);
  } catch {
    return "[sanitization-failed]";
  }
}
