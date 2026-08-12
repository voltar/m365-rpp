import { useEffect } from "react";
import { Button } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { AbsenceForm } from "../absences/AbsenceForm";
import type { TranslationKey } from "../../localization/translations";
import type { AbsenceDraft } from "../../models/absence";
import type { DetailsPanelState } from "../../models/detailsPanel";
import type { ResourceSummary } from "../../models/resource";
import { PresenceDetails } from "./PresenceDetails";
import { ResourceDetails } from "./ResourceDetails";
import styles from "./DetailsPanel.module.css";

interface SidePanelProps {
  readonly state: DetailsPanelState;
  readonly resources: readonly ResourceSummary[];
  readonly onDeleteAbsence: (absenceId: string) => void;
  readonly onSaveAbsence: (draft: AbsenceDraft) => void;
  readonly onRequestAbsenceApproval?: (draft: AbsenceDraft, options?: { readonly selectedApproverId?: string }) => void | Promise<void>;
  readonly isApprovalExemptResource?: (resource: ResourceSummary) => boolean;
  readonly onClose: () => void;
  readonly t: (key: TranslationKey) => string;
}

export function SidePanel({
  state,
  resources,
  onClose,
  onDeleteAbsence,
  isApprovalExemptResource,
  onRequestAbsenceApproval,
  onSaveAbsence,
  t
}: SidePanelProps) {
  useEffect(() => {
    if (state.kind === "closed") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, state.kind]);

  if (state.kind === "closed") {
    return null;
  }

  const title =
    state.kind === "resource"
      ? t("detailsResourceTitle")
      : state.kind === "event"
        ? t("detailsPresenceTitle")
        : state.kind === "absenceCreate"
          ? t("absenceCreateTitle")
          : t("absenceEditTitle");

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <aside className={styles.panel} aria-label={title}>
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <Button appearance="subtle" aria-label={t("detailsClose")} icon={<DismissRegular />} onClick={onClose} />
        </header>
        <div className={styles.body}>
          {state.kind === "resource" ? <ResourceDetails resource={state.resource} t={t} /> : null}
          {state.kind === "event" ? <PresenceDetails event={state.event} t={t} /> : null}
          {state.kind === "absenceCreate" ? (
            <AbsenceForm
              defaultDate={state.date}
              resource={state.resource}
              resources={resources}
              onCancel={onClose}
              onRequestApproval={isApprovalExemptResource?.(state.resource) ? undefined : onRequestAbsenceApproval}
              onSubmit={onSaveAbsence}
              t={t}
            />
          ) : null}
          {state.kind === "absenceEdit" ? (
            <AbsenceForm
              absence={state.absence}
              defaultDate={state.absence.startDate}
              resource={state.resource}
              resources={resources}
              onCancel={onClose}
              onDelete={() => onDeleteAbsence(state.absence.id)}
              onRequestApproval={isApprovalExemptResource?.(state.resource) ? undefined : onRequestAbsenceApproval}
              onSubmit={onSaveAbsence}
              t={t}
            />
          ) : null}
        </div>
      </aside>
    </>
  );
}
