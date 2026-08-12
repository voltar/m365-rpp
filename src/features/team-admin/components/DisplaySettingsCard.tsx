import { useEffect, useState } from "react";
import type { TranslationKey } from "../../../localization/translations";
import {
  loadDisplayConfig,
  saveDisplayConfig,
  getDisplayConfigSnapshot,
  type DisplayConfig,
  type EventColorMode
} from "../services/teamAdminApi";
import styles from "../TeamAdminPage.module.css";

interface DisplaySettingsCardProps {
  readonly canEdit: boolean;
  readonly t: (key: TranslationKey) => string;
  readonly onError: (message: string) => void;
}

/**
 * EO-421/EO-423: tenant-wide display settings. Self-contained card — the
 * settings are global (like the holiday calendar), not part of the per-team
 * settings patch.
 */
export function DisplaySettingsCard({ canEdit, t, onError }: DisplaySettingsCardProps) {
  const [config, setConfig] = useState<DisplayConfig>(getDisplayConfigSnapshot());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isActive = true;

    loadDisplayConfig()
      .then((loadedConfig) => {
        if (isActive) {
          setConfig(loadedConfig);
        }
      })
      .catch(() => {
        // Display settings unavailable - the defaults apply.
      });

    return () => {
      isActive = false;
    };
  }, []);

  const applyChange = async (nextConfig: DisplayConfig) => {
    const previousConfig = config;

    setConfig(nextConfig);
    setIsSaving(true);

    try {
      setConfig(await saveDisplayConfig(nextConfig));
    } catch {
      setConfig(previousConfig);
      onError(t("teamAdminSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className={styles.card} aria-label={t("teamAdminDisplaySettings")}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{t("teamAdminDisplaySettings")}</h3>
        <p className={styles.cardDescription}>{t("teamAdminDisplaySettingsDescription")}</p>
      </div>
      <label className={styles.checkboxRow}>
        <input
          checked={config.showVacationSummary}
          disabled={!canEdit || isSaving}
          onChange={(event) => void applyChange({ ...config, showVacationSummary: event.target.checked })}
          type="checkbox"
        />
        <span>{t("teamAdminShowVacationSummary")}</span>
      </label>
      <label className={styles.field}>
        <span>{t("teamAdminEventColorMode")}</span>
        <select
          disabled={!canEdit || isSaving}
          onChange={(event) => void applyChange({ ...config, eventColorMode: event.target.value as EventColorMode })}
          value={config.eventColorMode}
        >
          <option value="byType">{t("teamAdminEventColorByType")}</option>
          <option value="byTeam">{t("teamAdminEventColorByTeam")}</option>
        </select>
      </label>
    </section>
  );
}
