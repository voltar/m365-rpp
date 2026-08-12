import { Switch } from "@fluentui/react-components";
import type { TranslationKey } from "../../../localization/translations";
import type { OutlookSyncMode } from "../types/settingsTypes";
import { SettingsCard } from "./SettingsCard";
import styles from "../MySettingsPage.module.css";

interface OutlookSyncSettingsCardProps {
  readonly canChangeOutlookSync: boolean;
  readonly mode: OutlookSyncMode;
  readonly onModeChange: (mode: OutlookSyncMode) => void;
  readonly t: (key: TranslationKey) => string;
}

export function OutlookSyncSettingsCard({ canChangeOutlookSync, mode, onModeChange, t }: OutlookSyncSettingsCardProps) {
  const checked = mode === "enabled" || mode === "managed";

  return (
    <SettingsCard title={t("mySettingsOutlookTitle")} description={t("mySettingsOutlookDescription")}>
      <Switch
        checked={checked}
        disabled={!canChangeOutlookSync}
        label={t("mySettingsOutlookSync")}
        onChange={(_, data) => onModeChange(data.checked ? "enabled" : "disabled")}
      />
      {!canChangeOutlookSync ? <span className={styles.managed}>{t("mySettingsManagedByTeamPolicy")}</span> : null}
      <span className={styles.value}>{t(outlookModeLabelByMode[mode])}</span>
    </SettingsCard>
  );
}

const outlookModeLabelByMode = {
  enabled: "mySettingsOutlookEnabled",
  disabled: "mySettingsOutlookDisabled",
  managed: "mySettingsOutlookManaged"
} as const satisfies Record<OutlookSyncMode, TranslationKey>;
