import type { Absence } from "../models/absence";
import type { PublicHoliday } from "../models/capacity";
import type { TeamMembership } from "../models/identity";
import { resolveActiveTeamId } from "../infrastructure/microsoft365/currentUser";
import type { PlanningSettings, VacationBalanceRecord } from "../models/planningSettings";
import type { PlanningEvent } from "../models/planningEvent";
import type { ResourceSummary } from "../models/resource";
import type {
  PlanningRepositories,
  RepositoryPage,
  RepositoryPageRequest,
  RepositoryResult,
  TeamPlanningConfiguration
} from "../repositories/planningRepositories";

/**
 * EO-428: raised when planning data was requested without a resolvable team context. Carried as its
 * own type so the bootstrap can offer a team selection instead of reporting an empty plan — the two
 * look identical to a user and have nothing in common as remedies.
 */
export class NoTeamContextError extends Error {
  constructor() {
    super("No team context is available for this request.");
    this.name = "NoTeamContextError";
  }
}

/**
 * EO-428: raised when the API refused the request. `unauthenticated` means no token arrived — an
 * ungranted Teams SSO consent, which the user can accept — while `forbidden` means the identity is
 * known and denied, which someone else has to change. Kept apart because the sentence shown to the
 * user is the difference between "accept this dialog" and "ask your team lead".
 */
export class AccessDeniedError extends Error {
  readonly reason: "unauthenticated" | "forbidden";

  constructor(reason: "unauthenticated" | "forbidden") {
    super(`Planning data access was denied (${reason}).`);
    this.name = "AccessDeniedError";
    this.reason = reason;
  }
}

/**
 * EO-428: raised when planning data could not be read at all and nothing was retrieved. Unlike the
 * two above, this is a genuine failure rather than something the user can act on — it belongs in an
 * error banner with a correlation id, not in an instruction.
 */
export class PlanningUnavailableError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`Planning data could not be read (${code}): ${message}`);
    this.name = "PlanningUnavailableError";
    this.code = code;
  }
}

export interface PlanningDataSnapshot {
  readonly resources: readonly ResourceSummary[];
  readonly absences: readonly Absence[];
  readonly publicHolidays: readonly PublicHoliday[];
  readonly planningEvents: readonly PlanningEvent[];
}

export async function loadPlanningDataSnapshot(repositories: PlanningRepositories): Promise<PlanningDataSnapshot> {
  const activeTeamId = await resolveActiveTeamId();

  const [memberships, absences, vacationBalances, publicHolidays, settings, planningEvents, teamPlanningConfigurations] = await Promise.all([
    listTeamMembershipPages(repositories, activeTeamId),
    // EO-459: pass host teamId so the API can enforce team-scoped reads (header alone is not enough for all hosts).
    listAllPages((request) => repositories.absences.listAbsences({ ...request, teamId: activeTeamId })),
    listAllPages((request) => repositories.vacationBalances.listVacationBalances({ ...request, teamId: activeTeamId })),
    listAllPages((request) => repositories.holidays.listPublicHolidays(request)),
    repositories.settings.getPlanningSettings(),
    listAllPages((request) => repositories.planningEvents.listPlanningEvents({ ...request, teamId: activeTeamId })),
    listAllPages((request) => repositories.teamPlanningConfigurations.listTeamPlanningConfigurations(request))
  ]);

  const scopedUserIds = new Set(memberships.map((membership) => membership.member.id));
  const scopedAbsences = absences.filter((absence) => scopedUserIds.has(absence.employeeId));
  const scopedPlanningEvents = planningEvents.filter((event) => scopedUserIds.has(event.resourceId));
  const planningSettings = mergeTeamPlanningConfigurations(requireRepositoryValue(settings), teamPlanningConfigurations);

  return {
    absences: scopedAbsences,
    planningEvents: scopedPlanningEvents,
    publicHolidays,
    resources: buildResourceSummaries(memberships, vacationBalances, planningSettings)
  };
}

async function listTeamMembershipPages(
  repositories: PlanningRepositories,
  activeTeamId?: string
): Promise<readonly TeamMembership[]> {
  return listAllPages((request) => repositories.teamMemberships.listMemberships({
    ...request,
    teamId: activeTeamId
  }));
}

function mergeTeamPlanningConfigurations(
  settings: PlanningSettings,
  teamPlanningConfigurations: readonly TeamPlanningConfiguration[]
): PlanningSettings {
  return {
    ...settings,
    teamPlanningConfigurations: teamPlanningConfigurations.length > 0
      ? teamPlanningConfigurations
      : settings.teamPlanningConfigurations
  };
}

async function listAllPages<T>(
  loadPage: (request: RepositoryPageRequest) => Promise<RepositoryResult<RepositoryPage<T>>>
): Promise<readonly T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const result = await loadPage({ pageToken, pageSize: 100 });

      if (!result.ok) {
        const error = result.error || { code: "network", message: "Unknown error" };

        // EO-428: every other failure degrades to partial results, which is right for a flaky page
        // load. These two are not flaky pages — continuing would present "no people" as a fact,
        // and the user would go looking for missing data instead of choosing a team or accepting a
        // consent dialog. Reporting an access problem as an empty plan is the same mistake as
        // reporting a missing context as a permission error, one layer up.
        if (error.code === "noTeamContext") {
          throw new NoTeamContextError();
        }

        if (error.code === "unauthenticated" || error.code === "forbidden") {
          throw new AccessDeniedError(error.code);
        }

        // With nothing read yet, an empty list would state "there is nothing" where the truth is
        // "we could not read". That is the defect this EO keeps finding in new places — most
        // recently a Graph outage that the API reported as HTTP 200 with no members, which the UI
        // then showed as "no plannable people found". Partial results stay partial results: once
        // something has been read, keeping it is more useful than discarding it.
        if (items.length === 0) {
          throw new PlanningUnavailableError(error.code, error.message);
        }

        console.warn("listAllPages failed on page", error);
        break;
      }

      const page = result.value || { items: [], nextPageToken: undefined };
      // Support both {items} from API and direct array from some providers
      const pageItems = Array.isArray(page) ? page : (page.items || []);
      items.push(...pageItems);
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (error) {
    // The three typed errors above are raised deliberately from inside this try, so this catch
    // would swallow them and hand back an empty list — reinstating exactly the defect they exist to
    // prevent, one line below where it was fixed. Only genuinely unexpected failures degrade to
    // partial results here.
    if (error instanceof NoTeamContextError
      || error instanceof AccessDeniedError
      || error instanceof PlanningUnavailableError) {
      throw error;
    }

    console.warn("listAllPages crashed - returning partial results", error);
  }

  return items;
}

function requireRepositoryValue<T>(result: RepositoryResult<T>): T {
  if (result.ok && result.value !== undefined) {
    return result.value;
  }

  // Safe error handling - many repositories return { ok: false, error: {...} }
  const errorObj = !result.ok ? result.error : { code: "unknown", message: "Unknown repository error" };
  const code = errorObj.code || "unknown";
  const message = errorObj.message || "Repository call failed";
  throw new Error(`${code}: ${message}`);
}

function buildResourceSummaries(
  memberships: readonly TeamMembership[] | undefined,
  vacationBalances: readonly VacationBalanceRecord[] | undefined,
  settings: PlanningSettings | undefined
): readonly ResourceSummary[] {
  const safeMemberships = memberships ?? [];
  const safeVacationBalances = vacationBalances ?? [];
  const safeSettings = settings ?? { resourceProfiles: [], teamPlanningConfigurations: [] } as PlanningSettings;

  const membershipsByEmployeeId = groupMembershipsByEmployeeId(safeMemberships);
  const vacationBalanceByEmployeeId = new Map(
    safeVacationBalances.map((record) => [record.employeeId, record])
  );
  const profileByEmployeeId = new Map(
    (safeSettings.resourceProfiles ?? []).map((profile) => [profile.employeeId, profile])
  );

  return Array.from(membershipsByEmployeeId.entries())
    .reduce<ResourceSummary[]>((summaries, [employeeId, employeeMemberships]) => {
      const primaryMembership = employeeMemberships.find((membership) => membership.isPrimary) ?? employeeMemberships[0];

      if (!primaryMembership) {
        return summaries;
      }

      const memberData = primaryMembership.member;
      const profile = profileByEmployeeId.get(employeeId);
      const vacationBalance = vacationBalanceByEmployeeId.get(employeeId);
      const displayName = memberData.displayName || "Unknown User";
      const initials = memberData.initials || displayName.split(" ").map((namePart: string) => namePart[0]).join("").slice(0, 2).toUpperCase();
      const primaryTeam = primaryMembership.teamName || "Platform Team";
      const annualEntitlement = vacationBalance
        ? (vacationBalance.allowanceDays ?? 0)
          + (vacationBalance.carriedOverDays ?? 0)
          + (vacationBalance.manualAdjustmentDays ?? 0)
        : 25;

      summaries.push({
        id: memberData.id || employeeId,
        displayName,
        initials,
        // EO-415: company + location come from Graph (companyName / officeLocation),
        // resolved by the API when planningDataSource=api.
        organization: memberData.organization || "",
        location: memberData.location || undefined,
        businessAddress: memberData.businessAddress,
        primaryTeam,
        additionalTeams: Array.from(
          new Set(
            employeeMemberships
              .filter((membership) => !membership.isPrimary)
              .map((membership) => membership.teamName || "Platform Team")
              .filter((teamName) => teamName !== primaryTeam)
          )
        ),
        employmentRate: profile?.employmentRate,
        workingDays: profile?.workingDays,
        vacation: {
          annualEntitlement,
          booked: 0,
          remaining: annualEntitlement
        }
      });

      return summaries;
    }, [])
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function groupMembershipsByEmployeeId(memberships: readonly TeamMembership[]): ReadonlyMap<string, readonly TeamMembership[]> {
  const groups = new Map<string, TeamMembership[]>();

  memberships.forEach((membership) => {
    const memberId = membership.member.id || "unknown";
    const current = groups.get(memberId) ?? [];
    current.push(membership);
    groups.set(memberId, current);
  });

  return groups;
}
