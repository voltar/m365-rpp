import type { TranslationKey } from "../../../localization/translations";
import type { TeamAdminOutlookSyncPolicy } from "../types/teamSettings";
import styles from "../TeamAdminPage.module.css";

interface ApprovalPolicyCardProps {
  readonly allowUserOverride: boolean;
  readonly outlookSync: TeamAdminOutlookSyncPolicy;
  readonly onAllowUserOverrideChange: (allowUserOverride: boolean) => void;
  readonly onOutlookSyncChange: (outlookSync: TeamAdminOutlookSyncPolicy) => void;
  readonly t: (key: TranslationKey) => string;
}

export function ApprovalPolicyCard({
  allowUserOverride,
  outlookSync,
  onAllowUserOverrideChange,
  onOutlookSyncChange,
  t
}: ApprovalPolicyCardProps) {
  return (
    <section className={styles.card} aria-label={t("teamAdminApprovalPolicy")}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{t("teamAdminApprovalPolicy")}</h3>
        <p className={styles.cardDescription}>{t("teamAdminApprovalPolicyDescription")}</p>
      </div>
      <label className={styles.checkboxRow}>
        <input
          checked={allowUserOverride}
          onChange={(event) => onAllowUserOverrideChange(event.target.checked)}
          type="checkbox"
        />
        <span>{t("teamAdminAllowUserOverride")}</span>
      </label>
      <label className={styles.field}>
        <span>{t("teamAdminOutlookSyncPolicy")}</span>
        <select
          value={outlookSync}
          onChange={(event) => onOutlookSyncChange(event.target.value as TeamAdminOutlookSyncPolicy)}
        >
          <option value="optional">{t("teamAdminOutlookSyncOptional")}</option>
          <option value="mandatory">{t("teamAdminOutlookSyncMandatory")}</option>
          <option value="disabled">{t("teamAdminOutlookSyncDisabled")}</option>
        </select>
      </label>
    </section>
  );
}
