import { absenceTypes } from "../../../data/absenceTypes";
import { loadPersistedMockState, savePersistedMockState } from "../../../data/mockStatePersistence";
import { mockResources } from "../../../data/mockResources";
import type { PublicHoliday } from "../../../models/capacity";
import {
  renameRequiredStaffingTeam,
  setRequiredStaffing
} from "../../../data/teamRequiredStaffing";
import { getRuntimeConfiguration } from "../../../infrastructure/deployment/runtimeConfig";
import { resilientFetch } from "../../../infrastructure/http/resilientFetch";
import { invalidatePlanningBootstrapCache } from "../../../services/planningBootstrapService";
import {
  createMicrosoft365ClientFoundation,
  type Microsoft365ClientFoundation
} from "../../../infrastructure/microsoft365";
import { resolveActiveTeamId } from "../../../infrastructure/microsoft365/currentUser";
import type {
  TeamAdminAbsenceEntryType,
  TeamAdminAbsenceEntryTypePatch,
  TeamAdminDetails,
  TeamAdminMember,
  TeamAdminOutlookSyncPolicy,
  TeamAdminPerson,
  TeamAdminSummary,
  TeamAdminTeamOption,
  TeamMemberAssignmentPatch,
  TeamSettings,
  TeamSettingsPatch
} from "../types/teamSettings";

export const allTeamsId = "__all-teams";

export type TeamAdminValidationCode =
  | "teamNameRequired"
  | "teamNameDuplicate"
  | "teamHasMembers"
  | "lastTeam";

export class TeamAdminValidationError extends Error {
  constructor(readonly code: TeamAdminValidationCode) {
    super(`Team management validation failed: ${code}`);
    this.name = "TeamAdminValidationError";
  }
}

// EO-408: The Team Admin Center is fully backed by the RPP Web API + SQL.
// This module keeps a small read cache so synchronous consumers
// (Timeline sort order, approval exemptions, settings policies) stay working.

interface TeamRecord {
  readonly teamId: string;
  readonly teamName: string;
  readonly organization: string;
  readonly sortOrder: number;
  readonly requiredStaffing: number;
  readonly color?: string; // EO-423 palette key
  readonly canManage: boolean;
  readonly memberCount: number;
  readonly settings: TeamSettings;
}

interface TeamSummaryResponse {
  readonly teamId: string;
  readonly teamName: string;
  readonly organization: string;
  readonly sortOrder: number;
  readonly requiredStaffing: number;
  readonly color?: string | null;
  readonly canManage: boolean;
  readonly memberCount: number;
  readonly teamLeadUserId: string;
  readonly defaultApproverUserId: string;
  readonly backupApproverUserId?: string | null;
  readonly allowUserOverride: boolean;
  readonly outlookSyncPolicy: string;
}

interface MemberResponse {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly primaryTeamId: string;
  readonly additionalTeamIds: readonly string[];
  readonly employmentPercentage?: number | null;
  readonly vacationBalance: number;
  readonly activeVacationRequests: number;
  readonly approvalExempt: boolean;
  readonly effectiveApproverUserId?: string | null;
}

interface DetailsResponse {
  readonly team: TeamSummaryResponse;
  readonly allowedApprovers: readonly TeamAdminPerson[];
  readonly members: readonly MemberResponse[];
  readonly assignableMembers: readonly MemberResponse[];
  readonly absenceEntryTypes: readonly TeamAdminAbsenceEntryType[];
  readonly teamOptions: readonly TeamAdminTeamOption[];
  readonly canEdit: boolean;
}

let teamRecords: readonly TeamRecord[] = [];
let knownPeople: ReadonlyMap<string, TeamAdminPerson> = new Map();
let allMemberCache: readonly TeamAdminMember[] = [];
let absenceEntryTypesCache: readonly TeamAdminAbsenceEntryType[] = createDefaultAbsenceEntryTypes();

let microsoft365Foundation: Microsoft365ClientFoundation | undefined;

// Exported for API consumers outside this module (EO-421 photo service).
export async function getApiAuthorizationHeader(): Promise<Record<string, string>> {
  // EO-405: attach the Teams SSO token when available; outside Teams the request
  // stays unauthenticated and relies on the server-side development bypass.
  try {
    const { apiAccessTokenScopes } = getRuntimeConfiguration();

    if (apiAccessTokenScopes.length === 0) {
      return {};
    }

    microsoft365Foundation ??= createMicrosoft365ClientFoundation({});

    const tokenResult = await microsoft365Foundation.authProvider.getAccessToken({
      scopes: apiAccessTokenScopes
    });

    return tokenResult.ok && tokenResult.value.token
      ? { Authorization: `Bearer ${tokenResult.value.token}` }
      : {};
  } catch {
    return {};
  }
}

export class TeamAdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "TeamAdminApiError";
  }
}

async function teamAdminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const runtimeConfiguration = getRuntimeConfiguration();
  const apiBaseUrl = runtimeConfiguration.planningDataSource === "api" ? runtimeConfiguration.apiBaseUrl : undefined;

  if (!apiBaseUrl) {
    return handleMockTeamAdminRequest<T>(path, init);
  }

  const activeTeamId = await resolveActiveTeamId();

  const response = await resilientFetch(`${apiBaseUrl}/api/planning/teamadmin/${path}`, {
    credentials: "include",
    ...init,
    headers: {
      Accept: "application/json",
      ...(activeTeamId ? { "X-RPP-Active-TeamId": activeTeamId } : {}),
      ...(await getApiAuthorizationHeader()),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  }, {
    component: "teamAdminApi",
    operation: init?.method?.toLowerCase() ?? "get"
  });

  if (response.status === 409) {
    const conflict = await response.json().catch(() => undefined) as { readonly code?: string } | undefined;
    const code = conflict?.code;

    if (code === "teamNameRequired" || code === "teamNameDuplicate" || code === "teamHasMembers" || code === "lastTeam") {
      throw new TeamAdminValidationError(code);
    }
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new TeamAdminApiError(
      response.status,
      `Team Admin API request failed with status ${response.status}${bodyText ? `: ${bodyText.slice(0, 240)}` : "."}`
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

// EO-419: the module caches hold one host-team context; a context switch within a
// session must never leak the previous team's data.
let cacheContextTeamId: string | null = null;

async function ensureCacheContext(): Promise<void> {
  const activeTeamId = (await resolveActiveTeamId()) ?? "";

  if (cacheContextTeamId !== null && cacheContextTeamId !== activeTeamId) {
    teamRecords = [];
    knownPeople = new Map();
    allMemberCache = [];
  }

  cacheContextTeamId = activeTeamId;
}

// ── Mock team admin data (demo mode, no API) ──────────────────────────────

// EO-423: assigned team colors survive reloads in demo mode.
const mockTeamColorsPersistenceKey = "teamAdmin.teamColors";

function loadMockTeamColors(): Readonly<Record<string, string>> {
  return loadPersistedMockState<Readonly<Record<string, string>>>(mockTeamColorsPersistenceKey, {});
}

function buildMockTeams(): readonly TeamRecord[] {
  // Derive unique teams from mockResources
  const teamSet = new Map<string, { name: string; org: string }>();
  mockResources.forEach((resource) => {
    const teams = [resource.primaryTeam, ...resource.additionalTeams];
    teams.forEach((teamName) => {
      if (!teamSet.has(teamName)) {
        teamSet.set(teamName, { name: teamName, org: resource.organization });
      }
    });
  });

  const teamColors = loadMockTeamColors();

  return Array.from(teamSet.entries()).map(([teamId, info], index) => ({
    teamId: teamId.toLowerCase().replace(/\s+/g, "-"),
    teamName: info.name,
    organization: info.org,
    sortOrder: index + 1,
    requiredStaffing: 0,
    color: teamColors[teamId.toLowerCase().replace(/\s+/g, "-")],
    canManage: true,
    memberCount: mockResources.filter((r) =>
      r.primaryTeam === info.name || r.additionalTeams.includes(info.name)
    ).length,
    settings: {
      teamId: teamId.toLowerCase().replace(/\s+/g, "-"),
      teamLeadUserId: "mock-lead",
      defaultApproverUserId: "mock-approver",
      backupApproverUserId: undefined,
      approvalPolicy: {
        allowUserOverride: true,
        outlookSync: "optional" as const
      }
    }
  }));
}

function buildMockMembers(): readonly MemberResponse[] {
  return mockResources.map((resource) => ({
    userId: resource.id.replace("resource-", ""),
    displayName: resource.displayName,
    email: `${resource.id.replace("resource-", "")}@example.com`,
    primaryTeamId: resource.primaryTeam.toLowerCase().replace(/\s+/g, "-"),
    additionalTeamIds: resource.additionalTeams.map((t) => t.toLowerCase().replace(/\s+/g, "-")),
    employmentPercentage: resource.employmentRate ? resource.employmentRate * 100 : 100,
    vacationBalance: resource.vacation.annualEntitlement,
    activeVacationRequests: resource.vacation.booked,
    approvalExempt: false,
    effectiveApproverUserId: null
  }));
}

function buildMockPeople(): readonly TeamAdminPerson[] {
  return mockResources.map((resource) => ({
    userId: resource.id.replace("resource-", ""),
    displayName: resource.displayName,
    email: `${resource.id.replace("resource-", "")}@example.com`
  }));
}

function handleMockTeamAdminRequest<T>(path: string, init?: RequestInit): T {
  // GET teams → list of team summaries
  if (path === "teams" && (!init || init.method === undefined)) {
    teamRecords = buildMockTeams();
    return { items: teamRecords.map(toTeamSummaryResponse) } as T;
  }

  // GET details/:teamId → team details with members
  if (path.startsWith("details/")) {
    teamRecords = buildMockTeams();
    const people = buildMockPeople();
    knownPeople = new Map(people.map((p) => [p.userId, p]));
    const members = buildMockMembers();
    allMemberCache = members.map((m) => mapMember(m, "mock-approver"));
    absenceEntryTypesCache = createDefaultAbsenceEntryTypes();

    const teamId = path.replace("details/", "");
    const team = teamRecords.find((t) => t.teamId === teamId) ?? teamRecords[0];
    const teamMembers = teamId === allTeamsId
      ? members
      : members.filter((m) => m.primaryTeamId === team?.teamId || m.additionalTeamIds.includes(team?.teamId ?? ""));

    return {
      team: team ? toTeamSummaryResponse(team) : toTeamSummaryResponse(teamRecords[0]!),
      allowedApprovers: people,
      members: teamMembers,
      assignableMembers: members.filter((m) => !teamMembers.some((tm) => tm.userId === m.userId)),
      absenceEntryTypes: absenceEntryTypesCache,
      teamOptions: teamRecords.map((t) => ({ teamId: t.teamId, teamName: t.teamName })),
      canEdit: true
    } as T;
  }

  // PATCH details → save and return updated details (mock: return current state)
  if (path === "details" && init?.method === "PATCH") {
    return {
      team: teamRecords[0] ? toTeamSummaryResponse(teamRecords[0]) : undefined,
      allowedApprovers: [...knownPeople.values()],
      members: buildMockMembers(),
      assignableMembers: [],
      absenceEntryTypes: absenceEntryTypesCache,
      teamOptions: teamRecords.map((t) => ({ teamId: t.teamId, teamName: t.teamName })),
      canEdit: true
    } as T;
  }

  // PATCH teams → apply rename/reorder/organisation/staffing/color to the cache
  // (EO-423: colors additionally persist browser-local).
  if (path === "teams" && init?.method === "PATCH") {
    const body = init.body
      ? JSON.parse(String(init.body)) as { readonly teams?: readonly TeamRowPatch[] }
      : undefined;

    if (body?.teams) {
      teamRecords = teamRecords.map((record) => {
        const row = body.teams!.find((candidate) => candidate.teamId === record.teamId);

        return row
          ? {
              ...record,
              teamName: row.teamName || record.teamName,
              organization: row.organization || record.organization,
              sortOrder: row.sortOrder,
              requiredStaffing: row.requiredStaffing,
              color: row.color || undefined
            }
          : record;
      });

      savePersistedMockState(
        mockTeamColorsPersistenceKey,
        Object.fromEntries(teamRecords.filter((record) => record.color).map((record) => [record.teamId, record.color!]))
      );
    }

    return { items: teamRecords.map(toTeamSummaryResponse) } as T;
  }

  // POST teams → create team (mock: no-op)
  if (path === "teams" && init?.method === "POST") {
    return {
      teamId: "mock-new-team",
      teamName: "New Team",
      organization: "Organisation-A",
      sortOrder: teamRecords.length + 1,
      requiredStaffing: 0,
      canManage: true,
      memberCount: 0,
      teamLeadUserId: "mock-lead",
      defaultApproverUserId: "mock-approver",
      backupApproverUserId: null,
      allowUserOverride: true,
      outlookSyncPolicy: "optional"
    } as T;
  }

  // DELETE teams/:id → delete team (mock: no-op)
  if (path.startsWith("teams/") && init?.method === "DELETE") {
    return undefined as T;
  }

  // displayconfig
  if (path === "displayconfig") {
    return { showVacationSummary: true } as T;
  }

  // orgconfig
  if (path === "orgconfig") {
    return {
      organisations: [{ id: "org-organisation-a", name: "Organisation-A", sortOrder: 1 }, { id: "org-organisation-b", name: "Organisation-B", sortOrder: 2 }],
      locations: [{ id: "loc-sg", name: "St. Gallen", sortOrder: 1 }, { id: "loc-due", name: "Dübendorf", sortOrder: 2 }],
      mappings: [],
      unmappedOrganisationValues: [],
      unmappedLocationValues: []
    } as T;
  }

  // holidays
  if (path === "holidays") {
    return { items: [] } as T;
  }

  // Fallback for unknown paths
  return undefined as T;
}

interface TeamRowPatch {
  readonly teamId: string;
  readonly teamName: string;
  readonly organization: string;
  readonly sortOrder: number;
  readonly requiredStaffing: number;
  readonly color?: string;
}

function toTeamSummaryResponse(team: TeamRecord): TeamSummaryResponse {
  return {
    teamId: team.teamId,
    teamName: team.teamName,
    organization: team.organization,
    sortOrder: team.sortOrder,
    requiredStaffing: team.requiredStaffing,
    color: team.color ?? null,
    canManage: team.canManage,
    memberCount: team.memberCount,
    teamLeadUserId: team.settings.teamLeadUserId,
    defaultApproverUserId: team.settings.defaultApproverUserId,
    backupApproverUserId: team.settings.backupApproverUserId ?? null,
    allowUserOverride: team.settings.approvalPolicy.allowUserOverride,
    outlookSyncPolicy: team.settings.approvalPolicy.outlookSync
  };
}

export async function getManagedTeams(): Promise<readonly TeamAdminSummary[]> {
  await ensureCacheContext();
  const response = await teamAdminRequest<{ readonly items: readonly TeamSummaryResponse[] }>("teams");

  applyTeamSummaries(response.items ?? []);

  return sortedTeamRecords().map(toSummary);
}

export async function createTeam(teamName: string, organization: string): Promise<TeamAdminSummary> {
  const normalizedName = teamName.trim();

  if (!normalizedName) {
    throw new TeamAdminValidationError("teamNameRequired");
  }

  const sourceTeamId = await resolveActiveTeamId();

  const createdTeam = await teamAdminRequest<TeamSummaryResponse>("teams", {
    method: "POST",
    body: JSON.stringify({ teamName: normalizedName, organization, sourceTeamId })
  });

  await getManagedTeams();

  const record = teamRecords.find((team) => team.teamId === createdTeam.teamId);

  return record ? toSummary(record) : toSummary(mapTeamSummary(createdTeam));
}

export async function renameTeam(teamId: string, teamName: string): Promise<void> {
  const team = findTeamOrThrow(teamId);
  const normalizedName = teamName.trim();

  if (!normalizedName) {
    throw new TeamAdminValidationError("teamNameRequired");
  }

  await updateTeamRows((record) =>
    record.teamId === teamId ? { ...record, teamName: normalizedName } : record
  );
  renameRequiredStaffingTeam(team.teamName, normalizedName);
}

export async function setTeamOrganization(teamId: string, organization: string): Promise<void> {
  findTeamOrThrow(teamId);
  await updateTeamRows((record) =>
    record.teamId === teamId ? { ...record, organization } : record
  );
}

// EO-423: palette color key per team ("" clears the assignment → automatic color).
export async function setTeamColor(teamId: string, color: string): Promise<void> {
  findTeamOrThrow(teamId);
  await updateTeamRows((record) =>
    record.teamId === teamId ? { ...record, color: color || undefined } : record
  );
}

// EO-423: synchronous color lookup for the timeline/calendar renderers.
export function getTeamColorsByTeamName(): ReadonlyMap<string, string> {
  return new Map(
    teamRecords
      .filter((record) => record.color)
      .map((record) => [record.teamName, record.color!])
  );
}

export async function setTeamRequiredStaffing(teamId: string, requiredStaffing: number): Promise<void> {
  findTeamOrThrow(teamId);

  const normalizedValue = Number.isFinite(requiredStaffing) ? Math.max(0, Math.round(requiredStaffing)) : 0;

  await updateTeamRows((record) =>
    record.teamId === teamId ? { ...record, requiredStaffing: normalizedValue } : record
  );
}

export async function reorderTeam(teamId: string, targetTeamId: string): Promise<void> {
  const orderedTeams = sortedTeamRecords();
  const teamIndex = orderedTeams.findIndex((record) => record.teamId === teamId);
  const targetIndex = orderedTeams.findIndex((record) => record.teamId === targetTeamId);

  if (teamIndex < 0 || targetIndex < 0) {
    throw new Error(`Team ${teamId} was not found.`);
  }

  if (teamIndex === targetIndex) {
    return;
  }

  const nextTeams = orderedTeams.filter((record) => record.teamId !== teamId);
  nextTeams.splice(targetIndex, 0, orderedTeams[teamIndex]);

  const orderByTeamId = new Map(nextTeams.map((record, index) => [record.teamId, index + 1]));

  await updateTeamRows((record) => ({
    ...record,
    sortOrder: orderByTeamId.get(record.teamId) ?? record.sortOrder
  }));
}

export async function deleteTeam(teamId: string): Promise<void> {
  findTeamOrThrow(teamId);

  if (teamRecords.length <= 1) {
    throw new TeamAdminValidationError("lastTeam");
  }

  await teamAdminRequest<void>(`teams/${encodeURIComponent(teamId)}`, { method: "DELETE" });
  await getManagedTeams();
}

export async function getTeamDetails(teamId: string): Promise<TeamAdminDetails> {
  await ensureCacheContext();
  const response = await teamAdminRequest<DetailsResponse>(`details/${encodeURIComponent(teamId)}`);

  return applyDetailsResponse(response);
}

export async function getAllTeamDetails(): Promise<TeamAdminDetails> {
  await ensureCacheContext();
  const response = await teamAdminRequest<DetailsResponse>(`details/${allTeamsId}`);

  return applyDetailsResponse(response);
}

export async function patchTeamSettings(teamId: string, patch: TeamSettingsPatch): Promise<TeamAdminDetails> {
  const team = findTeamOrThrow(teamId);
  const outlookSync = patch.approvalPolicy?.outlookSync ?? team.settings.approvalPolicy.outlookSync;
  assertOutlookSyncPolicy(outlookSync);

  const response = await teamAdminRequest<DetailsResponse>("details", {
    method: "PATCH",
    body: JSON.stringify({
      teamId,
      settings: {
        teamLeadUserId: patch.teamLeadUserId ?? team.settings.teamLeadUserId,
        defaultApproverUserId: patch.defaultApproverUserId ?? team.settings.defaultApproverUserId,
        backupApproverUserId: patch.backupApproverUserId ?? undefined,
        allowUserOverride: patch.approvalPolicy?.allowUserOverride ?? team.settings.approvalPolicy.allowUserOverride,
        outlookSyncPolicy: outlookSync
      },
      memberAssignments: mapMemberAssignmentPatches(patch.memberAssignments ?? []),
      absenceEntryTypes: mapAbsenceEntryTypePatches(patch.absenceEntryTypes)
    })
  });

  await getManagedTeams();

  return applyDetailsResponse(response);
}

export async function patchAllTeamMembers(
  patch: Pick<TeamSettingsPatch, "memberAssignments" | "absenceEntryTypes">
): Promise<TeamAdminDetails> {
  const response = await teamAdminRequest<DetailsResponse>("details", {
    method: "PATCH",
    body: JSON.stringify({
      teamId: allTeamsId,
      memberAssignments: mapMemberAssignmentPatches(patch.memberAssignments ?? []),
      absenceEntryTypes: mapAbsenceEntryTypePatches(patch.absenceEntryTypes)
    })
  });

  await getManagedTeams();

  return applyDetailsResponse(response);
}

/**
 * Remove one person from RPP planning (does not touch M365/Entra).
 * 1) Prefer DELETE /teamadmin/members/{userId} (hard delete).
 * 2) Fall back to a minimal PATCH that only clears that user's assignments — works on
 *    older APIs that do not expose DELETE yet, and avoids rewriting every other member.
 */
export async function removeMemberFromPlanning(userId: string): Promise<{ readonly removedAssignments: number }> {
  const normalizedUserId = userId.trim();
  const runtimeConfiguration = getRuntimeConfiguration();
  const apiBaseUrl = runtimeConfiguration.planningDataSource === "api" ? runtimeConfiguration.apiBaseUrl : undefined;

  if (!apiBaseUrl) {
    allMemberCache = allMemberCache.filter(
      (member) => member.userId.toLocaleLowerCase() !== normalizedUserId.toLocaleLowerCase()
    );
    return { removedAssignments: 1 };
  }

  let removedAssignments = 0;

  try {
    const result = await teamAdminRequest<{ readonly userId: string; readonly removedAssignments: number }>(
      `members/${encodeURIComponent(normalizedUserId)}`,
      { method: "DELETE" }
    );
    removedAssignments = result.removedAssignments ?? 1;
  } catch (error: unknown) {
    const status = error instanceof TeamAdminApiError ? error.status : 0;
    // 404/405: API build without DELETE route. 401/403 still surface — do not mask auth failures
    // as a successful remove.
    if (status !== 404 && status !== 405) {
      throw error;
    }

    await teamAdminRequest<DetailsResponse>("details", {
      method: "PATCH",
      body: JSON.stringify({
        teamId: allTeamsId,
        memberAssignments: [
          {
            userId: normalizedUserId,
            primaryTeamId: "",
            additionalTeamIds: [] as readonly string[],
            approvalExempt: false,
            employmentPercentage: 100,
            vacationBalance: 0
          }
        ]
      })
    });
    removedAssignments = 1;
  }

  allMemberCache = allMemberCache.filter(
    (member) => member.userId.toLocaleLowerCase() !== normalizedUserId.toLocaleLowerCase()
  );
  invalidatePlanningBootstrapCache();

  return { removedAssignments };
}

export function getTeamPolicyForUserSettings(teamId: string): {
  readonly defaultApproverUserId: string;
  readonly allowApproverOverride: boolean;
  readonly manageOutlookSync: boolean;
} {
  const team = teamRecords.find((record) => record.teamId === teamId) ?? sortedTeamRecords()[0];
  const policy = team?.settings.approvalPolicy;

  return {
    defaultApproverUserId: team?.settings.defaultApproverUserId ?? "",
    allowApproverOverride: policy?.allowUserOverride ?? true,
    manageOutlookSync: policy?.outlookSync !== undefined && policy.outlookSync !== "optional"
  };
}

export function isApprovalExemptResource(resourceId: string): boolean {
  const userId = resourceId.replace("resource-", "");

  return Boolean(allMemberCache.find((member) => member.userId === userId)?.approvalExempt);
}

// EO-410: Team Admin is the approval routing source for the api data source —
// member-level effective approver first, then the primary team's default approver.
export function getEffectiveApproverUserIdForResource(resourceId: string): string | undefined {
  const userId = resourceId.replace("resource-", "");
  const member = allMemberCache.find((candidate) => candidate.userId === userId);

  if (!member) {
    return undefined;
  }

  if (member.effectiveApproverUserId) {
    return member.effectiveApproverUserId;
  }

  const team = teamRecords.find((record) => record.teamId === member.primaryTeamId)
    ?? teamRecords.find((record) => record.teamName === member.primaryTeamName);

  return team?.settings.defaultApproverUserId || undefined;
}

export function getTeamIdForResource(resourceId: string): string | undefined {
  const userId = resourceId.replace("resource-", "");

  return allMemberCache.find((candidate) => candidate.userId === userId)?.primaryTeamId;
}

// EO-417: approver selection for the absence request form. The default follows the
// member's effective approver (then the team default); the Team Admin policy
// "allow user override" decides whether other approvers are selectable.
export interface ApproverOptions {
  readonly defaultApproverUserId?: string;
  readonly allowOverride: boolean;
  readonly candidates: readonly { readonly userId: string; readonly displayName: string }[];
}

export function getApproverOptionsForResource(resourceId: string): ApproverOptions {
  const userId = resourceId.replace("resource-", "");
  const member = allMemberCache.find((candidate) => candidate.userId === userId);
  const team = member
    ? teamRecords.find((record) => record.teamId === member.primaryTeamId)
      ?? teamRecords.find((record) => record.teamName === member.primaryTeamName)
    : teamRecords[0];

  // Fallback chain mirrors the API: effective → default → team lead.
  // Empty DefaultApprover after EO-456 seed previously left the form on "–".
  const defaultApproverUserId =
    member?.effectiveApproverUserId
    || team?.settings.defaultApproverUserId
    || team?.settings.teamLeadUserId
    || undefined;

  return {
    defaultApproverUserId: defaultApproverUserId || undefined,
    allowOverride: team?.settings.approvalPolicy.allowUserOverride ?? true,
    candidates: allMemberCache
      .filter((candidate) => candidate.userId !== userId)
      .map((candidate) => ({ userId: candidate.userId, displayName: candidate.displayName }))
      .sort((first, second) => first.displayName.localeCompare(second.displayName))
  };
}

interface ApprovalOptionsApiResponse {
  readonly defaultApproverUserId?: string | null;
  readonly allowOverride?: boolean;
  readonly approvalExempt?: boolean;
  readonly candidates?: readonly { readonly userId: string; readonly displayName: string }[];
}

/**
 * Member-readable approval picker from the API. Does not require Team Admin ownership
 * (unlike getAllTeamDetails, which non-owners cannot warm into the module cache).
 */
export async function fetchApproverOptionsForResource(resourceId: string): Promise<ApproverOptions> {
  const userId = resourceId.replace("resource-", "");
  const { apiBaseUrl, planningDataSource } = getRuntimeConfiguration();

  if (planningDataSource !== "api" || !apiBaseUrl) {
    return getApproverOptionsForResource(resourceId);
  }

  try {
    const activeTeamId = await resolveActiveTeamId();
    const query = new URLSearchParams();
    if (userId) {
      query.set("employeeId", userId);
    }

    const response = await resilientFetch(
      `${apiBaseUrl}/api/planning/approval-options?${query.toString()}`,
      {
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(await getApiAuthorizationHeader()),
          ...(activeTeamId ? { "X-RPP-Active-TeamId": activeTeamId } : {})
        }
      },
      { component: "teamAdminApi", operation: "fetchApproverOptions" }
    );

    if (!response.ok) {
      return getApproverOptionsForResource(resourceId);
    }

    const payload = (await response.json()) as ApprovalOptionsApiResponse;
    const candidates = (payload.candidates ?? [])
      .filter((candidate) => candidate.userId && candidate.userId !== userId)
      .map((candidate) => ({
        userId: candidate.userId,
        displayName: candidate.displayName || candidate.userId
      }))
      .sort((first, second) => first.displayName.localeCompare(second.displayName));

    // Mirror into the module cache so synchronous routing (createRoutingRule) sees
    // the same default/candidates on submit without another round-trip.
    if (candidates.length > 0 || payload.defaultApproverUserId) {
      applyApprovalOptionsToCache(userId, payload, candidates);
    }

    return {
      defaultApproverUserId: payload.defaultApproverUserId || undefined,
      allowOverride: payload.allowOverride ?? true,
      candidates
    };
  } catch {
    return getApproverOptionsForResource(resourceId);
  }
}

function applyApprovalOptionsToCache(
  userId: string,
  payload: ApprovalOptionsApiResponse,
  candidates: readonly { readonly userId: string; readonly displayName: string }[]
): void {
  const defaultApproverId = payload.defaultApproverUserId || undefined;
  const defaultApproverPerson: TeamAdminPerson | undefined = defaultApproverId
    ? {
        userId: defaultApproverId,
        displayName:
          candidates.find((candidate) => candidate.userId === defaultApproverId)?.displayName
          ?? defaultApproverId,
        email: ""
      }
    : undefined;

  if (teamRecords.length > 0 && defaultApproverId) {
    teamRecords = teamRecords.map((record, index) => {
      if (index !== 0 && record.settings.defaultApproverUserId) {
        return record;
      }

      return {
        ...record,
        settings: {
          ...record.settings,
          defaultApproverUserId: record.settings.defaultApproverUserId || defaultApproverId,
          teamLeadUserId: record.settings.teamLeadUserId || defaultApproverId
        }
      };
    });
  }

  const known = new Map(allMemberCache.map((member) => [member.userId, member]));
  const emptyApprover: TeamAdminPerson = {
    userId: "",
    displayName: "",
    email: ""
  };

  for (const candidate of candidates) {
    if (!known.has(candidate.userId)) {
      known.set(candidate.userId, {
        userId: candidate.userId,
        displayName: candidate.displayName,
        email: "",
        primaryTeamId: teamRecords[0]?.teamId ?? "",
        primaryTeamName: teamRecords[0]?.teamName ?? "",
        additionalPositions: [],
        vacationBalance: 25,
        activeVacationRequests: 0,
        approvalExempt: false,
        effectiveApproverUserId: undefined,
        effectiveApprover: defaultApproverPerson ?? emptyApprover
      });
    }
  }

  if (userId && known.has(userId) && defaultApproverId) {
    const current = known.get(userId)!;
    known.set(userId, {
      ...current,
      effectiveApproverUserId: current.effectiveApproverUserId || defaultApproverId,
      effectiveApprover: current.effectiveApprover?.userId
        ? current.effectiveApprover
        : defaultApproverPerson ?? emptyApprover
    });
  }

  allMemberCache = Array.from(known.values());
}

// FR-413.5: real contact data for the person card fallback (no fabricated values).
export function getMemberEmailForResource(resourceId: string): string | undefined {
  const userId = resourceId.replace("resource-", "");

  return allMemberCache.find((candidate) => candidate.userId === userId)?.email || undefined;
}

/** Resolve a Graph/Entra object id to a display name from the warm membership cache. */
export function resolveMemberDisplayName(userId: string | undefined): string | undefined {
  if (!userId) {
    return undefined;
  }

  const fromPeople = knownPeople.get(userId)?.displayName;
  if (fromPeople) {
    return fromPeople;
  }

  return allMemberCache.find((candidate) => candidate.userId === userId)?.displayName;
}

// === EO-418: caller access summary (tab gating, admin guards) ===

export interface AccessInfo {
  readonly isTeamOwner: boolean;
  readonly isAppAdmin: boolean;
  // Resolved server-side via Graph (the Teams client context may deliver the
  // channel name like "Allgemein" instead of the team name).
  readonly teamDisplayName?: string;
  // EO-428 FR-428.4: B2B guest of the active team. Guests are never team administrators, and the
  // server already enforces it — this is here so the UI can leave those surfaces out rather than
  // offer them and refuse on use.
  readonly isGuest?: boolean;
}

export async function getAccessInfo(): Promise<AccessInfo> {
  const { apiBaseUrl, planningDataSource } = getRuntimeConfiguration();

  // Mock/demo mode has no server-side roles — everything is accessible.
  if (planningDataSource !== "api" || !apiBaseUrl) {
    return { isTeamOwner: true, isAppAdmin: true };
  }

  try {
    const activeTeamId = await resolveActiveTeamId();
    const response = await resilientFetch(`${apiBaseUrl}/api/planning/access`, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(await getApiAuthorizationHeader()),
        ...(activeTeamId ? { "X-RPP-Active-TeamId": activeTeamId } : {})
      }
    }, {
      component: "teamAdminApi",
      operation: "getAccessInfo"
    });

    if (!response.ok) {
      return { isTeamOwner: false, isAppAdmin: false };
    }

    return await response.json() as AccessInfo;
  } catch {
    return { isTeamOwner: false, isAppAdmin: false };
  }
}

// EO-418: per-tenant reset of the holiday calendar (app-admin only, server-enforced).
export async function clearHolidayCalendar(): Promise<void> {
  const { apiBaseUrl } = getRuntimeConfiguration();

  if (!apiBaseUrl) {
    throw new Error("Clearing the holiday calendar requires the API data source.");
  }

  const response = await resilientFetch(`${apiBaseUrl}/api/planning/appadmin/holidays/clear`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(await getApiAuthorizationHeader())
    }
  }, {
    component: "teamAdminApi",
    operation: "clearHolidayCalendar"
  });

  if (!response.ok) {
    throw new Error(`Holiday calendar clear failed with status ${response.status}.`);
  }

  invalidatePlanningBootstrapCache();
}

// === EO-416: holiday calendar persistence ===
// With the api data source the calendar lives in the database (Team Admin Open Data
// refresh writes via the API); the browser-local mock state remains demo-mode only.

const publicHolidayPersistenceKey = "publicHolidays";

export async function loadHolidayCalendar(fallback: readonly PublicHoliday[]): Promise<readonly PublicHoliday[]> {
  if (getRuntimeConfiguration().planningDataSource === "api") {
    const response = await teamAdminRequest<{ readonly items?: readonly PublicHoliday[] }>("holidays");

    return response.items ?? [];
  }

  return loadPersistedMockState<readonly PublicHoliday[]>(publicHolidayPersistenceKey, fallback);
}

export async function saveHolidayCalendar(holidays: readonly PublicHoliday[]): Promise<void> {
  if (getRuntimeConfiguration().planningDataSource === "api") {
    await teamAdminRequest<unknown>("holidays", {
      method: "PATCH",
      body: JSON.stringify({ items: holidays })
    });

    return;
  }

  savePersistedMockState(publicHolidayPersistenceKey, holidays);
}

// === EO-421: tenant-wide display settings ===
// Presentation preferences maintained in the Team Admin Center. With the api data
// source they live in the database (single row); mock/demo mode persists browser-local.

// EO-423: how planning events are colored across Gantt, list and calendar.
export type EventColorMode = "byType" | "byTeam";

export interface DisplayConfig {
  readonly showVacationSummary: boolean;
  readonly eventColorMode: EventColorMode;
}

const defaultDisplayConfig: DisplayConfig = { showVacationSummary: true, eventColorMode: "byType" };

function normalizeDisplayConfig(config: { readonly showVacationSummary?: boolean; readonly eventColorMode?: string }): DisplayConfig {
  return {
    showVacationSummary: config.showVacationSummary ?? true,
    eventColorMode: config.eventColorMode === "byTeam" ? "byTeam" : "byType"
  };
}
const displayConfigPersistenceKey = "displayConfig";
let displayConfigCache: DisplayConfig = defaultDisplayConfig;
const displayConfigListeners = new Set<() => void>();

function setDisplayConfigCache(config: DisplayConfig): void {
  displayConfigCache = config;
  displayConfigListeners.forEach((listener) => listener());
}

// Subscription surface for useSyncExternalStore consumers (Timeline resource rows).
export function subscribeDisplayConfig(listener: () => void): () => void {
  displayConfigListeners.add(listener);
  return () => displayConfigListeners.delete(listener);
}

export function getDisplayConfigSnapshot(): DisplayConfig {
  return displayConfigCache;
}

export async function loadDisplayConfig(): Promise<DisplayConfig> {
  if (getRuntimeConfiguration().planningDataSource === "api") {
    setDisplayConfigCache(normalizeDisplayConfig(await teamAdminRequest<DisplayConfig>("displayconfig")));
  } else {
    setDisplayConfigCache(normalizeDisplayConfig(loadPersistedMockState<DisplayConfig>(displayConfigPersistenceKey, defaultDisplayConfig)));
  }

  return displayConfigCache;
}

export async function saveDisplayConfig(config: DisplayConfig): Promise<DisplayConfig> {
  if (getRuntimeConfiguration().planningDataSource === "api") {
    setDisplayConfigCache(normalizeDisplayConfig(await teamAdminRequest<DisplayConfig>("displayconfig", {
      method: "PATCH",
      body: JSON.stringify(config)
    })));
  } else {
    savePersistedMockState(displayConfigPersistenceKey, config);
    setDisplayConfigCache(normalizeDisplayConfig(config));
  }

  return displayConfigCache;
}

// === EO-415: configurable organisations, locations and profile value mappings ===

export interface OrgConfigEntry {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
}

export interface OrgConfigMapping {
  readonly id: string;
  readonly kind: "organisation" | "location";
  readonly graphValue: string;
  readonly targetId: string;
}

export interface OrgConfig {
  readonly organisations: readonly OrgConfigEntry[];
  readonly locations: readonly OrgConfigEntry[];
  readonly mappings: readonly OrgConfigMapping[];
  readonly unmappedOrganisationValues: readonly string[];
  readonly unmappedLocationValues: readonly string[];
}

export async function getOrgConfig(): Promise<OrgConfig> {
  return teamAdminRequest<OrgConfig>("orgconfig");
}

export async function patchOrgConfig(patch: {
  readonly organisations: readonly OrgConfigEntry[];
  readonly locations: readonly OrgConfigEntry[];
  readonly mappings: readonly OrgConfigMapping[];
}): Promise<OrgConfig> {
  const result = await teamAdminRequest<OrgConfig>("orgconfig", {
    method: "PATCH",
    body: JSON.stringify(patch)
  });

  invalidatePlanningBootstrapCache();

  return result;
}

export function getTeamAdminResourceOverrides(): ReadonlyMap<string, {
  readonly additionalTeams: readonly string[];
  readonly employmentRate?: number;
  readonly primaryTeam: string;
  readonly vacationBalance: number;
}> {
  return new Map(
    allMemberCache
      .filter((member) => member.primaryTeamName)
      .map((member) => [
        member.userId,
        {
          additionalTeams: member.additionalPositions,
          employmentRate: member.employmentPercentage !== undefined ? member.employmentPercentage / 100 : undefined,
          primaryTeam: member.primaryTeamName,
          vacationBalance: member.vacationBalance
        }
      ])
  );
}

export function getTeamAdminTeamSortOrder(): ReadonlyMap<string, number> {
  return new Map(sortedTeamRecords().map((team, index) => [team.teamName, index]));
}

function applyTeamSummaries(items: readonly TeamSummaryResponse[]): void {
  teamRecords = items.map(mapTeamSummary);

  // Mirror required staffing into the local module consumed synchronously
  // by the capacity dashboard and reports.
  teamRecords.forEach((team) => {
    setRequiredStaffing(team.teamName, team.requiredStaffing > 0 ? team.requiredStaffing : undefined);
  });
}

function mapTeamSummary(item: TeamSummaryResponse): TeamRecord {
  return {
    teamId: item.teamId,
    teamName: item.teamName,
    organization: item.organization,
    sortOrder: item.sortOrder,
    requiredStaffing: item.requiredStaffing,
    color: item.color ?? undefined,
    canManage: item.canManage,
    memberCount: item.memberCount,
    settings: {
      teamId: item.teamId,
      teamLeadUserId: item.teamLeadUserId,
      defaultApproverUserId: item.defaultApproverUserId,
      backupApproverUserId: item.backupApproverUserId ?? undefined,
      approvalPolicy: {
        allowUserOverride: item.allowUserOverride,
        outlookSync: normalizeOutlookSyncPolicy(item.outlookSyncPolicy)
      }
    }
  };
}

function applyDetailsResponse(response: DetailsResponse): TeamAdminDetails {
  knownPeople = new Map(response.allowedApprovers.map((person) => [person.userId, person]));

  if (response.absenceEntryTypes.length > 0) {
    absenceEntryTypesCache = response.absenceEntryTypes;
  } else {
    absenceEntryTypesCache = createDefaultAbsenceEntryTypes();
  }

  // Mirror configured absence types for the absence/vacation request forms,
  // which read them synchronously via getConfiguredAbsenceTypes().
  savePersistedMockState("teamAdmin.entryTypes", absenceEntryTypesCache);

  const defaultApproverUserId = response.team.defaultApproverUserId;
  const members = response.members.map((member) => mapMember(member, defaultApproverUserId));
  const assignableMembers = response.assignableMembers.map((member) => mapMember(member, defaultApproverUserId));

  if (response.team.teamId === allTeamsId) {
    allMemberCache = members;
  } else {
    allMemberCache = mergeMemberCache([...members, ...assignableMembers]);
  }

  const summary: TeamAdminSummary = {
    teamId: response.team.teamId,
    teamName: response.team.teamName,
    organization: response.team.organization,
    sortOrder: response.team.sortOrder,
    requiredStaffing: response.team.requiredStaffing,
    teamLead: getPerson(response.team.teamLeadUserId),
    memberCount: response.team.teamId === allTeamsId ? members.length : response.team.memberCount,
    defaultApprover: getPerson(response.team.defaultApproverUserId),
    backupApprover: response.team.backupApproverUserId ? getPerson(response.team.backupApproverUserId) : undefined,
    approvalPolicy: {
      allowUserOverride: response.team.allowUserOverride,
      outlookSync: normalizeOutlookSyncPolicy(response.team.outlookSyncPolicy)
    }
  };

  return {
    team: summary,
    settings: {
      teamId: response.team.teamId,
      teamLeadUserId: response.team.teamLeadUserId,
      defaultApproverUserId: response.team.defaultApproverUserId,
      backupApproverUserId: response.team.backupApproverUserId ?? undefined,
      approvalPolicy: summary.approvalPolicy
    },
    allowedApprovers: [...response.allowedApprovers].sort((first, second) =>
      first.displayName.localeCompare(second.displayName)
    ),
    assignableMembers,
    absenceEntryTypes: absenceEntryTypesCache,
    teamOptions: response.teamOptions,
    members,
    canEdit: response.canEdit
  };
}

function mapMember(member: MemberResponse, defaultApproverUserId: string): TeamAdminMember {
  const teamNameById = new Map(teamRecords.map((team) => [team.teamId, team.teamName]));
  const effectiveApproverUserId = member.effectiveApproverUserId ?? undefined;

  return {
    userId: member.userId,
    displayName: member.displayName,
    email: member.email,
    primaryTeamId: member.primaryTeamId,
    primaryTeamName: teamNameById.get(member.primaryTeamId) ?? "",
    additionalPositions: member.additionalTeamIds
      .map((teamId) => teamNameById.get(teamId))
      .filter((teamName): teamName is string => Boolean(teamName)),
    employmentPercentage: member.employmentPercentage ?? undefined,
    vacationBalance: member.vacationBalance,
    activeVacationRequests: member.activeVacationRequests,
    approvalExempt: member.approvalExempt,
    effectiveApproverUserId,
    effectiveApprover: getPerson(effectiveApproverUserId ?? defaultApproverUserId)
  };
}

function mergeMemberCache(members: readonly TeamAdminMember[]): readonly TeamAdminMember[] {
  const byUserId = new Map(allMemberCache.map((member) => [member.userId, member]));

  members.forEach((member) => byUserId.set(member.userId, member));

  return Array.from(byUserId.values());
}

function mapMemberAssignmentPatches(patches: readonly TeamMemberAssignmentPatch[]): readonly {
  readonly userId: string;
  readonly primaryTeamId: string;
  readonly additionalTeamIds: readonly string[];
  readonly approvalExempt: boolean;
  readonly employmentPercentage?: number;
  readonly vacationBalance: number;
  readonly effectiveApproverUserId?: string;
}[] {
  const teamIdByName = new Map(teamRecords.map((team) => [team.teamName, team.teamId]));

  return patches.map((patch) => ({
    userId: patch.userId,
    primaryTeamId: patch.primaryTeamId,
    additionalTeamIds: patch.additionalPositions
      .map((teamName) => teamIdByName.get(teamName))
      .filter((teamId): teamId is string => Boolean(teamId)),
    approvalExempt: patch.approvalExempt,
    employmentPercentage: patch.employmentPercentage,
    vacationBalance: patch.vacationBalance,
    effectiveApproverUserId: patch.effectiveApproverUserId
  }));
}

function mapAbsenceEntryTypePatches(
  patches: readonly TeamAdminAbsenceEntryTypePatch[] | undefined
): readonly TeamAdminAbsenceEntryType[] | undefined {
  if (!patches || patches.length === 0) {
    return undefined;
  }

  return patches.map((patch) => ({
    key: patch.key,
    label: patch.label,
    labelKey: patch.labelKey,
    active: patch.active,
    requiresApproval: patch.requiresApproval,
    consumesVacationBalance: patch.consumesVacationBalance
  }));
}

async function updateTeamRows(update: (record: TeamRecord) => TeamRecord): Promise<void> {
  const rows = sortedTeamRecords().map(update).map((record) => ({
    teamId: record.teamId,
    teamName: record.teamName,
    organization: record.organization,
    sortOrder: record.sortOrder,
    requiredStaffing: record.requiredStaffing,
    color: record.color
  }));

  const response = await teamAdminRequest<{ readonly items: readonly TeamSummaryResponse[] }>("teams", {
    method: "PATCH",
    body: JSON.stringify({ teams: rows })
  });

  applyTeamSummaries(response.items ?? []);
}

function toSummary(team: TeamRecord): TeamAdminSummary {
  return {
    teamId: team.teamId,
    teamName: team.teamName,
    organization: team.organization,
    sortOrder: team.sortOrder,
    requiredStaffing: team.requiredStaffing,
    color: team.color,
    teamLead: getPerson(team.settings.teamLeadUserId),
    memberCount: team.memberCount,
    defaultApprover: getPerson(team.settings.defaultApproverUserId),
    backupApprover: team.settings.backupApproverUserId ? getPerson(team.settings.backupApproverUserId) : undefined,
    approvalPolicy: team.settings.approvalPolicy
  };
}

function findTeamOrThrow(teamId: string): TeamRecord {
  const team = teamRecords.find((record) => record.teamId === teamId);

  if (!team) {
    throw new Error(`Team ${teamId} was not found.`);
  }

  return team;
}

function getPerson(userId: string): TeamAdminPerson {
  const person = knownPeople.get(userId);

  if (person) {
    return person;
  }

  const member = allMemberCache.find((candidate) => candidate.userId === userId);

  if (member) {
    return {
      userId: member.userId,
      displayName: member.displayName,
      email: member.email
    };
  }

  return {
    userId,
    displayName: userId || "—",
    email: ""
  };
}

function sortedTeamRecords(): readonly TeamRecord[] {
  return [...teamRecords].sort(
    (first, second) => first.sortOrder - second.sortOrder || first.teamName.localeCompare(second.teamName)
  );
}

function createDefaultAbsenceEntryTypes(): readonly TeamAdminAbsenceEntryType[] {
  return absenceTypes.map((absenceType) => ({
    key: absenceType.key,
    labelKey: absenceType.labelKey,
    label: undefined,
    active: true,
    requiresApproval: absenceType.key === "vacation" || absenceType.key === "compensation" || absenceType.key === "unpaidLeave",
    consumesVacationBalance: absenceType.consumesVacationBalance
  }));
}

function normalizeOutlookSyncPolicy(value: string): TeamAdminOutlookSyncPolicy {
  return value === "mandatory" || value === "disabled" ? value : "optional";
}

function assertOutlookSyncPolicy(value: TeamAdminOutlookSyncPolicy): void {
  if (value !== "optional" && value !== "mandatory" && value !== "disabled") {
    throw new Error("Invalid Outlook synchronization policy.");
  }
}

// Warm the caches early so synchronous consumers (Timeline sort order,
// approval exemptions) have data without opening the Team Admin Center.
if (typeof window !== "undefined") {
  getManagedTeams()
    .then(() => getAllTeamDetails())
    .catch(() => {
      // API not reachable (e.g. mock-only deployment) - caches stay empty.
    });

  loadDisplayConfig().catch(() => {
    // Display settings unavailable - the visible default applies.
  });
}
