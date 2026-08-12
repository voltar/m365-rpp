import { Checkbox } from "@fluentui/react-components";
import type { TranslationKey } from "../../../localization/translations";
import { SettingsCard } from "./SettingsCard";
import styles from "../MySettingsPage.module.css";

interface NotificationSettingsCardProps {
  readonly canChangeNotifications: boolean;
  readonly email: boolean;
  readonly inApp: boolean;
  readonly teams: boolean;
  readonly onEmailChange: (value: boolean) => void;
  readonly onInAppChange: (value: boolean) => void;
  readonly t: (key: TranslationKey) => string;
}

export function NotificationSettingsCard({
  canChangeNotifications,
  email,
  inApp,
  teams,
  onEmailChange,
  onInAppChange,
  t
}: NotificationSettingsCardProps) {
  return (
    <SettingsCard title={t("mySettingsNotificationsTitle")} description={t("mySettingsNotificationsDescription")}>
      <div className={styles.fieldList}>
        <Checkbox
          checked={inApp}
          disabled={!canChangeNotifications}
          label={t("mySettingsNotificationInApp")}
          onChange={(_, data) => onInAppChange(Boolean(data.checked))}
        />
        <Checkbox
          checked={email}
          disabled={!canChangeNotifications}
          label={t("mySettingsNotificationEmail")}
          onChange={(_, data) => onEmailChange(Boolean(data.checked))}
        />
        <Checkbox checked={teams} disabled label={t("mySettingsNotificationTeams")} />
      </div>
    </SettingsCard>
  );
}
