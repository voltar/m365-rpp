import type { Absence } from "../models/absence";
import type { PublicHoliday } from "../models/capacity";
import type { TeamMembership } from "../models/identity";
import type { PlanningSettings, VacationBalanceRecord } from "../models/planningSettings";
import type { PlanningEvent } from "../models/planningEvent";

export type RepositoryErrorCode =
  | "conflict"
  | "forbidden"
  // EO-428: no team context could be resolved for the request. Distinct from "forbidden" on
  // purpose — "we do not know which team you mean" and "you may not see this team" have different
  // remedies, and reporting the first as the second sends the user to their administrator over a
  // missing selection.
  | "noTeamContext"
  // EO-428: not signed in, or Teams SSO consent not granted. Separate from "forbidden" for the
  // same reason "forbidden" is separate from "noTeamContext" — the remedy differs. Here the user
  // accepts a consent dialog; with "forbidden" someone else has to grant access.
  | "unauthenticated"
  | "notFound"
  | "network"
  | "timeout"
  | "unknown"
  | "validation";

export interface RepositoryError {
  readonly code: RepositoryErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly details?: Record<string, unknown>;
}

export type RepositoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RepositoryError };

export interface RepositoryPageRequest {
  readonly pageSize?: number;
  readonly pageToken?: string;
}

export interface RepositoryPage<T> {
  readonly items: readonly T[];
  readonly nextPageToken?: string;
}

export interface DateRangeQuery extends RepositoryPageRequest {
  readonly fromDate?: string;
  readonly toDate?: string;
}

export interface UserScopedQuery extends RepositoryPageRequest {
  readonly userId?: string;
}

export interface AbsenceQuery extends DateRangeQuery, UserScopedQuery {
  readonly absenceType?: Absence["type"];
  /** EO-459: host team scope (API also accepts X-RPP-Active-TeamId). */
  readonly teamId?: string;
}

export interface VacationBalanceQuery extends UserScopedQuery {
  readonly year?: number;
  /** EO-459: host team scope (API also accepts X-RPP-Active-TeamId). */
  readonly teamId?: string;
}

export interface HolidayQuery extends DateRangeQuery {
  readonly region?: string;
}

export interface PlanningSettingsQuery extends RepositoryPageRequest {
  readonly key?: string;
  readonly scope?: string;
}

export interface PlanningEventQuery extends DateRangeQuery {
  readonly resourceId?: string;
  readonly type?: PlanningEvent["type"];
  /** EO-459: host team scope (API also accepts X-RPP-Active-TeamId). */
  readonly teamId?: string;
}

export interface TeamMembershipQuery extends RepositoryPageRequest {
  readonly teamId?: string;
  readonly userId?: string;
}

export interface TeamPlanningConfiguration {
  readonly teamId: string;
  readonly planningName: string;
  readonly defaultView?: string;
  readonly defaultCapacityThreshold?: number;
}

export interface TeamPlanningConfigurationQuery extends RepositoryPageRequest {
  readonly teamId?: string;
}

export interface ITeamMembershipProvider {
  listMemberships(query?: TeamMembershipQuery): Promise<RepositoryResult<RepositoryPage<TeamMembership>>>;
}

export interface IAbsenceRepository {
  listAbsences(query?: AbsenceQuery): Promise<RepositoryResult<RepositoryPage<Absence>>>;
  saveAbsence(absence: Absence): Promise<RepositoryResult<Absence>>;
  deleteAbsence(absenceId: string): Promise<RepositoryResult<void>>;
}

export interface IVacationBalanceRepository {
  listVacationBalances(query?: VacationBalanceQuery): Promise<RepositoryResult<RepositoryPage<VacationBalanceRecord>>>;
}

export interface IHolidayRepository {
  listPublicHolidays(query?: HolidayQuery): Promise<RepositoryResult<RepositoryPage<PublicHoliday>>>;
}

export interface IPlanningSettingsRepository {
  getPlanningSettings(query?: PlanningSettingsQuery): Promise<RepositoryResult<PlanningSettings>>;
}

export interface IPlanningEventRepository {
  listPlanningEvents(query?: PlanningEventQuery): Promise<RepositoryResult<RepositoryPage<PlanningEvent>>>;
}

export interface ITeamPlanningConfigurationRepository {
  listTeamPlanningConfigurations(
    query?: TeamPlanningConfigurationQuery
  ): Promise<RepositoryResult<RepositoryPage<TeamPlanningConfiguration>>>;
}

export interface PlanningRepositories {
  readonly teamMemberships: ITeamMembershipProvider;
  readonly absences: IAbsenceRepository;
  readonly vacationBalances: IVacationBalanceRepository;
  readonly holidays: IHolidayRepository;
  readonly settings: IPlanningSettingsRepository;
  readonly planningEvents: IPlanningEventRepository;
  readonly teamPlanningConfigurations: ITeamPlanningConfigurationRepository;
}
