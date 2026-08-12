export interface VacationBalanceRecord {
  readonly employeeId: string;
  readonly year: number;
  readonly allowanceDays: number;
  readonly carriedOverDays: number;
  readonly manualAdjustmentDays: number;
  readonly comment?: string;
}

export interface ResourcePlanningProfile {
  readonly employeeId: string;
  readonly employmentRate?: number;
  readonly workingDays?: readonly number[];
}

export interface TeamPlanningConfiguration {
  readonly teamId: string;
  readonly planningName: string;
  readonly defaultView?: string;
  readonly defaultCapacityThreshold?: number;
}

export interface PlanningSettings {
  readonly resourceProfiles: readonly ResourcePlanningProfile[];
  readonly teamPlanningConfigurations: readonly TeamPlanningConfiguration[];
}
