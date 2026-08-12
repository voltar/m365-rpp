import { useState } from "react";
import { Button } from "@fluentui/react-components";
import type { TranslationKey } from "../../localization/translations";
import type { VacationBalancePatch } from "./types/vacationBalance";
import styles from "./VacationBalances.module.css";

interface BalanceAdjustmentDialogProps {
  readonly administrator: string;
  readonly onSave: (patch: VacationBalancePatch) => void;
  readonly t: (key: TranslationKey) => string;
}

export function BalanceAdjustmentDialog({ administrator, onSave, t }: BalanceAdjustmentDialogProps) {
  const [adjustment, setAdjustment] = useState(0);
  const [reason, setReason] = useState("");

  return (
    <section className={styles.card} aria-label={t("vacationBalanceAdjustmentTitle")}>
      <h3>{t("vacationBalanceAdjustmentTitle")}</h3>
      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span>{t("vacationBalanceAdjustmentValue")}</span>
          <input type="number" step="0.5" value={adjustment} onChange={(event) => setAdjustment(Number(event.target.value))} />
        </label>
        <label className={styles.field}>
          <span>{t("vacationBalanceAdjustmentReason")}</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      </div>
      <div className={styles.actions}>
        <Button
          appearance="secondary"
          disabled={!reason.trim() || adjustment === 0}
          onClick={() => onSave({ adjustment, reason, administrator })}
        >
          {t("vacationBalanceSaveAdjustment")}
        </Button>
      </div>
    </section>
  );
}
