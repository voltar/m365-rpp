import type { Absence } from "./absence";
import type { ResourceSummary } from "./resource";

export interface PublicHoliday {
  readonly date: string;
  readonly label: string;
  readonly location?: string; // undefined for legacy public holidays, otherwise slot/location marker
}

export interface CapacityCalculationInput {
  readonly resources: readonly ResourceSummary[];
  readonly absences: readonly Absence[];
  readonly dateKeys: readonly string[];
  readonly publicHolidays: readonly PublicHoliday[];
}

export interface CapacityResult {
  readonly employeeId: string;
  readonly date: string;
  readonly nominalCapacity: number;
  readonly absenceCapacity: number;
  readonly availableCapacity: number;
  readonly workingDay: boolean;
  readonly publicHoliday: boolean;
}

export interface CapacityCalculationResult {
  readonly results: readonly CapacityResult[];
  readonly byEmployeeId: ReadonlyMap<string, readonly CapacityResult[]>;
}
