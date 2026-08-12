import type { TranslationKey } from "../../../localization/translations";

export type TeamAdminOutlookSyncPolicy = "optional" | "mandatory" | "disabled";

export interface TeamAdminPerson {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
}

export interface TeamApprovalPolicy {
  readonly allowUserOverride: boolean;
  readonly outlookSync: TeamAdminOutlookSyncPolicy;
}

export interface TeamSettings {
  readonly teamId: string;
  readonly teamLeadUserId: string;
  readonly defaultApproverUserId: string;
  readonly backupApproverUserId?: string;
  readonly approvalPolicy: TeamApprovalPolicy;
}

export interface TeamAdminSummary {
  readonly teamId: string;
  readonly teamName: string;
  readonly organization: string;
  readonly sortOrder: number;
  readonly requiredStaffing: number;
  // EO-423: assigned palette color key; undefined = automatic
  readonly color?: string;
  readonly teamLead: TeamAdminPerson;
  readonly memberCount: number;
  readonly defaultApprover: TeamAdminPerson;
  readonly backupApprover?: TeamAdminPerson;
  readonly approvalPolicy: TeamApprovalPolicy;
}

export interface TeamAdminMember {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly primaryTeamId: string;
  readonly primaryTeamName: string;
  readonly additionalPositions: readonly string[];
  readonly employmentPercentage?: number;
  readonly vacationBalance: number;
  readonly activeVacationRequests: number;
  readonly approvalExempt: boolean;
  readonly effectiveApproverUserId?: string;
  readonly effectiveApprover: TeamAdminPerson;
}

export interface TeamAdminTeamOption {
  readonly teamId: string;
  readonly teamName: string;
}

export interface TeamAdminDetails {
  readonly team: TeamAdminSummary;
  readonly settings: TeamSettings;
  readonly allowedApprovers: readonly TeamAdminPerson[];
  readonly assignableMembers: readonly TeamAdminMember[];
  readonly absenceEntryTypes: readonly TeamAdminAbsenceEntryType[];
  readonly teamOptions: readonly TeamAdminTeamOption[];
  readonly members: readonly TeamAdminMember[];
  readonly canEdit: boolean;
}

export interface TeamSettingsPatch {
  readonly teamLeadUserId?: string;
  readonly defaultApproverUserId?: string;
  readonly backupApproverUserId?: string;
  readonly approvalPolicy?: Partial<TeamApprovalPolicy>;
  readonly memberAssignments?: readonly TeamMemberAssignmentPatch[];
  readonly absenceEntryTypes?: readonly TeamAdminAbsenceEntryTypePatch[];
}

export interface TeamMemberAssignmentPatch {
  readonly userId: string;
  readonly primaryTeamId: string;
  readonly additionalPositions: readonly string[];
  readonly approvalExempt: boolean;
  readonly employmentPercentage?: number;
  readonly vacationBalance: number;
  readonly effectiveApproverUserId?: string;
}

export interface TeamAdminAbsenceEntryType {
  readonly key: string;
  readonly label?: string;
  readonly labelKey?: TranslationKey;
  readonly active: boolean;
  readonly requiresApproval: boolean;
  readonly consumesVacationBalance: boolean;
}

export interface TeamAdminAbsenceEntryTypePatch {
  readonly key: string;
  readonly label?: string;
  readonly labelKey?: TranslationKey;
  readonly active: boolean;
  readonly requiresApproval: boolean;
  readonly consumesVacationBalance: boolean;
}
