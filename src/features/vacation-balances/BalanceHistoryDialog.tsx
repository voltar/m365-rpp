import type { TranslationKey } from "../../localization/translations";
import type { VacationBalanceAdjustment } from "./types/vacationBalance";
import styles from "./VacationBalances.module.css";

interface BalanceHistoryDialogProps {
  readonly history: readonly VacationBalanceAdjustment[];
  readonly t: (key: TranslationKey) => string;
}

export function BalanceHistoryDialog({ history, t }: BalanceHistoryDialogProps) {
  return (
    <section className={styles.card} aria-label={t("vacationBalanceHistoryTitle")}>
      <h3>{t("vacationBalanceHistoryTitle")}</h3>
      <div className={styles.historyList}>
        {history.length > 0 ? (
          history.map((item) => (
            <div className={styles.historyItem} key={item.id}>
              <strong>{item.adjustment > 0 ? `+${item.adjustment}` : item.adjustment} {t("detailsDays")}</strong>
              <span>{item.reason}</span>
              <span>{item.adjustedBy} · {new Date(item.adjustedAt).toLocaleString()}</span>
              <span>{t("vacationBalanceHistoryPrevious")}: {item.previousValue.toFixed(1)} · {t("vacationBalanceHistoryNew")}: {item.newValue.toFixed(1)}</span>
            </div>
          ))
        ) : (
          <span>{t("vacationBalanceHistoryEmpty")}</span>
        )}
      </div>
    </section>
  );
}
