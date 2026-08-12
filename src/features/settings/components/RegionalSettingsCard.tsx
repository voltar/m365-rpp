import type { TranslationKey } from "../../../localization/translations";
import type { UserSettings } from "../types/settingsTypes";
import { SettingsCard } from "./SettingsCard";
import styles from "../MySettingsPage.module.css";

interface RegionalSettingsCardProps {
  readonly locale: UserSettings["locale"];
  readonly t: (key: TranslationKey) => string;
}

export function RegionalSettingsCard({ locale, t }: RegionalSettingsCardProps) {
  return (
    <SettingsCard title={t("mySettingsRegionalTitle")} description={t("mySettingsRegionalDescription")}>
      <dl className={styles.fieldList}>
        <Field label={t("mySettingsLanguage")} value={locale.language} />
        <Field label={t("mySettingsTimeZone")} value={locale.timeZone} />
      </dl>
    </SettingsCard>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className={styles.fieldRow}>
      <dt className={styles.label}>{label}</dt>
      <dd className={`${styles.value} ${styles.muted}`}>{value}</dd>
    </div>
  );
}
