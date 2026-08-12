import type { VacationBalance } from "../../models/resource";
import styles from "./ResourceSummaryPanel.module.css";

interface VacationSummaryProps {
  readonly balance: VacationBalance;
  readonly label: string;
  readonly iconLabel: string;
  readonly entitlementLabel: string;
  readonly bookedLabel: string;
  readonly remainingLabel: string;
  readonly entitlementTooltip: string;
  readonly bookedTooltip: string;
  readonly remainingTooltip: string;
  readonly daysLabel: string;
}

export function VacationSummary({
  balance,
  label,
  iconLabel,
  entitlementLabel,
  bookedLabel,
  remainingLabel,
  entitlementTooltip,
  bookedTooltip,
  remainingTooltip,
  daysLabel
}: VacationSummaryProps) {
  return (
    <div className={styles.vacation} aria-label={label}>
      <span className={styles.vacationLabel} aria-hidden="true" title={label}>{iconLabel}</span>
      <span className={styles.vacationMetric} title={`${entitlementTooltip}: ${balance.annualEntitlement} ${daysLabel}`}>
        <strong>{entitlementLabel}{balance.annualEntitlement}</strong>
      </span>
      <span className={styles.vacationMetric} title={`${bookedTooltip}: ${balance.booked} ${daysLabel}`}>
        <strong>{bookedLabel}{balance.booked}</strong>
      </span>
      <span
        className={`${styles.vacationMetric} ${styles.vacationRemaining}`}
        title={`${remainingTooltip}: ${balance.remaining} ${daysLabel}`}
      >
        <strong>{remainingLabel}{balance.remaining}</strong>
      </span>
    </div>
  );
}
