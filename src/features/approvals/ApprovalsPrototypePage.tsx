import { useMemo, useState } from "react";
import { Badge, Button, Switch } from "@fluentui/react-components";
import type { AbsenceDraft, AbsenceType, DayHalf } from "../../models/absence";
import type { TranslationKey } from "../../localization/translations";
import type { VacationRequestDraft, VacationRequestStatus } from "../../models/approval";
import type { PlanningRepositories } from "../../repositories/planningRepositories";
import { getAbsenceTypeLabel, getAbsenceTypeLabelByKey, getConfiguredAbsenceTypes } from "../../data/absenceTypes";
import { calculateAbsenceDuration, createAbsenceFromDraft, validateAbsenceDraft } from "../../services/absenceCalculations";
import { invalidatePlanningBootstrapCache } from "../../services/planningBootstrapService";
import styles from "./ApprovalsPrototypePage.module.css";

type PrototypeStep = "prepare" | "review" | "submitted" | "teamLead" | "decision";

interface TimelineItem {
  readonly key: PrototypeStep;
  readonly labelKey: TranslationKey;
}

const requester = {
  userId: "gianni-zanetti",
  displayName: "Alex Mueller",
  teamId: "platform-services",
  teamName: "Platform Services"
};

const teamLead = {
  userId: "department-head-platform",
  displayName: "Abteilungsleitung Platform Services"
};

const timelineItems: readonly TimelineItem[] = [
  { key: "prepare", labelKey: "approvalPrototypeStepPrepare" },
  { key: "review", labelKey: "approvalPrototypeStepReview" },
  { key: "submitted", labelKey: "approvalPrototypeStepSubmitted" },
  { key: "teamLead", labelKey: "approvalPrototypeStepTeamLead" },
  { key: "decision", labelKey: "approvalPrototypeStepDecision" }
];

const initialDraft: VacationRequestDraft = {
  teamId: requester.teamId,
  userId: "gianni-zanetti",
  absenceType: "vacation",
  startDate: "2026-08-10",
  startHalf: "fullDay",
  endDate: "2026-08-14",
  endHalf: "fullDay",
  comment: "Sommerferien",
  syncToOutlook: true
};

interface ApprovalsPrototypePageProps {
  readonly repositories: PlanningRepositories;
  readonly t: (key: TranslationKey) => string;
  readonly isMockMode?: boolean;
}

export function ApprovalsPrototypePage({ repositories, t, isMockMode = true }: ApprovalsPrototypePageProps) {
  const effectiveMode = isMockMode ? "mock" : "m365";

  const [step, setStep] = useState<PrototypeStep>("prepare");
  const [draft, setDraft] = useState<VacationRequestDraft>(initialDraft);
  const [status, setStatus] = useState<VacationRequestStatus>("draft");
  const [decisionComment, setDecisionComment] = useState("");
  const [validationErrors, setValidationErrors] = useState<readonly TranslationKey[]>([]);
  const [approvalSaveError, setApprovalSaveError] = useState<string | undefined>();
  const [approvalSaved, setApprovalSaved] = useState(false);
  const configuredAbsenceTypes = useMemo(() => getConfiguredAbsenceTypes(), []);
  const duration = useMemo(() => calculateAbsenceDuration({
    startDate: draft.startDate,
    startHalf: draft.startHalf,
    endDate: draft.endDate,
    endHalf: draft.endHalf
  }), [draft]);

  const updateDraft = <Key extends keyof VacationRequestDraft>(key: Key, value: VacationRequestDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setValidationErrors([]);
  };

  const reviewRequest = () => {
    const validation = validateAbsenceDraft({
      employeeId: draft.userId,
      type: draft.absenceType,
      startDate: draft.startDate,
      startHalf: draft.startHalf,
      endDate: draft.endDate,
      endHalf: draft.endHalf,
      comment: draft.comment
    });

    if (!validation.isValid) {
      setValidationErrors(validation.errors);
      return;
    }

    setStatus("draft");
    setStep("review");
  };

  const saveDraft = () => {
    setStatus("draft");
    setStep("prepare");
  };

  const submitRequest = () => {
    setStatus("pendingApproval");
    setStep("submitted");
  };

  const openTeamLeadDecision = () => {
    setStep("teamLead");
  };

  const approveRequest = async () => {
    const success = await persistApprovedVacation(draft);

    setApprovalSaved(success);
    setStatus(success ? "approved" : "failed");
    setStep("decision");
  };

  const rejectRequest = () => {
    setStatus("rejected");
    setStep("decision");
    setApprovalSaved(false);
    setApprovalSaveError(undefined);
  };

  const cancelRequest = () => {
    setStatus("cancelled");
    setStep("decision");
  };

  const persistApprovedVacation = async (draft: VacationRequestDraft): Promise<boolean> => {
    const employeeId = `resource-${draft.userId}`;
    const absenceDraft: AbsenceDraft = {
      employeeId,
      type: draft.absenceType,
      startDate: draft.startDate,
      startHalf: draft.startHalf,
      endDate: draft.endDate,
      endHalf: draft.endHalf,
      comment: draft.comment
    };
    const approvedAbsence = {
      ...createAbsenceFromDraft(absenceDraft),
      approvalStatus: "approved" as const
    };

    const saveResult = await repositories.absences.saveAbsence(approvedAbsence);

    if (!saveResult.ok) {
      setApprovalSaveError(t("approvalPrototypePersistError"));
      return false;
    }

    invalidatePlanningBootstrapCache(repositories);
    setApprovalSaveError(undefined);
    return true;
  };

  const resetPrototype = () => {
    setDraft(initialDraft);
    setStatus("draft");
    setDecisionComment("");
    setValidationErrors([]);
    setApprovalSaved(false);
    setApprovalSaveError(undefined);
    setStep("prepare");
  };

  return (
    <section className={styles.page} aria-label={t("approvalPrototypeTitle")}>
      <WorkflowTimeline activeStep={step} status={status} t={t} />

      <div className={styles.grid}>
        <section className={`${styles.card} ${styles.primaryCard}`} aria-labelledby="approval-prototype-main-title">
          <div className={styles.cardHeader}>
            <span className={styles.kicker}>
              {effectiveMode === "mock" 
                ? t("approvalPrototypeBadge") 
                : t("approvalLiveModeBadge")}
            </span>
            <h3 className={styles.cardTitle} id="approval-prototype-main-title">
              {getStepTitle(step, t)}
            </h3>
            <p className={styles.cardDescription}>{getStepDescription(step, t)}</p>
          </div>

          {step === "prepare" ? (
            <PrepareStep
              draft={draft}
              duration={duration}
              errors={validationErrors}
              absenceTypes={configuredAbsenceTypes}
              onReview={reviewRequest}
              onSaveDraft={saveDraft}
              onUpdateDraft={updateDraft}
              t={t}
            />
          ) : step === "review" ? (
            <ReviewStep
              draft={draft}
              duration={duration}
              onBack={() => setStep("prepare")}
              onSubmit={submitRequest}
              t={t}
            />
          ) : step === "submitted" ? (
            <SubmittedStep
              onCancel={cancelRequest}
              onOpenTeamLead={openTeamLeadDecision}
              t={t}
            />
          ) : step === "teamLead" ? (
            <TeamLeadStep
              decisionComment={decisionComment}
              draft={draft}
              duration={duration}
              onApprove={approveRequest}
              onBack={() => setStep("submitted")}
              onDecisionCommentChange={setDecisionComment}
              onReject={rejectRequest}
              t={t}
            />
          ) : (
            <DecisionStep
              decisionComment={decisionComment}
              onReset={resetPrototype}
              status={status}
              approvalSaved={approvalSaved}
              approvalSaveError={approvalSaveError}
              t={t}
            />
          )}
        </section>

        <RequestSummary draft={draft} duration={duration} status={status} t={t} />
      </div>
    </section>
  );
}

function PrepareStep({
  absenceTypes,
  draft,
  duration,
  errors,
  onReview,
  onSaveDraft,
  onUpdateDraft,
  t
}: {
  readonly absenceTypes: ReturnType<typeof getConfiguredAbsenceTypes>;
  readonly draft: VacationRequestDraft;
  readonly duration: number;
  readonly errors: readonly TranslationKey[];
  readonly onReview: () => void;
  readonly onSaveDraft: () => void;
  readonly onUpdateDraft: <Key extends keyof VacationRequestDraft>(key: Key, value: VacationRequestDraft[Key]) => void;
  readonly t: (key: TranslationKey) => string;
}) {
  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span>{t("absenceFieldType")}</span>
        <select value={draft.absenceType} onChange={(event) => onUpdateDraft("absenceType", event.target.value as AbsenceType)}>
          {absenceTypes.map((type) => (
            <option key={type.key} value={type.key}>{getAbsenceTypeLabel(type, t)}</option>
          ))}
        </select>
      </label>

      <div className={styles.fieldGrid}>
        <DateField label={t("absenceFieldStartDate")} value={draft.startDate} onChange={(value) => onUpdateDraft("startDate", value)} />
        <HalfField label={t("absenceFieldStartHalf")} value={draft.startHalf} onChange={(value) => onUpdateDraft("startHalf", value)} t={t} />
        <DateField label={t("absenceFieldEndDate")} value={draft.endDate} onChange={(value) => onUpdateDraft("endDate", value)} />
        <HalfField label={t("absenceFieldEndHalf")} value={draft.endHalf} onChange={(value) => onUpdateDraft("endHalf", value)} t={t} />
      </div>

      <label className={styles.field}>
        <span>{t("absenceFieldComment")}</span>
        <textarea value={draft.comment ?? ""} onChange={(event) => onUpdateDraft("comment", event.target.value)} rows={3} />
      </label>

      <section className={styles.inlineSection} aria-label={t("absenceSyncTitle")}>
        <Switch
          checked={draft.syncToOutlook}
          label={t("absenceSyncOutlook")}
          onChange={(_, data) => onUpdateDraft("syncToOutlook", data.checked)}
        />
      </section>

      <div className={styles.metric}>
        <span>{t("absenceCalculatedWorkdays")}</span>
        <strong>{duration}</strong>
      </div>

      {errors.length > 0 ? (
        <div className={styles.validation} role="alert">
          {errors.map((error) => <span key={error}>{t(error)}</span>)}
        </div>
      ) : null}

      <div className={styles.actions}>
        <Button appearance="secondary" onClick={onSaveDraft}>{t("vacationRequestSaveDraft")}</Button>
        <Button appearance="primary" onClick={onReview}>{t("approvalPrototypeReviewRequest")}</Button>
      </div>
    </div>
  );
}

function ReviewStep({
  draft,
  duration,
  onBack,
  onSubmit,
  t
}: {
  readonly draft: VacationRequestDraft;
  readonly duration: number;
  readonly onBack: () => void;
  readonly onSubmit: () => void;
  readonly t: (key: TranslationKey) => string;
}) {
  return (
    <div className={styles.stack}>
      <RequestFacts draft={draft} duration={duration} t={t} />
      <div className={styles.approvalBox}>
        <span>{t("vacationRequestApprover")}</span>
        <strong>{teamLead.displayName}</strong>
        <p>{t("approvalPrototypeRoutingHint")}</p>
      </div>
      <div className={styles.actions}>
        <Button appearance="secondary" onClick={onBack}>{t("approvalPrototypeBackToEdit")}</Button>
        <Button appearance="primary" onClick={onSubmit}>{t("vacationRequestSubmitForApproval")}</Button>
      </div>
    </div>
  );
}

function SubmittedStep({
  onCancel,
  onOpenTeamLead,
  t
}: {
  readonly onCancel: () => void;
  readonly onOpenTeamLead: () => void;
  readonly t: (key: TranslationKey) => string;
}) {
  return (
    <div className={styles.stack}>
      <div className={styles.statusPanel}>
        <Badge appearance="filled" color="important">{t("approvalStatusPendingApproval")}</Badge>
        <p>{t("approvalPrototypeSubmittedMessage")}</p>
      </div>
      <div className={styles.actions}>
        <Button appearance="secondary" onClick={onCancel}>{t("approvalPrototypeCancelRequest")}</Button>
        <Button appearance="primary" onClick={onOpenTeamLead}>{t("approvalPrototypeOpenTeamLead")}</Button>
      </div>
    </div>
  );
}

function TeamLeadStep({
  decisionComment,
  draft,
  duration,
  onApprove,
  onBack,
  onDecisionCommentChange,
  onReject,
  t
}: {
  readonly decisionComment: string;
  readonly draft: VacationRequestDraft;
  readonly duration: number;
  readonly onApprove: () => void;
  readonly onBack: () => void;
  readonly onDecisionCommentChange: (value: string) => void;
  readonly onReject: () => void;
  readonly t: (key: TranslationKey) => string;
}) {
  return (
    <div className={styles.stack}>
      <RequestFacts draft={draft} duration={duration} t={t} />
      <label className={styles.field}>
        <span>{t("approvalPrototypeDecisionComment")}</span>
        <textarea value={decisionComment} onChange={(event) => onDecisionCommentChange(event.target.value)} rows={3} />
      </label>
      <div className={styles.actions}>
        <Button appearance="secondary" onClick={onBack}>{t("approvalPrototypeBackToPending")}</Button>
        <Button appearance="secondary" onClick={onReject}>{t("approvalPrototypeReject")}</Button>
        <Button appearance="primary" onClick={onApprove}>{t("approvalPrototypeApprove")}</Button>
      </div>
    </div>
  );
}

function DecisionStep({
  decisionComment,
  onReset,
  status,
  approvalSaved,
  approvalSaveError,
  t
}: {
  readonly decisionComment: string;
  readonly onReset: () => void;
  readonly status: VacationRequestStatus;
  readonly approvalSaved: boolean;
  readonly approvalSaveError?: string;
  readonly t: (key: TranslationKey) => string;
}) {
  return (
    <div className={styles.stack}>
      <div className={styles.statusPanel}>
        <Badge appearance="filled" color={status === "approved" ? "success" : status === "rejected" ? "danger" : "warning"}>
          {getStatusLabel(status, t)}
        </Badge>
        <p>{getDecisionMessage(status, t)}</p>
        {approvalSaved ? <p className={styles.comment}>{t("approvalPrototypeApprovedPersistedMessage")}</p> : null}
        {approvalSaveError ? <p className={styles.comment}>{approvalSaveError}</p> : null}
        {decisionComment ? <p className={styles.comment}>{decisionComment}</p> : null}
      </div>
      <div className={styles.actions}>
        <Button appearance="primary" onClick={onReset}>{t("approvalPrototypeStartNew")}</Button>
      </div>
    </div>
  );
}

function RequestSummary({
  draft,
  duration,
  status,
  t
}: {
  readonly draft: VacationRequestDraft;
  readonly duration: number;
  readonly status: VacationRequestStatus;
  readonly t: (key: TranslationKey) => string;
}) {
  return (
    <aside className={styles.card} aria-label={t("approvalPrototypeSummaryTitle")}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{t("approvalPrototypeSummaryTitle")}</h3>
        <p className={styles.cardDescription}>{t("approvalPrototypeSummaryDescription")}</p>
      </div>
      <div className={styles.statusRow}>
        <span>{t("vacationRequestStatus")}</span>
        <Badge appearance="filled" color={getStatusColor(status)}>{getStatusLabel(status, t)}</Badge>
      </div>
      <RequestFacts draft={draft} duration={duration} t={t} />
      <div className={styles.approvalBox}>
        <span>{t("approvalPrototypeRequester")}</span>
        <strong>{requester.displayName}</strong>
        <span>{requester.teamName}</span>
      </div>
      <div className={styles.approvalBox}>
        <span>{t("vacationRequestApprover")}</span>
        <strong>{teamLead.displayName}</strong>
        <span>{t("approvalPrototypeMockOnly")}</span>
      </div>
    </aside>
  );
}

function WorkflowTimeline({
  activeStep,
  status,
  t
}: {
  readonly activeStep: PrototypeStep;
  readonly status: VacationRequestStatus;
  readonly t: (key: TranslationKey) => string;
}) {
  const activeIndex = timelineItems.findIndex((item) => item.key === activeStep);

  return (
    <section className={styles.timeline} aria-label={t("approvalPrototypeTimeline")}>
      {timelineItems.map((item, index) => (
        <div
          className={`${styles.timelineItem} ${index <= activeIndex ? styles.timelineItemActive : ""}`}
          key={item.key}
        >
          <span className={styles.timelineDot}>{index + 1}</span>
          <span>{t(item.labelKey)}</span>
        </div>
      ))}
      <Badge appearance="filled" color={getStatusColor(status)}>{getStatusLabel(status, t)}</Badge>
    </section>
  );
}

function RequestFacts({
  draft,
  duration,
  t
}: {
  readonly draft: VacationRequestDraft;
  readonly duration: number;
  readonly t: (key: TranslationKey) => string;
}) {
  return (
    <dl className={styles.facts}>
      <div>
        <dt>{t("absenceFieldType")}</dt>
        <dd>{getAbsenceTypeLabelByKey(draft.absenceType, t)}</dd>
      </div>
      <div>
        <dt>{t("absenceFieldStartDate")}</dt>
        <dd>{draft.startDate} · {t(getDayHalfLabel(draft.startHalf))}</dd>
      </div>
      <div>
        <dt>{t("absenceFieldEndDate")}</dt>
        <dd>{draft.endDate} · {t(getDayHalfLabel(draft.endHalf))}</dd>
      </div>
      <div>
        <dt>{t("absenceCalculatedWorkdays")}</dt>
        <dd>{duration} {t("detailsDays")}</dd>
      </div>
      <div>
        <dt>{t("absenceSyncTitle")}</dt>
        <dd>{draft.syncToOutlook ? t("mySettingsOutlookEnabled") : t("mySettingsOutlookDisabled")}</dd>
      </div>
      <div>
        <dt>{t("absenceFieldComment")}</dt>
        <dd>{draft.comment || t("mySettingsNotConfigured")}</dd>
      </div>
    </dl>
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

function getStepTitle(step: PrototypeStep, t: (key: TranslationKey) => string): string {
  const labels: Record<PrototypeStep, TranslationKey> = {
    prepare: "approvalPrototypePrepareTitle",
    review: "approvalPrototypeReviewTitle",
    submitted: "approvalPrototypeSubmittedTitle",
    teamLead: "approvalPrototypeTeamLeadTitle",
    decision: "approvalPrototypeDecisionTitle"
  };

  return t(labels[step]);
}

function getStepDescription(step: PrototypeStep, t: (key: TranslationKey) => string): string {
  const labels: Record<PrototypeStep, TranslationKey> = {
    prepare: "approvalPrototypePrepareDescription",
    review: "approvalPrototypeReviewDescription",
    submitted: "approvalPrototypeSubmittedDescription",
    teamLead: "approvalPrototypeTeamLeadDescription",
    decision: "approvalPrototypeDecisionDescription"
  };

  return t(labels[step]);
}

function getDayHalfLabel(dayHalf: DayHalf): TranslationKey {
  return dayHalf === "morning"
    ? "dayHalfMorning"
    : dayHalf === "afternoon"
      ? "dayHalfAfternoon"
      : "dayHalfFullDay";
}

function getStatusLabel(status: VacationRequestStatus, t: (key: TranslationKey) => string): string {
  const labels: Record<VacationRequestStatus, TranslationKey> = {
    approved: "approvalStatusApproved",
    cancelled: "approvalStatusCancelled",
    draft: "approvalStatusDraft",
    failed: "approvalStatusFailed",
    pendingApproval: "approvalStatusPendingApproval",
    rejected: "approvalStatusRejected",
    submitted: "approvalStatusSubmitted"
  };

  return t(labels[status]);
}

function getStatusColor(status: VacationRequestStatus): "brand" | "danger" | "important" | "informative" | "severe" | "success" | "subtle" | "warning" {
  if (status === "approved") {
    return "success";
  }

  if (status === "rejected") {
    return "danger";
  }

  if (status === "cancelled" || status === "failed") {
    return "warning";
  }

  if (status === "pendingApproval" || status === "submitted") {
    return "important";
  }

  return "subtle";
}

function getDecisionMessage(status: VacationRequestStatus, t: (key: TranslationKey) => string): string {
  if (status === "approved") {
    return t("approvalPrototypeApprovedMessage");
  }

  if (status === "rejected") {
    return t("approvalPrototypeRejectedMessage");
  }

  if (status === "cancelled") {
    return t("approvalPrototypeCancelledMessage");
  }

  return t("approvalPrototypeDecisionDescription");
}
