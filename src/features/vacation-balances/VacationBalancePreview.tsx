import type { TranslationKey } from "../../localization/translations";
import type { VacationBalancePreview as VacationBalancePreviewModel } from "./types/vacationBalance";
import styles from "./VacationBalances.module.css";

interface VacationBalancePreviewProps {
  readonly preview: VacationBalancePreviewModel;
  readonly t: (key: TranslationKey) => string;
}

export function VacationBalancePreview({ preview, t }: VacationBalancePreviewProps) {
  return (
    <section className={styles.card} aria-label={t("vacationBalancePreviewTitle")}>
      <h3>{t("vacationBalancePreviewTitle")}</h3>
      <div className={styles.metricGrid}>
        <Metric label={t("vacationBalanceCurrentBalance")} value={preview.currentBalance} />
        <Metric label={t("vacationBalanceRequestedVacation")} value={preview.requestedVacation} />
        <Metric label={t("vacationBalanceRemainingAfterSubmission")} value={preview.remainingAfterSubmission} />
      </div>
      {preview.exceedsBalance ? <div className={styles.warning}>{t("vacationBalanceExceedsWarning")}</div> : null}
    </section>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value.toFixed(1)}</strong>
    </div>
  );
}
