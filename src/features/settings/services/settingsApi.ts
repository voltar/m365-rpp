import type { EffectiveUserSettings, SettingsPerson, UserSettings, UserSettingsPatch } from "../types/settingsTypes";
import { loadPersistedMockState, savePersistedMockState } from "../../../data/mockStatePersistence";
import { getTeamPolicyForUserSettings } from "../../team-admin/services/teamAdminApi";

const userSettingsPersistenceKey = "userSettings";
const now = new Date().toISOString();

const approvers: readonly SettingsPerson[] = [
  {
    userId: "department-head-platform",
    displayName: "Abteilungsleitung Platform Services",
    email: "platform.head@example.invalid"
  }
];

const fallbackApprover: SettingsPerson = {
  userId: "department-head-platform",
  displayName: "Abteilungsleitung Platform Services",
  email: "platform.head@example.invalid"
};

let userSettings: UserSettings = loadPersistedMockState<UserSettings>(userSettingsPersistenceKey, {
  id: "settings-gianni-zanetti",
  userId: "gianni-zanetti",
  preferredApproverUserId: null,
  notifications: {
    inApp: true,
    email: true,
    teams: false
  },
  outlookSync: {
    mode: "managed"
  },
  locale: {
    language: "de-CH",
    timeZone: "Europe/Zurich"
  },
  createdAt: now,
  updatedAt: now
});

export async function getMySettings(): Promise<EffectiveUserSettings> {
  return resolveEffectiveSettings();
}

export async function patchMySettings(patch: UserSettingsPatch): Promise<EffectiveUserSettings> {
  const teamPolicy = getTeamPolicyForUserSettings("platform-services");

  if (patch.preferredApproverUserId !== undefined && !teamPolicy.allowApproverOverride) {
    throw new Error("Approver override is managed by team policy.");
  }

  if (patch.outlookSync?.mode !== undefined && teamPolicy.manageOutlookSync) {
    throw new Error("Outlook sync is managed by team policy.");
  }

  userSettings = {
    ...userSettings,
    preferredApproverUserId: patch.preferredApproverUserId !== undefined
      ? patch.preferredApproverUserId
      : userSettings.preferredApproverUserId,
    notifications: {
      ...userSettings.notifications,
      inApp: patch.notifications?.inApp ?? userSettings.notifications.inApp,
      email: patch.notifications?.email ?? userSettings.notifications.email
    },
    outlookSync: {
      mode: patch.outlookSync?.mode ?? userSettings.outlookSync.mode
    },
    updatedAt: new Date().toISOString()
  };
  savePersistedMockState(userSettingsPersistenceKey, userSettings);

  return resolveEffectiveSettings();
}

export async function resetMySettings(): Promise<EffectiveUserSettings> {
  const teamPolicy = getTeamPolicyForUserSettings("platform-services");

  userSettings = {
    ...userSettings,
    preferredApproverUserId: null,
    notifications: {
      inApp: true,
      email: true,
      teams: false
    },
    outlookSync: {
      mode: teamPolicy.manageOutlookSync ? "managed" : "disabled"
    },
    updatedAt: new Date().toISOString()
  };
  savePersistedMockState(userSettingsPersistenceKey, userSettings);

  return resolveEffectiveSettings();
}

function resolveEffectiveSettings(): EffectiveUserSettings {
  const teamPolicy = getTeamPolicyForUserSettings("platform-services");
  const preferredApprover = teamPolicy.allowApproverOverride && userSettings.preferredApproverUserId
    ? approvers.find((approver) => approver.userId === userSettings.preferredApproverUserId)
    : undefined;
  const teamPolicyApprover = approvers.find((approver) => approver.userId === teamPolicy.defaultApproverUserId);
  const effectiveApprover = preferredApprover ?? teamPolicyApprover ?? fallbackApprover;
  const source = preferredApprover ? "user" : teamPolicyApprover ? "teamPolicy" : "fallback";

  return {
    userId: "gianni-zanetti",
    displayName: "Alex Mueller",
    email: "alex.mueller@example.invalid",
    teamId: "platform-services",
    teamName: "M365 Platform",
    defaultApprover: effectiveApprover
      ? {
          ...effectiveApprover,
          source
        }
      : undefined,
    fallbackApprover,
    allowedApprovers: approvers,
    permissions: {
      canChangeApprover: teamPolicy.allowApproverOverride,
      canChangeNotifications: true,
      canChangeOutlookSync: !teamPolicy.manageOutlookSync
    },
    userSettings
  };
}
