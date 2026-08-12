import { useEffect, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { useLogger } from "../../core/logging";
import type { TranslationKey } from "../../localization/translations";
import { ApprovalSettingsCard } from "./components/ApprovalSettingsCard";
import { NotificationSettingsCard } from "./components/NotificationSettingsCard";
import { OutlookSyncSettingsCard } from "./components/OutlookSyncSettingsCard";
import { ProfileSettingsCard } from "./components/ProfileSettingsCard";
import { RegionalSettingsCard } from "./components/RegionalSettingsCard";
import { getMySettings, patchMySettings, resetMySettings } from "./services/settingsApi";
import type { EffectiveUserSettings, OutlookSyncMode } from "./types/settingsTypes";
import styles from "./MySettingsPage.module.css";

interface MySettingsPageProps {
  readonly t: (key: TranslationKey) => string;
}

export function MySettingsPage({ t }: MySettingsPageProps) {
  const logger = useLogger();
  const [settings, setSettings] = useState<EffectiveUserSettings>();
  const [preferredApproverUserId, setPreferredApproverUserId] = useState("");
  const [notificationInApp, setNotificationInApp] = useState(true);
  const [notificationEmail, setNotificationEmail] = useState(true);
  const [outlookSyncMode, setOutlookSyncMode] = useState<OutlookSyncMode>("managed");
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<string>();

  useEffect(() => {
    let isCancelled = false;

    getMySettings()
      .then((loadedSettings) => {
        if (!isCancelled) {
          applySettings(loadedSettings);
        }
      })
      .catch((error: unknown) => {
        logger.error("My Settings could not be loaded.", {
          source: "settings",
          component: "MySettingsPage",
          operation: "load"
        }, error);
        setToast(t("mySettingsSaveError"));
      });

    return () => {
      isCancelled = true;
    };
  }, [logger, t]);

  const applySettings = (nextSettings: EffectiveUserSettings) => {
    setSettings(nextSettings);
    setPreferredApproverUserId(nextSettings.userSettings.preferredApproverUserId ?? "");
    setNotificationInApp(nextSettings.userSettings.notifications.inApp);
    setNotificationEmail(nextSettings.userSettings.notifications.email);
    setOutlookSyncMode(nextSettings.userSettings.outlookSync.mode);
  };

  const save = async () => {
    if (!settings) {
      return;
    }

    setIsSaving(true);
    setToast(undefined);

    try {
      const updatedSettings = await patchMySettings({
        preferredApproverUserId: settings.permissions.canChangeApprover ? preferredApproverUserId || null : undefined,
        notifications: settings.permissions.canChangeNotifications
          ? { inApp: notificationInApp, email: notificationEmail }
          : undefined,
        outlookSync: settings.permissions.canChangeOutlookSync && outlookSyncMode !== "managed"
          ? { mode: outlookSyncMode }
          : undefined
      });
      applySettings(updatedSettings);
      setToast(t("mySettingsSavedToast"));
    } catch (error: unknown) {
      logger.error("My Settings could not be saved.", {
        source: "settings",
        component: "MySettingsPage",
        operation: "save"
      }, error);
      setToast(t("mySettingsSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  const reset = async () => {
    setIsSaving(true);
    setToast(undefined);

    try {
      const resetSettings = await resetMySettings();
      applySettings(resetSettings);
      setToast(t("mySettingsResetToast"));
    } catch (error: unknown) {
      logger.error("My Settings could not be reset.", {
        source: "settings",
        component: "MySettingsPage",
        operation: "reset"
      }, error);
      setToast(t("mySettingsSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  if (!settings) {
    return <Spinner label={t("mySettingsLoading")} />;
  }

  return (
    <section className={styles.page} aria-label={t("mySettingsTitle")}>
      {toast ? (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}

      <div className={styles.grid}>
        <ProfileSettingsCard settings={settings} t={t} />
        <ApprovalSettingsCard
          settings={settings}
          preferredApproverUserId={preferredApproverUserId}
          onPreferredApproverChange={setPreferredApproverUserId}
          t={t}
        />
        <NotificationSettingsCard
          canChangeNotifications={settings.permissions.canChangeNotifications}
          email={notificationEmail}
          inApp={notificationInApp}
          teams={settings.userSettings.notifications.teams}
          onEmailChange={setNotificationEmail}
          onInAppChange={setNotificationInApp}
          t={t}
        />
        <OutlookSyncSettingsCard
          canChangeOutlookSync={settings.permissions.canChangeOutlookSync}
          mode={outlookSyncMode}
          onModeChange={setOutlookSyncMode}
          t={t}
        />
        <RegionalSettingsCard locale={settings.userSettings.locale} t={t} />
      </div>

      <div className={styles.actions}>
        <Button appearance="secondary" disabled={isSaving} onClick={reset}>
          {t("mySettingsResetToDefaults")}
        </Button>
        <Button appearance="primary" disabled={isSaving} onClick={save}>
          {t("mySettingsSaveChanges")}
        </Button>
      </div>
    </section>
  );
}
