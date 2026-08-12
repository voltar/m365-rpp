// EO-415: organisations are configured in the Team Admin Center and derive from the
// Graph profile (companyName) — no hardcoded union anymore.
export type Organization = string;

export interface VacationBalance {
  readonly annualEntitlement: number;
  readonly booked: number;
  readonly remaining: number;
}

export interface ResourceSummary {
  readonly id: string;
  readonly displayName: string;
  readonly initials: string;
  readonly organization: Organization;
  // EO-415: configured location derived from the Graph profile (officeLocation).
  readonly location?: string;
  readonly businessAddress?: string;
  readonly primaryTeam: string;
  readonly additionalTeams: readonly string[];
  readonly employmentRate?: number;
  readonly workingDays?: readonly number[];
  readonly vacation: VacationBalance;
}
