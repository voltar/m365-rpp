import type { Organization } from "./resource";

export type UserType = "member" | "guest";

export interface GraphUserIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly email?: string;
  readonly avatarUrl?: string;
  readonly initials: string;
  /** EO-415: mapped Graph companyName (Firma). */
  readonly organization: Organization;
  /** EO-415: mapped Graph officeLocation (Standort). */
  readonly location?: string;
  readonly businessAddress?: string;
  readonly userType: UserType;
}

export interface TeamMembership {
  readonly teamId: string;
  readonly teamName: string;
  readonly member: GraphUserIdentity;
  readonly isPrimary: boolean;
}
