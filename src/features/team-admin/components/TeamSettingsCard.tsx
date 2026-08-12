import type { TranslationKey } from "../../../localization/translations";
import type { TeamAdminDetails, TeamAdminPerson } from "../types/teamSettings";
import styles from "../TeamAdminPage.module.css";

interface TeamSettingsCardProps {
  readonly details: TeamAdminDetails;
  readonly backupApproverOptions: readonly TeamAdminPerson[];
  readonly defaultApproverOptions: readonly TeamAdminPerson[];
  readonly teamLeadUserId: string;
  readonly defaultApproverUserId: string;
  readonly backupApproverUserId: string;
  readonly onTeamLeadChange: (userId: string) => void;
  readonly onDefaultApproverChange: (userId: string) => void;
  readonly onBackupApproverChange: (userId: string) => void;
  readonly t: (key: TranslationKey) => string;
}

export function TeamSettingsCard({
  details,
  backupApproverOptions,
  defaultApproverOptions,
  teamLeadUserId,
  defaultApproverUserId,
  backupApproverUserId,
  onTeamLeadChange,
  onDefaultApproverChange,
  onBackupApproverChange,
  t
}: TeamSettingsCardProps) {
  return (
    <section className={styles.card} aria-label={t("teamAdminTeamInformation")}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{t("teamAdminTeamInformation")}</h3>
        <p className={styles.cardDescription}>{details.team.organization}</p>
      </div>
      <div className={styles.fieldList}>
        <div className={styles.fieldRow}>
          <span className={styles.label}>{t("teamAdminMemberCount")}</span>
          <span className={styles.value}>{details.team.memberCount}</span>
        </div>
      </div>
      <label className={styles.field}>
        <span>{t("teamAdminTeamLead")}</span>
        <select value={teamLeadUserId} onChange={(event) => onTeamLeadChange(event.target.value)}>
          {backupApproverOptions.map((approver) => (
            <option key={approver.userId} value={approver.userId}>
              {approver.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>{t("teamAdminDefaultApprover")}</span>
        <select value={defaultApproverUserId} onChange={(event) => onDefaultApproverChange(event.target.value)}>
          {defaultApproverOptions.map((approver) => (
            <option key={approver.userId} value={approver.userId}>
              {approver.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>{t("teamAdminBackupApprover")}</span>
        <select value={backupApproverUserId} onChange={(event) => onBackupApproverChange(event.target.value)}>
          <option value="">{t("teamAdminNoBackupApprover")}</option>
          {backupApproverOptions.map((approver) => (
            <option key={approver.userId} value={approver.userId}>
              {approver.displayName}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
