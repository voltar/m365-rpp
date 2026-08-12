import type { ResourceSummary } from "../../models/resource";
import { getMemberEmailForResource } from "../team-admin/services/teamAdminApi";

// EO-415: locations are configured values (Team Admin Center), not a fixed union.
export type ReportLocation = string;

/**
 * FR-413.5: the person profile carries only real data (Graph membership, Team Admin,
 * resource fields). Fabricated mock values (phone numbers, extensions, assistants,
 * hash-based locations) were removed — absent fields simply stay undefined and the
 * card hides them. Organisation/location become configurable with EO-415.
 */
export interface PersonProfile {
  readonly resource: ResourceSummary;
  readonly formalName: string;
  readonly email?: string;
  readonly chatAddress?: string;
  readonly location?: ReportLocation;
  readonly company: string;
}

export function getResourceLocation(resource: ResourceSummary): ReportLocation | undefined {
  // EO-415: the mapped location from the Graph profile takes precedence; the
  // address heuristic remains only for mock data without profile locations.
  if (resource.location) {
    return resource.location;
  }

  const address = resource.businessAddress?.toLocaleLowerCase();

  if (address?.includes("st. gallen") || address?.includes("st gallen") || address?.includes("9014")) {
    return "St. Gallen";
  }

  if (address?.includes("dübendorf") || address?.includes("dubendorf") || address?.includes("8600")) {
    return "Dübendorf";
  }

  return undefined;
}

export function createPersonProfile(resource: ResourceSummary): PersonProfile {
  const email = getMemberEmailForResource(resource.id);

  return {
    resource,
    formalName: toFormalName(resource.displayName),
    email,
    chatAddress: email?.toLowerCase(),
    // EO-415: Standort from Graph officeLocation (via membership → resource.location).
    location: getResourceLocation(resource),
    // EO-415: Firma from Graph companyName (via membership → resource.organization).
    company: resource.organization
  };
}

function toFormalName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);

  if (parts.length < 2) {
    return displayName;
  }

  const lastName = parts[parts.length - 1];
  const firstNames = parts.slice(0, -1).join(" ");

  return `${lastName}, ${firstNames}`;
}
