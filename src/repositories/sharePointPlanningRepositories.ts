import type { Absence, AbsenceApprovalStatus, AbsenceType, DayHalf } from "../models/absence";
import type { PublicHoliday } from "../models/capacity";
import type { PlanningSettings, VacationBalanceRecord } from "../models/planningSettings";
import type { PlanningEvent, PlanningEventType } from "../models/planningEvent";
import { calculateAbsenceDuration } from "../services/absenceCalculations";
import {
  createSharePointListItemsPath,
  type SharePointClient
} from "../infrastructure/microsoft365";
import {
  FetchSharePointSiteUserDirectory,
  type SharePointSiteUserDirectory
} from "./sharePointSiteUserDirectory";
import type {
  AbsenceQuery,
  IAbsenceRepository,
  IHolidayRepository,
  IPlanningEventRepository,
  IPlanningSettingsRepository,
  ITeamPlanningConfigurationRepository,
  IVacationBalanceRepository,
  HolidayQuery,
  PlanningEventQuery,
  PlanningRepositories,
  PlanningSettingsQuery,
  RepositoryPage,
  RepositoryResult,
  TeamPlanningConfiguration,
  TeamPlanningConfigurationQuery,
  VacationBalanceQuery
} from "./planningRepositories";

interface SharePointCollectionResponse<T> {
  readonly value: readonly T[];
  readonly "@odata.nextLink"?: string;
}

interface SharePointAbsenceItem {
  readonly Id?: number | string;
  readonly UserPersonId?: number;
  readonly Type?: string;
  readonly StartDate?: string;
  readonly StartHalf?: string;
  readonly EndDate?: string;
  readonly EndHalf?: string;
  readonly Comment?: string;
  readonly SubstitutePersonId?: number;
  readonly ApprovalStatus?: string;
  readonly CreatedAt?: string;
  readonly ModifiedAt?: string;
  readonly Created?: string;
  readonly Modified?: string;
}

interface SharePointVacationBalanceItem {
  readonly Id?: number | string;
  readonly UserPersonId?: number;
  readonly Year?: number;
  readonly Entitlement?: number;
  readonly CarryForward?: number;
  readonly ManualAdjustment?: number;
  readonly Comment?: string;
}

interface SharePointPublicHolidayItem {
  readonly Id?: number | string;
  readonly Date?: string;
  readonly Title?: string;
  readonly Location?: string;
}

interface SharePointPlanningSettingItem {
  readonly Id?: number | string;
  readonly Key?: string;
  readonly Value?: string;
  readonly Scope?: string;
  readonly Description?: string;
}

interface SharePointPlanningEventItem {
  readonly Id?: number | string;
  readonly ResourcePersonId?: number;
  readonly Type?: string;
  readonly Title?: string;
  readonly StartDate?: string;
  readonly StartHalf?: string;
  readonly EndDate?: string;
  readonly EndHalf?: string;
  readonly AbsenceId?: string;
  readonly ApprovalStatus?: string;
}

interface SharePointTeamPlanningConfigurationItem {
  readonly Id?: number | string;
  readonly TeamId?: string;
  readonly PlanningName?: string;
  readonly DefaultView?: string;
  readonly DefaultCapacityThreshold?: number;
}

export class SharePointAbsenceRepository implements IAbsenceRepository {
  constructor(
    private readonly client: SharePointClient,
    private readonly siteUsers: SharePointSiteUserDirectory
  ) {}

  async listAbsences(query?: AbsenceQuery): Promise<RepositoryResult<RepositoryPage<Absence>>> {
    const personFilter = await resolvePersonFilter(this.siteUsers, "UserPersonId", query?.userId);

    if (personFilter === "unresolved") {
      return emptyPage();
    }

    const result = await listSharePointItems<SharePointAbsenceItem>(this.client, "Absences", {
      "$select": "Id,UserPersonId,Type,StartDate,StartHalf,EndDate,EndHalf,Comment,SubstitutePersonId,ApprovalStatus,CreatedAt,ModifiedAt,Created,Modified",
      "$filter": createAndFilter([
        personFilter,
        query?.absenceType ? equals("Type", query.absenceType) : undefined,
        query?.fromDate ? `EndDate ge '${query.fromDate}'` : undefined,
        query?.toDate ? `StartDate le '${query.toDate}'` : undefined
      ]),
      "$top": query?.pageSize,
      pageToken: query?.pageToken
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        items: await Promise.all(result.value.items.map((item) => mapAbsence(item, this.siteUsers))),
        nextPageToken: result.value.nextPageToken
      }
    };
  }

  async saveAbsence(): Promise<RepositoryResult<Absence>> {
    return unsupportedWrite("SharePoint absence write is not part of EO-105.");
  }

  async deleteAbsence(): Promise<RepositoryResult<void>> {
    return unsupportedWrite("SharePoint absence delete is not part of EO-105.");
  }
}

export class SharePointVacationBalanceRepository implements IVacationBalanceRepository {
  constructor(
    private readonly client: SharePointClient,
    private readonly siteUsers: SharePointSiteUserDirectory
  ) {}

  async listVacationBalances(query?: VacationBalanceQuery): Promise<RepositoryResult<RepositoryPage<VacationBalanceRecord>>> {
    const personFilter = await resolvePersonFilter(this.siteUsers, "UserPersonId", query?.userId);

    if (personFilter === "unresolved") {
      return emptyPage();
    }

    const result = await listSharePointItems<SharePointVacationBalanceItem>(this.client, "VacationBalances", {
      "$select": "Id,UserPersonId,Year,Entitlement,CarryForward,ManualAdjustment,Comment",
      "$filter": createAndFilter([
        personFilter,
        query?.year ? `Year eq ${query.year}` : undefined
      ]),
      "$top": query?.pageSize,
      pageToken: query?.pageToken
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        items: await Promise.all(result.value.items.map((item) => mapVacationBalance(item, this.siteUsers))),
        nextPageToken: result.value.nextPageToken
      }
    };
  }
}

export class SharePointHolidayRepository implements IHolidayRepository {
  constructor(private readonly client: SharePointClient) {}

  async listPublicHolidays(query?: HolidayQuery): Promise<RepositoryResult<RepositoryPage<PublicHoliday>>> {
    const result = await listSharePointItems<SharePointPublicHolidayItem>(this.client, "PublicHolidays", {
      "$select": "Id,Date,Title,Location",
      "$filter": createAndFilter([
        query?.region ? equals("Location", query.region) : undefined,
        query?.fromDate ? `Date ge '${query.fromDate}'` : undefined,
        query?.toDate ? `Date le '${query.toDate}'` : undefined
      ]),
      "$top": query?.pageSize,
      pageToken: query?.pageToken
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        items: result.value.items.map(mapPublicHoliday),
        nextPageToken: result.value.nextPageToken
      }
    };
  }
}

export class SharePointSettingsRepository implements IPlanningSettingsRepository {
  constructor(private readonly client: SharePointClient) {}

  async getPlanningSettings(query?: PlanningSettingsQuery): Promise<RepositoryResult<PlanningSettings>> {
    const result = await listSharePointItems<SharePointPlanningSettingItem>(this.client, "PlanningSettings", {
      "$select": "Id,Key,Value,Scope,Description",
      "$filter": createAndFilter([
        query?.key ? equals("Key", query.key) : undefined,
        query?.scope ? equals("Scope", query.scope) : undefined
      ]),
      "$top": query?.pageSize,
      pageToken: query?.pageToken
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        resourceProfiles: parseResourceProfiles(result.value.items),
        teamPlanningConfigurations: []
      }
    };
  }
}

export class SharePointTeamPlanningConfigurationRepository implements ITeamPlanningConfigurationRepository {
  constructor(private readonly client: SharePointClient) {}

  async listTeamPlanningConfigurations(
    query?: TeamPlanningConfigurationQuery
  ): Promise<RepositoryResult<RepositoryPage<TeamPlanningConfiguration>>> {
    const result = await listSharePointItems<SharePointTeamPlanningConfigurationItem>(this.client, "TeamPlanningConfiguration", {
      "$select": "Id,TeamId,PlanningName,DefaultView,DefaultCapacityThreshold",
      "$filter": query?.teamId ? equals("TeamId", query.teamId) : undefined,
      "$top": query?.pageSize,
      pageToken: query?.pageToken
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        items: result.value.items.map(mapTeamPlanningConfiguration),
        nextPageToken: result.value.nextPageToken
      }
    };
  }
}

export class SharePointPlanningEventRepository implements IPlanningEventRepository {
  constructor(
    private readonly client: SharePointClient,
    private readonly siteUsers: SharePointSiteUserDirectory
  ) {}

  async listPlanningEvents(query?: PlanningEventQuery): Promise<RepositoryResult<RepositoryPage<PlanningEvent>>> {
    const personFilter = await resolvePersonFilter(this.siteUsers, "ResourcePersonId", query?.resourceId);

    if (personFilter === "unresolved") {
      return emptyPage();
    }

    const result = await listSharePointItems<SharePointPlanningEventItem>(this.client, "PlanningEvents", {
      "$select": "Id,ResourcePersonId,Type,Title,StartDate,StartHalf,EndDate,EndHalf,AbsenceId,ApprovalStatus",
      "$filter": createAndFilter([
        personFilter,
        query?.type ? equals("Type", query.type) : undefined,
        query?.fromDate ? `EndDate ge '${query.fromDate}'` : undefined,
        query?.toDate ? `StartDate le '${query.toDate}'` : undefined
      ]),
      "$top": query?.pageSize,
      pageToken: query?.pageToken
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        items: await Promise.all(result.value.items.map((item) => mapPlanningEvent(item, this.siteUsers))),
        nextPageToken: result.value.nextPageToken
      }
    };
  }
}

export class EmptyPlanningEventRepository implements IPlanningEventRepository {
  async listPlanningEvents(query?: PlanningEventQuery): Promise<RepositoryResult<RepositoryPage<PlanningEvent>>> {
    return {
      ok: true,
      value: {
        items: [],
        nextPageToken: query?.pageToken
      }
    };
  }
}

export function createSharePointPlanningRepositories(
  baseRepositories: PlanningRepositories,
  client: SharePointClient,
  siteUsers: SharePointSiteUserDirectory = new FetchSharePointSiteUserDirectory(client)
): PlanningRepositories {
  // One directory instance across all repositories: the site-user lookup is read once, not once
  // per repository (EO-430 FR-430.7).
  return {
    ...baseRepositories,
    absences: new SharePointAbsenceRepository(client, siteUsers),
    vacationBalances: new SharePointVacationBalanceRepository(client, siteUsers),
    holidays: new SharePointHolidayRepository(client),
    settings: new SharePointSettingsRepository(client),
    planningEvents: new SharePointPlanningEventRepository(client, siteUsers),
    teamPlanningConfigurations: new SharePointTeamPlanningConfigurationRepository(client)
  };
}

export function createUnavailableSharePointPlanningRepositories(
  baseRepositories: PlanningRepositories,
  message: string
): PlanningRepositories {
  return {
    ...baseRepositories,
    absences: {
      listAbsences: () => Promise.resolve(unavailableResult<RepositoryPage<Absence>>(message)),
      saveAbsence: () => unsupportedWrite("SharePoint absence write is not part of EO-105."),
      deleteAbsence: () => unsupportedWrite("SharePoint absence delete is not part of EO-105.")
    },
    vacationBalances: {
      listVacationBalances: () => Promise.resolve(unavailableResult<RepositoryPage<VacationBalanceRecord>>(message))
    },
    holidays: {
      listPublicHolidays: () => Promise.resolve(unavailableResult<RepositoryPage<PublicHoliday>>(message))
    },
    settings: {
      getPlanningSettings: () => Promise.resolve(unavailableResult<PlanningSettings>(message))
    },
    planningEvents: {
      listPlanningEvents: () => Promise.resolve(unavailableResult<RepositoryPage<PlanningEvent>>(message))
    },
    teamPlanningConfigurations: {
      listTeamPlanningConfigurations: () => Promise.resolve(unavailableResult<RepositoryPage<TeamPlanningConfiguration>>(message))
    }
  };
}

async function listSharePointItems<T>(
  client: SharePointClient,
  listTitle: string,
  query: Readonly<Record<string, string | number | undefined>>
): Promise<RepositoryResult<RepositoryPage<T>>> {
  const pageToken = typeof query.pageToken === "string" ? query.pageToken : undefined;
  const path = pageToken ?? createSharePointListItemsPath(listTitle, withoutPageToken(query));
  const result = await client.get<SharePointCollectionResponse<T>>(path);

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    value: {
      items: result.value.value,
      nextPageToken: result.value["@odata.nextLink"]
    }
  };
}

function withoutPageToken(
  query: Readonly<Record<string, string | number | undefined>>
): Readonly<Record<string, string | number | undefined>> {
  const rest: Record<string, string | number | undefined> = {};

  Object.entries(query).forEach(([key, value]) => {
    if (key !== "pageToken") {
      rest[key] = value;
    }
  });

  return rest;
}

/**
 * EO-430: a person column filters by its site-collection lookup id, never by the Graph user id, so
 * a person-scoped query resolves first. Returns "unresolved" when the person is unknown to the
 * site — the caller must then return nothing rather than drop the filter, which would answer a
 * question about one employee with everybody's records.
 */
async function resolvePersonFilter(
  siteUsers: SharePointSiteUserDirectory,
  fieldName: string,
  graphUserId: string | undefined
): Promise<string | undefined | "unresolved"> {
  if (!graphUserId) {
    return undefined;
  }

  const lookupId = await siteUsers.resolveLookupId(graphUserId);

  return lookupId === undefined ? "unresolved" : `${fieldName} eq ${lookupId}`;
}

function emptyPage<T>(): RepositoryResult<RepositoryPage<T>> {
  return { ok: true, value: { items: [], nextPageToken: undefined } };
}

async function mapAbsence(
  item: SharePointAbsenceItem,
  siteUsers: SharePointSiteUserDirectory
): Promise<Absence> {
  const startDate = toDateKey(item.StartDate);
  const endDate = toDateKey(item.EndDate);
  const startHalf = normalizeDayHalf(item.StartHalf);
  const endHalf = normalizeDayHalf(item.EndHalf);
  // An unresolvable person leaves the employee id empty rather than dropping the row: the absence
  // is a fact even when the account behind it is gone (EO-430 FR-430.12).
  const employeeId = await siteUsers.resolveGraphUserId(item.UserPersonId);
  const substitute = await siteUsers.resolveGraphUserId(item.SubstitutePersonId);

  return {
    id: `${item.Id ?? employeeId ?? startDate}`,
    employeeId: employeeId ?? "",
    type: normalizeAbsenceType(item.Type),
    startDate,
    startHalf,
    endDate,
    endHalf,
    duration: calculateAbsenceDuration({ startDate, startHalf, endDate, endHalf }),
    substitute,
    comment: item.Comment,
    approvalStatus: normalizeApprovalStatus(item.ApprovalStatus),
    created: item.CreatedAt ?? item.Created ?? new Date().toISOString(),
    modified: item.ModifiedAt ?? item.Modified ?? new Date().toISOString()
  };
}

async function mapPlanningEvent(
  item: SharePointPlanningEventItem,
  siteUsers: SharePointSiteUserDirectory
): Promise<PlanningEvent> {
  return {
    id: `${item.Id ?? ""}`,
    resourceId: (await siteUsers.resolveGraphUserId(item.ResourcePersonId)) ?? "",
    type: normalizePlanningEventType(item.Type),
    title: item.Title ?? "",
    startDate: toDateKey(item.StartDate),
    startHalf: toOptionalDayHalf(item.StartHalf),
    endDate: toDateKey(item.EndDate),
    endHalf: toOptionalDayHalf(item.EndHalf),
    absenceId: item.AbsenceId,
    approvalStatus: toOptionalApprovalStatus(item.ApprovalStatus)
  };
}

async function mapVacationBalance(
  item: SharePointVacationBalanceItem,
  siteUsers: SharePointSiteUserDirectory
): Promise<VacationBalanceRecord> {
  return {
    employeeId: (await siteUsers.resolveGraphUserId(item.UserPersonId)) ?? "",
    year: Number(item.Year ?? new Date().getFullYear()),
    allowanceDays: Number(item.Entitlement ?? 0),
    carriedOverDays: Number(item.CarryForward ?? 0),
    manualAdjustmentDays: Number(item.ManualAdjustment ?? 0),
    comment: item.Comment
  };
}

function mapPublicHoliday(item: SharePointPublicHolidayItem): PublicHoliday {
  return {
    date: toDateKey(item.Date),
    label: item.Title ?? "",
    location: normalizeHolidayLocation(item.Location)
  };
}

function normalizeHolidayLocation(value: string | undefined): PublicHoliday["location"] {
  return value === "SG" || value === "Dübendorf" ? value : undefined;
}

function mapTeamPlanningConfiguration(item: SharePointTeamPlanningConfigurationItem): TeamPlanningConfiguration {
  return {
    teamId: item.TeamId ?? "",
    planningName: item.PlanningName ?? item.TeamId ?? "",
    defaultView: item.DefaultView,
    defaultCapacityThreshold: item.DefaultCapacityThreshold
  };
}

function parseResourceProfiles(items: readonly SharePointPlanningSettingItem[]): PlanningSettings["resourceProfiles"] {
  const profileSetting = items.find((item) => item.Key === "ResourceProfiles");

  if (!profileSetting?.Value) {
    return [];
  }

  try {
    const parsed = JSON.parse(profileSetting.Value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isResourceProfile)
      .map((profile) => ({
        employeeId: profile.employeeId,
        employmentRate: profile.employmentRate,
        workingDays: profile.workingDays
      }));
  } catch {
    return [];
  }
}

function isResourceProfile(value: unknown): value is PlanningSettings["resourceProfiles"][number] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const profile = value as { readonly employeeId?: unknown; readonly employmentRate?: unknown; readonly workingDays?: unknown };

  return typeof profile.employeeId === "string";
}

function normalizeAbsenceType(value: string | undefined): AbsenceType {
  // AbsenceType is an open string union so Team Admin configured custom types pass through.
  const trimmed = value?.trim();

  return trimmed ? trimmed : "otherAbsence";
}

function normalizePlanningEventType(value: string | undefined): PlanningEventType {
  const supportedTypes: readonly PlanningEventType[] = [
    "vacation",
    "compensation",
    "education",
    "training",
    "military",
    "unpaidLeave",
    "otherAbsence",
    "homeOffice",
    "project",
    "maintenance",
    "onCall",
    "standby"
  ];

  return supportedTypes.find((type) => type === value) ?? "otherAbsence";
}

function normalizeApprovalStatus(value: string | undefined): AbsenceApprovalStatus {
  return toOptionalApprovalStatus(value) ?? "approved";
}

function toOptionalApprovalStatus(value: string | undefined): AbsenceApprovalStatus | undefined {
  return value === "draft" || value === "pendingApproval" || value === "approved" || value === "rejected"
    ? value
    : undefined;
}

function normalizeDayHalf(value: string | undefined): DayHalf {
  return toOptionalDayHalf(value) ?? "fullDay";
}

function toOptionalDayHalf(value: string | undefined): DayHalf | undefined {
  return value === "morning" || value === "afternoon" || value === "fullDay" ? value : undefined;
}

function toDateKey(value: string | undefined): string {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

function equals(fieldName: string, value: string): string {
  return `${fieldName} eq '${value.replace(/'/g, "''")}'`;
}

function createAndFilter(parts: readonly (string | undefined)[]): string | undefined {
  const activeParts = parts.filter((part): part is string => Boolean(part));

  return activeParts.length > 0 ? activeParts.join(" and ") : undefined;
}

function unsupportedWrite<T>(message: string): Promise<RepositoryResult<T>> {
  return Promise.resolve({
    ok: false,
    error: {
      code: "validation",
      message,
      recoverable: false
    }
  });
}

function unavailableResult<T>(message: string): RepositoryResult<T> {
  return {
    ok: false,
    error: {
      code: "validation",
      message,
      recoverable: true
    }
  };
}
