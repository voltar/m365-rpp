import type { RepositoryError } from "../../repositories/planningRepositories";

export type Microsoft365PermissionScope =
  | "User.Read"
  | "GroupMember.Read.All"
  | "Team.ReadBasic.All"
  | "Sites.Read.All"
  | "Sites.ReadWrite.All"
  | "Calendars.ReadWrite";

export type AccessTokenScope = string;

export interface AccessTokenRequest {
  readonly scopes: readonly AccessTokenScope[];
}

export interface AccessToken {
  readonly token: string;
  readonly expiresOn?: Date;
}

export type AccessTokenResult =
  | { readonly ok: true; readonly value: AccessToken }
  | { readonly ok: false; readonly error: RepositoryError };

export interface Microsoft365AuthProvider {
  getAccessToken(request: AccessTokenRequest): Promise<AccessTokenResult>;
}

export interface TeamsContext {
  readonly teamId?: string;
  readonly teamName?: string;
  readonly groupId?: string;
  readonly userId?: string;
  readonly locale?: string;
}

export type TeamsContextResult =
  | { readonly ok: true; readonly value: TeamsContext }
  | { readonly ok: false; readonly error: RepositoryError };

export interface TeamsContextProvider {
  getContext(): Promise<TeamsContextResult>;
}

export const graphPermissionScopes = {
  userRead: "User.Read",
  groupMemberReadAll: "GroupMember.Read.All",
  teamReadBasicAll: "Team.ReadBasic.All",
  calendarsReadWrite: "Calendars.ReadWrite"
} as const satisfies Record<string, Microsoft365PermissionScope>;

export const sharePointPermissionScopes = {
  sitesReadAll: "Sites.Read.All",
  sitesReadWriteAll: "Sites.ReadWrite.All"
} as const satisfies Record<string, Microsoft365PermissionScope>;
