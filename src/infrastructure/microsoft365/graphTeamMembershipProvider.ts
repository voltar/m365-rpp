import type { Logger } from "../../core/logging";
import type { GraphUserIdentity, TeamMembership } from "../../models/identity";
import type { Organization } from "../../models/resource";
import type {
  ITeamMembershipProvider,
  RepositoryPage,
  RepositoryResult,
  TeamMembershipQuery
} from "../../repositories/planningRepositories";
import { graphPermissionScopes, type TeamsContextProvider } from "./authContracts";
import type { MicrosoftGraphClient } from "./graphClient";

interface GraphUserResponse {
  readonly id: string;
  readonly "@odata.type"?: string;
  readonly displayName?: string;
  readonly mail?: string;
  readonly userPrincipalName?: string;
  readonly userType?: string;
  readonly companyName?: string;
  readonly officeLocation?: string;
  readonly streetAddress?: string;
  readonly postalCode?: string;
  readonly city?: string;
  readonly country?: string;
}

interface GraphCollectionResponse<T> {
  readonly value: readonly T[];
  readonly "@odata.nextLink"?: string;
}

export class GraphTeamMembershipProvider implements ITeamMembershipProvider {
  constructor(
    private readonly graphClient: MicrosoftGraphClient,
    private readonly teamsContextProvider: TeamsContextProvider,
    private readonly logger?: Logger
  ) {}

  async listMemberships(query?: TeamMembershipQuery): Promise<RepositoryResult<RepositoryPage<TeamMembership>>> {
    const contextResult = await this.teamsContextProvider.getContext();

    if (!contextResult.ok) {
      this.logger?.warn("Teams context failed, cannot load Graph membership", {
        source: "infrastructure",
        component: "GraphTeamMembershipProvider",
        operation: "listMemberships"
      });
      return contextResult;
    }

    const teamId = query?.teamId ?? contextResult.value.groupId ?? contextResult.value.teamId;
    const teamName = contextResult.value.teamName ?? teamId ?? "Unknown Team";

    if (!teamId && !query?.pageToken) {
      // EO-428: no team, no guess. Loading a hardcoded team here returned another tenant's data
      // shape to anyone without host context and hid the missing selection behind a warning.
      this.logger?.warn("No team context available for the Graph membership query.", {
        source: "infrastructure",
        component: "GraphTeamMembershipProvider",
        operation: "listMemberships"
      });

      return {
        ok: false,
        error: {
          code: "noTeamContext",
          message: "No team context is available for this request.",
          recoverable: true
        }
      };
    }

    const graphResult = await this.graphClient.get<GraphCollectionResponse<GraphUserResponse>>(
      query?.pageToken ?? createMembersPath(teamId, query?.pageSize),
      { scopes: [graphPermissionScopes.userRead, graphPermissionScopes.groupMemberReadAll, graphPermissionScopes.teamReadBasicAll] }
    );

    if (!graphResult.ok) {
      this.logger?.warn("Microsoft Graph team membership request failed.", {
        source: "infrastructure",
        component: "GraphTeamMembershipProvider",
        operation: "listMemberships",
        details: { teamId, errorCode: graphResult.error.code }
      });

      return graphResult;
    }

    const memberships = graphResult.value.value
      .filter(isGraphUser)
      .filter((user) => !query?.userId || user.id === query.userId)
      .map((user) => mapUserToMembership(user, teamId, teamName));

    return {
      ok: true,
      value: {
        items: memberships,
        nextPageToken: graphResult.value["@odata.nextLink"]
      }
    };
  }

  private async loadMembersForTeam(teamId: string, teamName: string): Promise<RepositoryResult<RepositoryPage<TeamMembership>>> {
    const graphResult = await this.graphClient.get<GraphCollectionResponse<GraphUserResponse>>(
      createMembersPath(teamId, undefined),
      { scopes: [graphPermissionScopes.userRead, graphPermissionScopes.groupMemberReadAll, graphPermissionScopes.teamReadBasicAll] }
    );

    if (!graphResult.ok) {
      this.logger?.warn("Microsoft Graph team membership request with fallback team failed.", {
        source: "infrastructure",
        component: "GraphTeamMembershipProvider",
        operation: "loadMembersForTeam",
        details: { teamId, errorCode: graphResult.error.code }
      });
      return graphResult;
    }

    const memberships = graphResult.value.value
      .filter(isGraphUser)
      .map((user) => mapUserToMembership(user, teamId, teamName));

    return {
      ok: true,
      value: {
        items: memberships,
        nextPageToken: graphResult.value["@odata.nextLink"]
      }
    };
  }
}

function createMembersPath(teamId: string | undefined, pageSize: number | undefined): string {
  const query = new URLSearchParams({
    "$select": "id,displayName,mail,userPrincipalName,userType,companyName,officeLocation,streetAddress,postalCode,city,country"
  });

  if (pageSize && pageSize > 0) {
    query.set("$top", `${pageSize}`);
  }

  return `/groups/${encodeURIComponent(teamId ?? "")}/members?${query.toString()}`;
}

function isGraphUser(user: GraphUserResponse): boolean {
  return !user["@odata.type"] || user["@odata.type"] === "#microsoft.graph.user";
}

function mapUserToMembership(user: GraphUserResponse, teamId: string | undefined, teamName: string | undefined): TeamMembership {
  const displayName = user.displayName ?? user.mail ?? user.userPrincipalName ?? user.id;
  const organization = resolveProfileValue(user.companyName);
  const location = resolveProfileValue(user.officeLocation);
  const member: GraphUserIdentity = {
    id: user.id,
    displayName,
    email: user.mail ?? user.userPrincipalName,
    avatarUrl: `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user.id)}/photo/$value`,
    initials: createInitials(displayName),
    // EO-415: Firma (companyName) and Standort (officeLocation) from the Graph profile.
    organization,
    ...(location ? { location } : {}),
    businessAddress: formatBusinessAddress(user),
    userType: user.userType?.toLowerCase() === "guest" ? "guest" : "member"
  };

  return {
    member,
    isPrimary: true,
    teamId: teamId ?? "",
    teamName: teamName ?? teamId ?? ""
  };
}

function formatBusinessAddress(user: GraphUserResponse): string | undefined {
  // Prefer street/city for the free-text address; officeLocation is the structured
  // Standort field and is carried separately on GraphUserIdentity.location.
  const parts = [user.streetAddress, user.postalCode, user.city, user.country]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : undefined;
}

function resolveProfileValue(value: string | undefined): Organization {
  // EO-415: browser-side Graph provider (non-api data sources only) passes the
  // raw profile company / office value through; the API path applies configured mappings.
  return value?.trim() ?? "";
}

function createInitials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
