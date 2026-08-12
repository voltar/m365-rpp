import { useEffect, useState } from "react";
import type { DayHalf } from "../../models/absence";
import type { TranslationKey } from "../../localization/translations";
import { BalanceAdjustmentDialog } from "./BalanceAdjustmentDialog";
import { BalanceHistoryDialog } from "./BalanceHistoryDialog";
import { VacationBalanceCard } from "./VacationBalanceCard";
import { VacationBalancePreview } from "./VacationBalancePreview";
import {
  getMyVacationBalance,
  previewVacationRequest,
  updateVacationBalance
} from "./services/vacationBalanceApi";
import type { VacationBalanceOverview, VacationBalancePreview as VacationBalancePreviewModel } from "./types/vacationBalance";
import styles from "./VacationBalances.module.css";

interface VacationBalancesPageProps {
  readonly t: (key: TranslationKey) => string;
}

export function VacationBalancesPage({ t }: VacationBalancesPageProps) {
  const [overview, setOverview] = useState<VacationBalanceOverview>();
  const [startDate, setStartDate] = useState("2026-08-10");
  const [startHalf, setStartHalf] = useState<DayHalf>("fullDay");
  const [endDate, setEndDate] = useState("2026-08-14");
  const [endHalf, setEndHalf] = useState<DayHalf>("fullDay");
  const [preview, setPreview] = useState<VacationBalancePreviewModel>();

  useEffect(() => {
    getMyVacationBalance().then(setOverview);
  }, []);

  useEffect(() => {
    if (!overview) {
      return;
    }

    previewVacationRequest({
      userId: overview.balance.userId,
      vacationYear: overview.balance.vacationYear,
      startDate,
      startHalf,
      endDate,
      endHalf
    }).then(setPreview);
  }, [endDate, endHalf, overview, startDate, startHalf]);

  const adjustBalance = async (patch: Parameters<typeof updateVacationBalance>[2]) => {
    if (!overview) {
      return;
    }

    const updated = await updateVacationBalance(overview.balance.userId, overview.balance.vacationYear, patch);
    setOverview(updated);
  };

  if (!overview || !preview) {
    return <span>{t("planningBootstrapLoading")}</span>;
  }

  return (
    <section className={styles.page} aria-label={t("vacationBalanceTitle")}>
      <div className={styles.grid}>
        <VacationBalanceCard balance={overview.balance} t={t} />
        <section className={styles.card} aria-label={t("vacationBalancePreviewControlsTitle")}>
          <h3>{t("vacationBalancePreviewControlsTitle")}</h3>
          <div className={styles.fieldGrid}>
            <DateField label={t("absenceFieldStartDate")} value={startDate} onChange={setStartDate} />
            <HalfField label={t("absenceFieldStartHalf")} value={startHalf} onChange={setStartHalf} t={t} />
            <DateField label={t("absenceFieldEndDate")} value={endDate} onChange={setEndDate} />
            <HalfField label={t("absenceFieldEndHalf")} value={endHalf} onChange={setEndHalf} t={t} />
          </div>
        </section>
        <VacationBalancePreview preview={preview} t={t} />
        <BalanceAdjustmentDialog administrator="team-admin-platform" onSave={adjustBalance} t={t} />
        <BalanceHistoryDialog history={overview.history} t={t} />
      </div>
    </section>
  );
}

function DateField({ label, value, onChange }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function HalfField({
  label,
  value,
  onChange,
  t
}: {
  readonly label: string;
  readonly value: DayHalf;
  readonly onChange: (value: DayHalf) => void;
  readonly t: (key: TranslationKey) => string;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as DayHalf)}>
        <option value="fullDay">{t("dayHalfFullDay")}</option>
        <option value="morning">{t("dayHalfMorning")}</option>
        <option value="afternoon">{t("dayHalfAfternoon")}</option>
      </select>
    </label>
  );
}
