import { useMemo, useState } from "react";
import { Button, Switch } from "@fluentui/react-components";
import type { AbsenceType, DayHalf } from "../../models/absence";
import type {
  VacationRequest,
  VacationRequestDraft,
  VacationRequestSubmissionOptions
} from "../../models/approval";
import type { TranslationKey } from "../../localization/translations";
import { getAbsenceTypeLabel, getConfiguredAbsenceTypes } from "../../data/absenceTypes";
import styles from "./VacationRequestForm.module.css";

export interface VacationRequestApproverOption {
  readonly userId: string;
  readonly displayName: string;
}

interface VacationRequestFormProps {
  readonly request?: VacationRequest;
  readonly initialDraft: VacationRequestDraft;
  readonly approvers: readonly VacationRequestApproverOption[];
  readonly t: (key: TranslationKey) => string;
  readonly onCancel: () => void;
  readonly onDelete?: (request: VacationRequest) => void;
  readonly onSaveDraft: (draft: VacationRequestDraft) => void;
  readonly onSubmitForApproval: (draft: VacationRequestDraft, options: VacationRequestSubmissionOptions) => void;
}

export function VacationRequestForm({
  request,
  initialDraft,
  approvers,
  t,
  onCancel,
  onDelete,
  onSaveDraft,
  onSubmitForApproval
}: VacationRequestFormProps) {
  const [draft, setDraft] = useState<VacationRequestDraft>(initialDraft);
  const [selectedApproverId, setSelectedApproverId] = useState(approvers[0]?.userId ?? "");
  const [commentToApprover, setCommentToApprover] = useState("");
  const configuredAbsenceTypes = useMemo(() => getConfiguredAbsenceTypes(), []);

  const updateDraft = <Key extends keyof VacationRequestDraft>(key: Key, value: VacationRequestDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = () => {
    onSubmitForApproval(draft, {
      selectedApproverId: selectedApproverId || undefined,
      commentToApprover: commentToApprover || undefined
    });
  };

  return (
    <div className={styles.form}>
      {request ? (
        <div className={styles.status}>
          <span>{t("vacationRequestStatus")}</span>
          <strong>{request.status}</strong>
        </div>
      ) : null}

      <label className={styles.field}>
        <span>{t("absenceFieldType")}</span>
        <select value={draft.absenceType} onChange={(event) => updateDraft("absenceType", event.target.value as AbsenceType)}>
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
        <span>{t("absenceFieldComment")}</span>
        <textarea value={draft.comment ?? ""} onChange={(event) => updateDraft("comment", event.target.value)} rows={3} />
      </label>

      <section className={styles.section} aria-label={t("vacationRequestApprovalSection")}>
        <span className={styles.sectionTitle}>{t("vacationRequestApprovalSection")}</span>
        <label className={styles.field}>
          <span>{t("vacationRequestApprover")}</span>
          <select value={selectedApproverId} onChange={(event) => setSelectedApproverId(event.target.value)}>
            {approvers.map((approver) => (
              <option key={approver.userId} value={approver.userId}>
                {approver.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t("vacationRequestCommentToApprover")}</span>
          <textarea value={commentToApprover} onChange={(event) => setCommentToApprover(event.target.value)} rows={3} />
        </label>
      </section>

      <section className={styles.section} aria-label={t("absenceSyncTitle")}>
        <span className={styles.sectionTitle}>{t("absenceSyncTitle")}</span>
        <Switch
          checked={draft.syncToOutlook}
          label={t("absenceSyncOutlook")}
          onChange={(_, data) => updateDraft("syncToOutlook", data.checked)}
        />
      </section>

      <div className={styles.actions}>
        {request && onDelete ? (
          <Button appearance="subtle" onClick={() => onDelete(request)}>
            {t("absenceDelete")}
          </Button>
        ) : null}
        <Button appearance="secondary" onClick={onCancel}>
          {t("absenceCancel")}
        </Button>
        <Button appearance="secondary" onClick={() => onSaveDraft(draft)}>
          {t("vacationRequestSaveDraft")}
        </Button>
        <Button appearance="primary" onClick={submit}>
          {t("vacationRequestSubmitForApproval")}
        </Button>
      </div>
    </div>
  );
}
