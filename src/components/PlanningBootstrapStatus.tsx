import { Button, Spinner } from "@fluentui/react-components";
import type { TranslationKey } from "../localization/translations";
import type { PlanningBootstrapState } from "../services/planningBootstrapService";
import { ErrorBanner } from "../core/logging";
import { TeamContextPicker } from "./TeamContextPicker";
import styles from "./PlanningBootstrapStatus.module.css";

interface PlanningBootstrapStatusProps {
  readonly state: PlanningBootstrapState;
  readonly onRetry: () => void;
  readonly t: (key: TranslationKey) => string;
}

export function PlanningBootstrapStatus({ state, onRetry, t }: PlanningBootstrapStatusProps) {
  if (state.status === "loading") {
    return (
      <section className={styles.status} aria-live="polite">
        <Spinner size="small" />
        <span>{t("planningBootstrapLoading")}</span>
      </section>
    );
  }

  if (state.status === "empty") {
    return (
      <section className={styles.status} aria-live="polite">
        <strong>{t("planningBootstrapEmptyTitle")}</strong>
        <span>{t("planningBootstrapEmptyMessage")}</span>
        <Button appearance="secondary" onClick={onRetry}>
          {t("errorRetryAction")}
        </Button>
      </section>
    );
  }

  // EO-428 FR-428.3: a missing team context is recoverable by the user, so it reads as an
  // instruction rather than a failure — no error styling, no correlation id to quote at support.
  // The remedy is choosing a team, which is why the picker sits next to the explanation.
  if (state.status === "noTeamContext") {
    return (
      <section className={styles.status} aria-live="polite">
        <strong>{t("planningBootstrapNoTeamContextTitle")}</strong>
        <span>{t("planningBootstrapNoTeamContextMessage")}</span>
        <TeamContextPicker onSelected={onRetry} t={t} />
      </section>
    );
  }

  // EO-428: an access problem is not an empty plan. Which sentence appears matters — "accept the
  // consent dialog" is something the user does, "ask for access" is something someone else does.
  if (state.status === "accessDenied") {
    return (
      <section className={styles.status} aria-live="polite">
        <strong>
          {state.reason === "unauthenticated"
            ? t("planningBootstrapUnauthenticatedTitle")
            : t("planningBootstrapForbiddenTitle")}
        </strong>
        <span>
          {state.reason === "unauthenticated"
            ? t("planningBootstrapUnauthenticatedMessage")
            : t("planningBootstrapForbiddenMessage")}
        </span>
        <Button appearance="primary" onClick={onRetry}>
          {t("errorRetryAction")}
        </Button>
      </section>
    );
  }

  if (state.status === "error") {
    return <ErrorBanner error={state.error} onReset={onRetry} t={t} />;
  }

  return null;
}
