import type { ResourceSummary } from "./resource";

export type CapacityStatus = "ok" | "warning" | "critical";

export interface CapacityThresholds {
  readonly warning: number;
  readonly critical: number;
}

export interface TeamCapacityWeek {
  readonly key: string;
  readonly label: string;
  readonly dateInterval: string;
  readonly nominalCapacity: number;
  readonly availableCapacity: number;
  readonly absenceCapacity: number;
  readonly availabilityPercentage: number;
  readonly minDailyAvailable?: number;
  readonly understaffed: boolean;
  readonly status: CapacityStatus;
  readonly affectedResources: readonly ResourceSummary[];
}

export interface TeamCapacitySummary {
  readonly teamId: string;
  readonly teamName: string;
  readonly requiredStaffing?: number;
  readonly resources: readonly ResourceSummary[];
  readonly weeks: readonly TeamCapacityWeek[];
}
