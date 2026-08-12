import { useEffect, useMemo, useState } from "react";
import { Button, Switch } from "@fluentui/react-components";
import { CalendarMailRegular, DeleteRegular } from "@fluentui/react-icons";
import { useLogger } from "../../core/logging";
import type { TranslationKey } from "../../localization/translations";
import type { Absence, AbsenceApprovalStatus, AbsenceDraft, AbsenceType, DayHalf } from "../../models/absence";
import type { ResourceSummary } from "../../models/resource";
import { getAbsenceTypeLabel, getConfiguredAbsenceTypes } from "../../data/absenceTypes";
import {
  fetchApproverOptionsForResource,
  getApproverOptionsForResource,
  type ApproverOptions
} from "../../features/team-admin/services/teamAdminApi";
import { calculateAbsenceDuration, validateAbsenceDraft } from "../../services/absenceCalculations";
import styles from "./AbsenceForm.module.css";

interface AbsenceFormProps {
  readonly absence?: Absence;
  readonly defaultDate: string;
  readonly resource: ResourceSummary;
  readonly resources: readonly ResourceSummary[];
  readonly t: (key: TranslationKey) => string;
  readonly onDelete?: () => void;
  readonly onCancel: () => void;
  readonly onSubmit: (draft: AbsenceDraft) => void;
  readonly onRequestApproval?: (draft: AbsenceDraft, options?: { readonly selectedApproverId?: string }) => void | Promise<void>;
}

export function AbsenceForm({
  absence,
  defaultDate,
  resource,
  resources,
  t,
  onCancel,
  onDelete,
  onSubmit,
  onRequestApproval
}: AbsenceFormProps) {
  const logger = useLogger();
  const [draft, setDraft] = useState<AbsenceDraft>(() => ({
    employeeId: resource.id,
    type: absence?.type ?? "vacation",
    startDate: absence?.startDate ?? defaultDate,
    startHalf: absence?.startHalf ?? "fullDay",
    // New absences default to one working week (start + 4 working days).
    endDate: absence?.endDate ?? addWorkingDays(defaultDate, 4),
    endHalf: absence?.endHalf ?? "fullDay",
    substitute: absence?.substitute ?? "",
    comment: absence?.comment ?? ""
  }));
  const [errors, setErrors] = useState<readonly TranslationKey[]>([]);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isRequestingApproval, setIsRequestingApproval] = useState(false);
  // EO-417: approver selection per Team Admin policy ("allow user override").
  // Load from the member-readable API so non-owners are not stuck with an empty
  // Team Admin cache (owner-gated getAllTeamDetails never warms for them).
  const [approverOptions, setApproverOptions] = useState<ApproverOptions>(() => getApproverOptionsForResource(resource.id));
  const [selectedApproverId, setSelectedApproverId] = useState<string>(
    () => getApproverOptionsForResource(resource.id).defaultApproverUserId ?? ""
  );
  const configuredAbsenceTypes = useMemo(() => getConfiguredAbsenceTypes(), []);
  const duration = useMemo(() => calculateAbsenceDuration(draft), [draft]);
  const approvalStatus = absence?.approvalStatus ?? "draft";
  const canRequestApproval = Boolean(onRequestApproval && approvalStatus === "draft");
  const currentAbsenceVacation = absence?.type === "vacation" ? absence.duration : 0;
  const bookedBeforeDraft = Math.max(0, resource.vacation.booked - currentAbsenceVacation);

  useEffect(() => {
    let cancelled = false;

    void fetchApproverOptionsForResource(resource.id).then((options) => {
      if (cancelled) {
        return;
      }

      setApproverOptions(options);
      setSelectedApproverId((current) => {
        if (current && options.candidates.some((candidate) => candidate.userId === current)) {
          return current;
        }

        return options.defaultApproverUserId
          ?? options.candidates[0]?.userId
          ?? "";
      });
    });

    return () => {
      cancelled = true;
    };
  }, [resource.id]);

  const updateDraft = <Key extends keyof AbsenceDraft>(key: Key, value: AbsenceDraft[Key]) => {
    setDraft((current) => {
      const next = { ...current, [key]: value };

      // The end date never precedes the start date: follow the start date forward,
      // and clamp a manually chosen earlier end date to the start date.
      if (key === "startDate" && typeof value === "string" && next.endDate < value) {
        return { ...next, endDate: value };
      }

      if (key === "endDate" && typeof value === "string" && value < next.startDate) {
        return { ...next, endDate: next.startDate };
      }

      return next;
    });
    setErrors([]);
  };

  const validate = (operation: "validateAbsenceCreate" | "validateAbsenceUpdate" | "validateAbsenceRequest"): boolean => {
    const result = validateAbsenceDraft(draft);

    if (!result.isValid) {
      setErrors(result.errors);
      logger.warn("Absence validation failed.", {
        source: "ui",
        component: "AbsenceForm",
        operation,
        details: { errors: result.errors, employeeId: draft.employeeId }
      });
      return false;
    }

    return true;
  };

  const submit = () => {
    if (!validate(absence ? "validateAbsenceUpdate" : "validateAbsenceCreate")) {
      return;
    }

    onSubmit(draft);
  };

  const requestApproval = async () => {
    if (isRequestingApproval || !validate("validateAbsenceRequest")) {
      return;
    }

    if (!selectedApproverId) {
      setErrors(["absenceApproverRequired"]);
      logger.warn("Approval request blocked: no approver selected or configured.", {
        source: "ui",
        component: "AbsenceForm",
        operation: "validateAbsenceRequest",
        details: { employeeId: draft.employeeId }
      });
      return;
    }

    // Disabled while the submission runs: gives immediate feedback and prevents
    // double submits (each click would create another Microsoft Approval).
    setIsRequestingApproval(true);

    try {
      await onRequestApproval?.(draft, { selectedApproverId });
    } finally {
      setIsRequestingApproval(false);
    }
  };

  return (
    <div className={styles.form}>
      <div className={styles.resourceContext}>
        <span className={styles.resourceName}>{resource.displayName}</span>
        <span>{resource.primaryTeam}</span>
      </div>

      {absence ? (
        <div className={`${styles.statusBadge} ${styles[approvalStatus]}`}>
          <span>{t("absenceApprovalStatus")}</span>
          <strong>{t(absenceApprovalStatusLabelKey[approvalStatus])}</strong>
        </div>
      ) : null}

      <label className={styles.field}>
        <span>{t("absenceFieldType")}</span>
        <select value={draft.type} onChange={(event) => updateDraft("type", event.target.value as AbsenceType)}>
          {configuredAbsenceTypes.map((type) => (
            <option key={type.key} value={type.key}>
              {getAbsenceTypeLabel(type, t)}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span>{t("absenceFieldStartDate")}</span>
          <input type="date" value={draft.startDate} onChange={(event) => updateDraft("startDate", event.target.value)} />
        </label>
        <label className={styles.field}>
          <span>{t("absenceFieldStartHalf")}</span>
          <select value={draft.startHalf} onChange={(event) => updateDraft("startHalf", event.target.value as DayHalf)}>
            <option value="fullDay">{t("dayHalfFullDay")}</option>
            <option value="morning">{t("dayHalfMorning")}</option>
            <option value="afternoon">{t("dayHalfAfternoon")}</option>
          </select>
        </label>
      </div>

      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span>{t("absenceFieldEndDate")}</span>
          <input type="date" value={draft.endDate} onChange={(event) => updateDraft("endDate", event.target.value)} />
        </label>
        <label className={styles.field}>
          <span>{t("absenceFieldEndHalf")}</span>
          <select value={draft.endHalf} onChange={(event) => updateDraft("endHalf", event.target.value as DayHalf)}>
            <option value="fullDay">{t("dayHalfFullDay")}</option>
            <option value="morning">{t("dayHalfMorning")}</option>
            <option value="afternoon">{t("dayHalfAfternoon")}</option>
          </select>
        </label>
      </div>

      <label className={styles.field}>
        <span>{t("absenceFieldSubstitute")}</span>
        <select value={draft.substitute ?? ""} onChange={(event) => updateDraft("substitute", event.target.value)}>
          <option value="">{t("absenceSubstituteNone")}</option>
          {resources
            .filter((candidate) => candidate.id !== resource.id)
            .map((candidate) => (
              <option key={candidate.id} value={candidate.displayName}>
                {candidate.displayName}
              </option>
            ))}
        </select>
      </label>

      {canRequestApproval ? (
        <label className={styles.field}>
          <span>{t("vacationRequestApprover")}</span>
          <select
            disabled={!approverOptions.allowOverride || approverOptions.candidates.length === 0}
            value={selectedApproverId}
            onChange={(event) => {
              setSelectedApproverId(event.target.value);
              setErrors((current) => current.filter((error) => error !== "absenceApproverRequired"));
            }}
          >
            {!selectedApproverId ? <option value="">{t("absenceApproverNone")}</option> : null}
            {approverOptions.candidates.map((candidate) => (
              <option key={candidate.userId} value={candidate.userId}>
                {candidate.displayName}
              </option>
            ))}
          </select>
          {!approverOptions.allowOverride ? (
            <small className={styles.fieldHint}>{t("absenceApproverPolicyManaged")}</small>
          ) : null}
          {approverOptions.candidates.length === 0 ? (
            <small className={styles.fieldHint}>{t("absenceApproverRequired")}</small>
          ) : null}
        </label>
      ) : null}

      <label className={styles.field}>
        <span>{t("absenceFieldComment")}</span>
        <textarea value={draft.comment ?? ""} onChange={(event) => updateDraft("comment", event.target.value)} rows={2} />
      </label>

      <div className={styles.metrics}>
        <span>{t("absenceCalculatedWorkdays")}</span>
        <strong>{duration}</strong>
      </div>

      <section className={styles.syncSection} aria-label={t("absenceSyncTitle")}>
        <span className={styles.sectionTitle}>{t("absenceSyncTitle")}</span>
        <div className={styles.outlookSyncRow}>
          <CalendarMailRegular aria-hidden="true" className={styles.outlookIcon} />
          <Switch defaultChecked={false} label={t("absenceSyncOutlook")} />
        </div>
      </section>

      <section className={styles.entitlementCard} aria-label={t("absenceVacationEntitlementTitle")}>
        <h3>{t("absenceVacationEntitlementTitle")}</h3>
        <dl className={styles.entitlementCompact}>
          <div>
            <dt>{t("absenceVacationAvailable")}</dt>
            <dd>{resource.vacation.annualEntitlement} {t("detailsDays")}</dd>
          </div>
          <div>
            <dt>{t("absenceVacationBooked")}</dt>
            <dd>{bookedBeforeDraft} {t("detailsDays")}</dd>
          </div>
        </dl>
      </section>

      {errors.length > 0 ? (
        <div className={styles.validation} role="alert">
          {errors.map((error) => (
            <span key={error}>{t(error)}</span>
          ))}
        </div>
      ) : null}

      <div className={styles.actions}>
        {onDelete ? (
          isConfirmingDelete ? (
            <Button appearance="secondary" size="small" onClick={onDelete}>
              {t("absenceDeleteConfirm")}
            </Button>
          ) : (
            <Button
              appearance="subtle"
              aria-label={t("absenceDelete")}
              icon={<DeleteRegular />}
              size="small"
              title={t("absenceDelete")}
              onClick={() => setIsConfirmingDelete(true)}
            />
          )
        ) : null}
        <Button appearance="secondary" size="small" onClick={onCancel}>
          {t("absenceCancel")}
        </Button>
        <Button appearance={canRequestApproval ? "secondary" : "primary"} size="small" onClick={submit}>
          {absence ? t("absenceUpdate") : t("absenceCreate")}
        </Button>
        {canRequestApproval ? (
          <Button appearance="primary" size="small" disabled={isRequestingApproval} onClick={() => void requestApproval()}>
            {t("absenceRequestApproval")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

const absenceApprovalStatusLabelKey: Record<AbsenceApprovalStatus, TranslationKey> = {
  approved: "absenceApprovalStatusApproved",
  draft: "absenceApprovalStatusDraft",
  pendingApproval: "absenceApprovalStatusPending",
  rejected: "absenceApprovalStatusRejected"
};

function addWorkingDays(isoDate: string, workingDays: number): string {
  const date = new Date(`${isoDate}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  let remaining = workingDays;

  while (remaining > 0) {
    date.setDate(date.getDate() + 1);

    if (date.getDay() !== 0 && date.getDay() !== 6) {
      remaining -= 1;
    }
  }

  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}
