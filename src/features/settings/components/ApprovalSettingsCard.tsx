import type { TranslationKey } from "../../../localization/translations";
import type { EffectiveUserSettings } from "../types/settingsTypes";
import { SettingsCard } from "./SettingsCard";
import styles from "../MySettingsPage.module.css";

interface ApprovalSettingsCardProps {
  readonly settings: EffectiveUserSettings;
  readonly preferredApproverUserId: string;
  readonly onPreferredApproverChange: (userId: string) => void;
  readonly t: (key: TranslationKey) => string;
}

export function ApprovalSettingsCard({
  settings,
  preferredApproverUserId,
  onPreferredApproverChange,
  t
}: ApprovalSettingsCardProps) {
  const isManaged = !settings.permissions.canChangeApprover;

  return (
    <SettingsCard title={t("mySettingsApprovalTitle")} description={t("mySettingsApprovalDescription")}>
      {!settings.defaultApprover ? (
        <div className={styles.warning}>{t("mySettingsNoApproverWarning")}</div>
      ) : null}
      <label className={styles.field}>
        <span>{t("mySettingsDefaultApprover")}</span>
        <select
          disabled={isManaged}
          value={preferredApproverUserId}
          onChange={(event) => onPreferredApproverChange(event.target.value)}
        >
          <option value="">{settings.defaultApprover?.displayName ?? t("mySettingsNotConfigured")}</option>
          {settings.allowedApprovers.map((approver) => (
            <option key={approver.userId} value={approver.userId}>
              {approver.displayName}
            </option>
          ))}
        </select>
        {isManaged ? <span className={styles.managed}>{t("mySettingsManagedByTeamPolicy")}</span> : null}
      </label>
      <dl className={styles.fieldList}>
        <Field label={t("mySettingsFallbackApprover")} value={settings.fallbackApprover?.displayName ?? t("mySettingsNotConfigured")} />
        <Field label={t("mySettingsApproverSource")} value={settings.defaultApprover ? t(sourceLabelByKey[settings.defaultApprover.source]) : t("mySettingsNotConfigured")} />
      </dl>
    </SettingsCard>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className={styles.fieldRow}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{value}</dd>
    </div>
  );
}

const sourceLabelByKey = {
  user: "mySettingsApproverSourceUser",
  teamPolicy: "mySettingsApproverSourceTeamPolicy",
  teamLead: "mySettingsApproverSourceTeamLead",
  fallback: "mySettingsApproverSourceFallback"
} as const satisfies Record<NonNullable<EffectiveUserSettings["defaultApprover"]>["source"], TranslationKey>;
