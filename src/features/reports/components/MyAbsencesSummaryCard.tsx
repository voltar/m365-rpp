import { Button } from "@fluentui/react-components";
import {
  AddRegular,
  CalendarLtrRegular,
  CalendarSyncRegular,
  CheckmarkCircleRegular,
  ClockRegular
} from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { getAbsenceTypeLabelByKey } from "../../../data/absenceTypes";
import type { TranslationKey } from "../../../localization/translations";
import type { Absence, AbsenceApprovalStatus, AbsenceType } from "../../../models/absence";
import styles from "../ReportsPage.module.css";

interface MyAbsencesSummaryCardProps {
  readonly absences: readonly Absence[];
  readonly currentUserResourceId: string;
  readonly locale: string;
  readonly onNewAbsence: () => void;
  readonly t: (key: TranslationKey) => string;
}

export function MyAbsencesSummaryCard({ absences, currentUserResourceId, locale, onNewAbsence, t }: MyAbsencesSummaryCardProps) {
  const myAbsences = absences
    .filter((absence) => absence.employeeId === currentUserResourceId)
    .slice()
    .sort((first, second) => first.startDate.localeCompare(second.startDate));
  const hasApprovedAbsence = myAbsences.some((absence) => absence.approvalStatus === "approved");
  const hasPendingSyncAbsence = myAbsences.some((absence) => absence.approvalStatus !== "approved");
  const syncStatusKey: TranslationKey = hasApprovedAbsence
    ? "outlookSyncStatusSynced"
    : hasPendingSyncAbsence
      ? "reportsOutlookSyncPending"
      : "outlookSyncStatusNotRequired";

  return (
    <section className={styles.panel} aria-label={t("reportsMyAbsencesTitle")}>
      <div className={styles.panelHeader}>
        <span className={styles.panelBadge}>6</span>
        <div>
          <h3 className={styles.panelTitle}>{t("reportsMyAbsencesTitle")}</h3>
          <p className={styles.panelSubtitle}>{t("reportsMyAbsencesSubtitle")}</p>
        </div>
      </div>

      <div className={styles.absencePanelBody}>
        <div className={styles.absenceHeading}>
          <h4>{t("reportsMyAbsencesHeading")}</h4>
          <Button appearance="secondary" icon={<AddRegular />} onClick={onNewAbsence} size="small">
            {t("absenceNew")}
          </Button>
        </div>
        <div className={styles.absenceList}>
          {myAbsences.length > 0 ? (
            myAbsences.map((absence) => (
              <div className={styles.absenceItem} key={absence.id}>
                <span aria-hidden className={styles.absenceIcon}>
                  {getAbsenceIcon(absence.type)}
                </span>
                <span className={styles.absenceText}>
                  <span className={styles.absenceTitle}>{getAbsenceTypeLabelByKey(absence.type, t)}</span>
                  <span className={styles.absenceDates}>
                    {formatAbsenceRange(absence, locale)} ({formatDuration(absence.duration, locale)} {t("reportsDays")})
                  </span>
                </span>
                <span className={`${styles.badge} ${getStatusBadgeClass(absence.approvalStatus)}`}>
                  {t(getApprovalStatusLabelKey(absence.approvalStatus))}
                </span>
              </div>
            ))
          ) : (
            <p className={styles.emptyState}>{t("reportsMyAbsencesEmpty")}</p>
          )}
        </div>
      </div>

      <div className={styles.outlookBox}>
        <CalendarSyncRegular className={styles.outlookIcon} />
        <div className={styles.outlookText}>
          <span className={styles.outlookTitle}>{t("reportsOutlookSyncTitle")}</span>
          <span className={styles.outlookDescription}>{t("reportsOutlookSyncText")}</span>
          <span className={styles.syncStatus}>
            <CheckmarkCircleRegular /> {t(syncStatusKey)}
          </span>
        </div>
      </div>
    </section>
  );
}

function getAbsenceIcon(type: AbsenceType): ReactNode {
  if (type === "compensation") {
    return <ClockRegular />;
  }

  return <CalendarLtrRegular />;
}

function getApprovalStatusLabelKey(status: AbsenceApprovalStatus): TranslationKey {
  if (status === "draft") {
    return "absenceApprovalStatusDraft";
  }

  if (status === "pendingApproval") {
    return "absenceApprovalStatusPending";
  }

  if (status === "rejected") {
    return "absenceApprovalStatusRejected";
  }

  return "absenceApprovalStatusApproved";
}

function getStatusBadgeClass(status: AbsenceApprovalStatus): string {
  if (status === "pendingApproval") {
    return styles.badgeRequested;
  }

  if (status === "approved") {
    return styles.badgePlanned;
  }

  if (status === "rejected") {
    return styles.badgeRejected;
  }

  return styles.badgeDraft;
}

function formatAbsenceRange(absence: Absence, locale: string): string {
  const formatter = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  const start = formatter.format(createLocalDate(absence.startDate));
  const end = formatter.format(createLocalDate(absence.endDate));

  return absence.startDate === absence.endDate ? start : `${start} - ${end}`;
}

function formatDuration(duration: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(duration);
}

function createLocalDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00`);
}
