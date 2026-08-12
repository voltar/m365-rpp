import { mockAbsences } from "../data/mockAbsences";
import { loadPersistedMockState, savePersistedMockState } from "../data/mockStatePersistence";
import { mockPresenceEvents } from "../data/mockPresenceEvents";
import { mockResources } from "../data/mockResources";
import { publicHolidays } from "../data/publicHolidays";
// getTeamAdminResourceOverrides is temporarily disabled during EO-408 transition (now comes from DB)
// import { getTeamAdminResourceOverrides } from "../features/team-admin/services/teamAdminApi";
import type { Absence } from "../models/absence";
import type { PublicHoliday } from "../models/capacity";
import type { TeamMembership } from "../models/identity";
import type { PlanningSettings, VacationBalanceRecord } from "../models/planningSettings";
import type { PlanningEvent } from "../models/planningEvent";
import type {
  AbsenceQuery,
  IAbsenceRepository,
  IHolidayRepository,
  IPlanningEventRepository,
  IPlanningSettingsRepository,
  ITeamMembershipProvider,
  ITeamPlanningConfigurationRepository,
  IVacationBalanceRepository,
  HolidayQuery,
  PlanningEventQuery,
  PlanningRepositories,
  RepositoryPage,
  RepositoryPageRequest,
  RepositoryResult,
  TeamMembershipQuery,
  TeamPlanningConfiguration,
  TeamPlanningConfigurationQuery,
  VacationBalanceQuery
} from "./planningRepositories";

export class MockTeamMembershipRepository implements ITeamMembershipProvider {
  async listMemberships(query?: TeamMembershipQuery): Promise<RepositoryResult<RepositoryPage<TeamMembership>>> {
    // EO-422: mock/demo mode derives memberships from the typed mock resources
    // (EO-408 had emptied this provider; demo installations had no plannable people).
    const memberships: TeamMembership[] = mockResources.flatMap((resource) =>
      [resource.primaryTeam, ...resource.additionalTeams].map((teamName, index) => ({
        member: {
          id: resource.id,
          displayName: resource.displayName,
          initials: resource.initials,
          organization: resource.organization,
          location: resource.location ?? deriveMockLocation(resource.id),
          businessAddress: createMockBusinessAddress(resource.id, resource.organization),
          userType: "member" as const
        },
        teamId: normalizeTeamId(teamName),
        teamName,
        isPrimary: index === 0
      }))
    );

    return ok(pageItems(filterMemberships(memberships, query), query));
  }
}

const absencePersistenceKey = "absences";

export class MockAbsenceRepository implements IAbsenceRepository {
  private absences: readonly Absence[];

  constructor(initialAbsences?: readonly Absence[]) {
    this.absences = initialAbsences ?? loadPersistedMockState<readonly Absence[]>(absencePersistenceKey, mockAbsences);
  }

  async listAbsences(query?: AbsenceQuery): Promise<RepositoryResult<RepositoryPage<Absence>>> {
    const filteredAbsences = this.absences.filter((absence) => {
      const matchesUser = !query?.userId || absence.employeeId === query.userId;
      const matchesType = !query?.absenceType || absence.type === query.absenceType;
      const matchesFrom = !query?.fromDate || absence.endDate >= query.fromDate;
      const matchesTo = !query?.toDate || absence.startDate <= query.toDate;

      return matchesUser && matchesType && matchesFrom && matchesTo;
    });

    return ok(pageItems(filteredAbsences, query));
  }

  async saveAbsence(absence: Absence): Promise<RepositoryResult<Absence>> {
    const exists = this.absences.some((candidate) => candidate.id === absence.id);
    this.absences = exists
      ? this.absences.map((candidate) => (candidate.id === absence.id ? absence : candidate))
      : [...this.absences, absence];
    savePersistedMockState(absencePersistenceKey, this.absences);

    return ok(absence);
  }

  async deleteAbsence(absenceId: string): Promise<RepositoryResult<void>> {
    this.absences = this.absences.filter((absence) => absence.id !== absenceId);
    savePersistedMockState(absencePersistenceKey, this.absences);
    return ok(undefined);
  }
}

export class MockVacationBalanceRepository implements IVacationBalanceRepository {
  async listVacationBalances(query?: VacationBalanceQuery): Promise<RepositoryResult<RepositoryPage<VacationBalanceRecord>>> {
    // EO-408: TeamAdmin overrides now come from SQL. For mock repository we use empty map as fallback.
    const overrides = new Map();
    const balances = mockResources.map((resource) => ({
      employeeId: resource.id,
      year: 2026,
      allowanceDays: overrides.get(resource.id)?.vacationBalance ?? resource.vacation.annualEntitlement,
      carriedOverDays: 0,
      manualAdjustmentDays: 0
    })).filter((record) => {
      const matchesUser = !query?.userId || record.employeeId === query.userId;
      const matchesYear = !query?.year || record.year === query.year;

      return matchesUser && matchesYear;
    });

    return ok(pageItems(balances, query));
  }
}

const publicHolidayPersistenceKey = "publicHolidays";

export class MockHolidayRepository implements IHolidayRepository {
  async listPublicHolidays(query?: HolidayQuery): Promise<RepositoryResult<RepositoryPage<PublicHoliday>>> {
    // Read persisted holidays on every call so that calendars refreshed via the Team Admin
    // sync actions (which write directly to localStorage) are picked up on the next bootstrap
    // without requiring a full page reload. Bootstrap runs once per load, so this is not a hot path.
    const persistedHolidays = loadPersistedMockState<readonly PublicHoliday[]>(publicHolidayPersistenceKey, publicHolidays);
    const holidays = persistedHolidays.filter((holiday) => {
      const matchesFrom = !query?.fromDate || holiday.date >= query.fromDate;
      const matchesTo = !query?.toDate || holiday.date <= query.toDate;

      return matchesFrom && matchesTo;
    });

    return ok(pageItems(holidays, query));
  }
}

export class MockSettingsRepository implements IPlanningSettingsRepository {
  async getPlanningSettings(): Promise<RepositoryResult<PlanningSettings>> {
    // EO-408: Use real persisted teams from DB (mock fallback)
    const teamNames = ["Platform Team"];
    const overrides = new Map(); // dummy for the line below

    return ok({
      resourceProfiles: mockResources.map((resource) => ({
        employeeId: resource.id,
        employmentRate: overrides.get(resource.id)?.employmentRate ?? resource.employmentRate,
        workingDays: resource.workingDays
      })),
      teamPlanningConfigurations: teamNames.map((teamName) => ({
        teamId: normalizeTeamId(teamName),
        planningName: teamName,
        defaultView: "gantt"
      }))
    });
  }
}

export class MockPlanningEventRepository implements IPlanningEventRepository {
  async listPlanningEvents(query?: PlanningEventQuery): Promise<RepositoryResult<RepositoryPage<PlanningEvent>>> {
    const events = mockPresenceEvents
      .filter((event) => !["event-001", "event-002", "event-007", "event-020"].includes(event.id))
      .filter((event) => {
        const matchesResource = !query?.resourceId || event.resourceId === query.resourceId;
        const matchesType = !query?.type || event.type === query.type;
        const matchesFrom = !query?.fromDate || event.endDate >= query.fromDate;
        const matchesTo = !query?.toDate || event.startDate <= query.toDate;

        return matchesResource && matchesType && matchesFrom && matchesTo;
      });

    return ok(pageItems(events, query));
  }
}

export class MockTeamPlanningConfigurationRepository implements ITeamPlanningConfigurationRepository {
  async listTeamPlanningConfigurations(
    query?: TeamPlanningConfigurationQuery
  ): Promise<RepositoryResult<RepositoryPage<TeamPlanningConfiguration>>> {
    const configurations = ["Platform Team"]
      .map((teamName) => ({
        teamId: normalizeTeamId(teamName),
        planningName: teamName,
        defaultView: "gantt"
      }))
      .filter((configuration) => !query?.teamId || configuration.teamId === query.teamId);

    return ok(pageItems(configurations, query));
  }
}

export function createMockPlanningRepositories(): PlanningRepositories {
  return {
    teamMemberships: new MockTeamMembershipRepository(),
    absences: new MockAbsenceRepository(),
    vacationBalances: new MockVacationBalanceRepository(),
    holidays: new MockHolidayRepository(),
    settings: new MockSettingsRepository(),
    planningEvents: new MockPlanningEventRepository(),
    teamPlanningConfigurations: new MockTeamPlanningConfigurationRepository()
  };
}

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

function pageItems<T>(items: readonly T[], request?: RepositoryPageRequest): RepositoryPage<T> {
  const start = request?.pageToken ? Number.parseInt(request.pageToken, 10) : 0;
  const safeStart = Number.isFinite(start) && start > 0 ? start : 0;
  const pageSize = request?.pageSize && request.pageSize > 0 ? request.pageSize : items.length;
  const page = items.slice(safeStart, safeStart + pageSize);
  const nextPageToken = safeStart + pageSize < items.length ? `${safeStart + pageSize}` : undefined;

  return { items: page, nextPageToken };
}

function filterMemberships(memberships: readonly TeamMembership[], query?: TeamMembershipQuery): readonly TeamMembership[] {
  return memberships.filter((membership) => {
    const matchesTeam = !query?.teamId || membership.teamId === query.teamId;
    const matchesUser = !query?.userId || membership.member.id === query.userId;

    return matchesTeam && matchesUser;
  });
}

// EO-408: getMockTeamNames removed - teams now come from persistent SQL backend (normalized model)

function normalizeTeamId(teamName: string): string {
  return teamName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function createMockBusinessAddress(resourceId: string, organization: string): string {
  if (hashText(resourceId) % 3 === 0) {
    return "Lerchenfeldstrasse 5, 9014 St. Gallen, Schweiz";
  }

  return organization === "Organisation-B"
    ? "Überlandstrasse 133, 8600 Dübendorf, Schweiz"
    : "Überlandstrasse 129, 8600 Dübendorf, Schweiz";
}

/** EO-415 demo seed: structured Standort matching the address heuristic used above. */
function deriveMockLocation(resourceId: string): string {
  return hashText(resourceId) % 3 === 0 ? "St. Gallen" : "Dübendorf";
}

function hashText(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}
