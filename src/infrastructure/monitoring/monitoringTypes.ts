import type { ApplicationErrorSeverity } from "../../core/logging";

export type MonitoringHealthStatus = "healthy" | "degraded" | "unhealthy";

export interface MonitoringLogEntry {
  readonly timestamp: string;
  readonly level: ApplicationErrorSeverity;
  readonly message: string;
  readonly source: string;
  readonly component?: string;
  readonly operation?: string;
  readonly correlationId?: string;
  readonly details?: Record<string, unknown>;
}

export interface MonitoringMetric {
  readonly name: string;
  readonly value: number;
  readonly unit: "count" | "millisecond";
  readonly timestamp: string;
}

export interface MonitoringHealthCheck {
  readonly name: string;
  readonly status: MonitoringHealthStatus;
  readonly message: string;
}

export interface MonitoringHealthSnapshot {
  readonly status: MonitoringHealthStatus;
  readonly checkedAt: string;
  readonly applicationVersion: string;
  readonly sourceRevision: string;
  readonly environmentName: string;
  readonly configurationStatus: MonitoringHealthStatus;
  readonly checks: readonly MonitoringHealthCheck[];
  readonly recentEvents: readonly MonitoringLogEntry[];
  readonly metrics: readonly MonitoringMetric[];
}
