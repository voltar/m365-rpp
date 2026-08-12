import { loadPersistedMockState, savePersistedMockState } from "./mockStatePersistence";

const persistenceKey = "requiredStaffing";

const defaultRequiredStaffing: readonly (readonly [string, number])[] = [
  ["M365 Platform", 3],
  ["SQL", 2],
  ["PKI", 2],
  ["Lehrlingsbetreuung", 1],
  ["Security", 2],
  ["Operations", 3],
  ["Service Desk", 2],
  ["Storage", 2],
  ["Network", 2],
  ["Workplace", 2],
  ["Virtualization", 2],
  ["Cloud", 2],
  ["Teams", 2]
];

const requiredStaffingByTeamName = new Map<string, number>(
  loadPersistedMockState<readonly (readonly [string, number])[]>(persistenceKey, defaultRequiredStaffing)
);

export function getRequiredStaffingByTeamName(): ReadonlyMap<string, number> {
  return requiredStaffingByTeamName;
}

export function getRequiredStaffing(teamName: string): number | undefined {
  return requiredStaffingByTeamName.get(teamName);
}

export function setRequiredStaffing(teamName: string, requiredStaffing: number | undefined): void {
  if (requiredStaffing === undefined || requiredStaffing <= 0) {
    requiredStaffingByTeamName.delete(teamName);
  } else {
    requiredStaffingByTeamName.set(teamName, requiredStaffing);
  }

  persist();
}

export function renameRequiredStaffingTeam(previousTeamName: string, nextTeamName: string): void {
  const requiredStaffing = requiredStaffingByTeamName.get(previousTeamName);
  requiredStaffingByTeamName.delete(previousTeamName);

  if (requiredStaffing !== undefined) {
    requiredStaffingByTeamName.set(nextTeamName, requiredStaffing);
  }

  persist();
}

function persist(): void {
  savePersistedMockState(persistenceKey, Array.from(requiredStaffingByTeamName.entries()));
}
