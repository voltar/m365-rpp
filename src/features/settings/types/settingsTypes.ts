export type ApproverSource = "user" | "teamPolicy" | "teamLead" | "fallback";

export type OutlookSyncMode = "enabled" | "disabled" | "managed";

export interface UserSettings {
  readonly id: string;
  readonly userId: string;
  readonly preferredApproverUserId?: string | null;
  readonly notifications: {
    readonly inApp: boolean;
    readonly email: boolean;
    readonly teams: boolean;
  };
  readonly outlookSync: {
    readonly mode: OutlookSyncMode;
  };
  readonly locale: {
    readonly language: string;
    readonly timeZone: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SettingsPerson {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
}

export interface SettingsApprover extends SettingsPerson {
  readonly source: ApproverSource;
}

export interface EffectiveUserSettings {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly teamId?: string;
  readonly teamName?: string;
  readonly defaultApprover?: SettingsApprover;
  readonly fallbackApprover?: SettingsPerson;
  readonly allowedApprovers: readonly SettingsPerson[];
  readonly permissions: {
    readonly canChangeApprover: boolean;
    readonly canChangeNotifications: boolean;
    readonly canChangeOutlookSync: boolean;
  };
  readonly userSettings: UserSettings;
}

export interface UserSettingsPatch {
  readonly preferredApproverUserId?: string | null;
  readonly notifications?: {
    readonly inApp?: boolean;
    readonly email?: boolean;
  };
  readonly outlookSync?: {
    readonly mode?: Exclude<OutlookSyncMode, "managed">;
  };
}
