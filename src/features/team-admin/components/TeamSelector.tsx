import type { TranslationKey } from "../../../localization/translations";
import { allTeamsId } from "../services/teamAdminApi";
import type { TeamAdminSummary } from "../types/teamSettings";
import styles from "../TeamAdminPage.module.css";

interface TeamSelectorProps {
  readonly teams: readonly TeamAdminSummary[];
  readonly selectedTeamId: string;
  readonly onSelectedTeamChange: (teamId: string) => void;
  readonly t: (key: TranslationKey) => string;
}

export function TeamSelector({ teams, selectedTeamId, onSelectedTeamChange, t }: TeamSelectorProps) {
  const selectedTeam = teams.find((team) => team.teamId === selectedTeamId);
  const isAllTeamsSelected = selectedTeamId === allTeamsId;

  return (
    <section className={`${styles.card} ${styles.teamSelectionCard}`} aria-label={t("teamAdminTeamSelection")}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{t("teamAdminTeamSelection")}</h3>
        <p className={styles.cardDescription}>{t("teamAdminTeamSelectionDescription")}</p>
      </div>
      {isAllTeamsSelected ? (
        <div className={styles.activeTeamSummary} aria-live="polite">
          <span>{t("teamAdminActiveTeam")}</span>
          <strong>{t("teamAdminAllTeams")}</strong>
          <small>{teams.length} {t("teamAdminManagedTeam")}</small>
        </div>
      ) : selectedTeam ? (
        <div className={styles.activeTeamSummary} aria-live="polite">
          <span>{t("teamAdminActiveTeam")}</span>
          <strong>{selectedTeam.teamName}</strong>
          <small>{selectedTeam.organization} · {selectedTeam.memberCount} {t("teamAdminMemberCount")}</small>
        </div>
      ) : null}
      <label className={styles.field}>
        <span>{t("teamAdminManagedTeam")}</span>
        <select value={selectedTeamId} onChange={(event) => onSelectedTeamChange(event.target.value)}>
          <option value={allTeamsId}>{t("teamAdminAllTeams")}</option>
          {teams.map((team) => (
            <option key={team.teamId} value={team.teamId}>
              {team.teamName}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
