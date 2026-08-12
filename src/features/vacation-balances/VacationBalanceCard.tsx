import type { TranslationKey } from "../../localization/translations";
import type { VacationBalance } from "./types/vacationBalance";
import styles from "./VacationBalances.module.css";

interface VacationBalanceCardProps {
  readonly balance: VacationBalance;
  readonly t: (key: TranslationKey) => string;
}

export function VacationBalanceCard({ balance, t }: VacationBalanceCardProps) {
  return (
    <section className={styles.card} aria-label={t("vacationBalanceTitle")}>
      <div>
        <h3>{t("vacationBalanceTitle")}</h3>
        <p>{balance.vacationYear}</p>
      </div>
      <div className={styles.metricGrid}>
        <Metric label={t("vacationBalanceAnnualEntitlement")} value={balance.annualEntitlement} />
        <Metric label={t("vacationBalanceCarryForward")} value={balance.carryForward} />
        <Metric label={t("vacationBalanceManualAdjustments")} value={balance.manualAdjustments} />
        <Metric label={t("vacationBalancePendingVacation")} value={balance.pendingVacation} />
        <Metric label={t("vacationBalanceApprovedVacation")} value={balance.approvedVacation} />
        <Metric label={t("vacationBalanceRemainingBalance")} value={balance.remainingBalance} />
      </div>
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
