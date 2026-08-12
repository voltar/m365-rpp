import type { TranslationKey } from "../../../localization/translations";
import type { EffectiveUserSettings } from "../types/settingsTypes";
import { SettingsCard } from "./SettingsCard";
import styles from "../MySettingsPage.module.css";

interface ProfileSettingsCardProps {
  readonly settings: EffectiveUserSettings;
  readonly t: (key: TranslationKey) => string;
}

export function ProfileSettingsCard({ settings, t }: ProfileSettingsCardProps) {
  return (
    <SettingsCard title={t("mySettingsProfileTitle")}>
      <dl className={styles.fieldList}>
        <Field label={t("mySettingsName")} value={settings.displayName} />
        <Field label={t("mySettingsEmail")} value={settings.email} />
        <Field label={t("mySettingsTeam")} value={settings.teamName ?? t("mySettingsNotConfigured")} />
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
