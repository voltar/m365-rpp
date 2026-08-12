import { useEffect, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { useLogger } from "../core/logging";
import { getMyTeams, type UserTeam } from "../features/team-admin/services/myTeamsApi";
import { resolveCurrentUserId } from "../infrastructure/microsoft365/currentUser";
import { writeActiveTeamSelection } from "../infrastructure/microsoft365/activeTeamSelection";
import type { TranslationKey } from "../localization/translations";
import styles from "./TeamContextPicker.module.css";

interface TeamContextPickerProps {
  /** Called once a team is stored, so the caller can reload with the new context. */
  readonly onSelected: () => void;
  readonly t: (key: TranslationKey) => string;
}

type PickerState =
  | { readonly status: "loading" }
  | { readonly status: "choose"; readonly teams: readonly UserTeam[] }
  | { readonly status: "noTeams" }
  | { readonly status: "failed" };

/**
 * EO-428 FR-428.2: answers "which team do you mean" in the personal app scope.
 *
 * The Product Owner decision is "primary team as the default, switchable": a single team or a
 * marked primary team is selected without asking, so the common case costs no clicks. Only a real
 * ambiguity — several teams, none of them primary — produces a question.
 */
export function TeamContextPicker({ onSelected, t }: TeamContextPickerProps) {
  const logger = useLogger();
  const [state, setState] = useState<PickerState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    const choose = async (team: UserTeam) => {
      const userId = await resolveCurrentUserId(logger);
      writeActiveTeamSelection({ teamId: team.teamId, teamName: team.teamName }, userId, logger);

      if (!cancelled) {
        onSelected();
      }
    };

    getMyTeams().then((result) => {
      if (cancelled) {
        return;
      }

      if (!result.ok) {
        setState({ status: "failed" });
        return;
      }

      if (result.teams.length === 0) {
        setState({ status: "noTeams" });
        return;
      }

      const preselected = result.teams.length === 1
        ? result.teams[0]
        : result.teams.find((team) => team.isPrimary);

      if (preselected) {
        void choose(preselected);
        return;
      }

      setState({ status: "choose", teams: result.teams });
    });

    return () => {
      cancelled = true;
    };
  }, [logger, onSelected]);

  if (state.status === "loading") {
    return (
      <div className={styles.picker} aria-live="polite">
        <Spinner size="tiny" />
        <span>{t("teamContextPickerLoading")}</span>
      </div>
    );
  }

  if (state.status === "noTeams") {
    return <p className={styles.message}>{t("teamContextPickerNoTeams")}</p>;
  }

  if (state.status === "failed") {
    return <p className={styles.message}>{t("teamContextPickerFailed")}</p>;
  }

  return (
    <div className={styles.picker}>
      <span className={styles.message}>{t("teamContextPickerPrompt")}</span>
      <div className={styles.options}>
        {state.teams.map((team) => (
          <Button
            key={team.teamId}
            appearance="secondary"
            onClick={() => {
              void resolveCurrentUserId(logger).then((userId) => {
                writeActiveTeamSelection({ teamId: team.teamId, teamName: team.teamName }, userId, logger);
                onSelected();
              });
            }}
          >
            {team.teamName}
          </Button>
        ))}
      </div>
    </div>
  );
}
