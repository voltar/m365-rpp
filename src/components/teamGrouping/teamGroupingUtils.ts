import type { ResourceSummary } from "../../models/resource";
import type { TeamResourceGroup } from "../../models/teamGrouping";

export function groupResourcesByPrimaryTeam(
  resources: readonly ResourceSummary[],
  teamSortOrder: ReadonlyMap<string, number> = new Map()
): readonly TeamResourceGroup[] {
  const groups = new Map<string, ResourceSummary[]>();

  resources.forEach((resource) => {
    getResourceTeamNames(resource).forEach((teamName) => {
      const groupResources = groups.get(teamName) ?? [];
      groupResources.push(resource);
      groups.set(teamName, groupResources);
    });
  });

  return Array.from(groups.entries())
    .map(([teamName, groupResources]) => ({
      id: normalizeGroupId(teamName),
      teamName,
      resources: [...groupResources].sort((first, second) => first.displayName.localeCompare(second.displayName))
    }))
    .sort((first, second) => compareTeamGroups(first, second, teamSortOrder));
}

function getResourceTeamNames(resource: ResourceSummary): readonly string[] {
  return Array.from(new Set([resource.primaryTeam, ...resource.additionalTeams]));
}

export function groupResourcesByPerson(resources: readonly ResourceSummary[], groupName: string): readonly TeamResourceGroup[] {
  const sortedResources = [...resources].sort((first, second) => first.displayName.localeCompare(second.displayName));

  return [
    {
      id: "people",
      teamName: groupName,
      resources: sortedResources
    }
  ];
}

function normalizeGroupId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function compareTeamGroups(
  first: TeamResourceGroup,
  second: TeamResourceGroup,
  teamSortOrder: ReadonlyMap<string, number>
): number {
  const firstOrder = teamSortOrder.get(first.teamName);
  const secondOrder = teamSortOrder.get(second.teamName);

  if (firstOrder !== undefined && secondOrder !== undefined) {
    return firstOrder - secondOrder || first.teamName.localeCompare(second.teamName);
  }

  if (firstOrder !== undefined) {
    return -1;
  }

  if (secondOrder !== undefined) {
    return 1;
  }

  return first.teamName.localeCompare(second.teamName);
}
