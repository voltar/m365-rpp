import { useRef, useState } from "react";
import { Tooltip } from "@fluentui/react-components";
import {
  BriefcaseRegular,
  CalendarLtrRegular,
  ClockRegular,
  HomeRegular,
  LearningAppRegular,
  MoreCircleRegular,
  PersonClockRegular,
  ShieldRegular,
  WalletCreditCardRegular,
  WrenchRegular
} from "@fluentui/react-icons";
import type { TranslationKey } from "../../localization/translations";
import type { AbsenceTimelineEditMode } from "../../services/absenceCalculations";
import type { PlanningEvent, PlanningEventType } from "../../models/planningEvent";
import type { EventColorMode } from "../../features/team-admin/services/teamAdminApi";
import type { TeamColorStyle } from "../../styles/teamColorPalette";
import styles from "./TimelineEvent.module.css";

interface TimelineEventProps {
  readonly event: PlanningEvent;
  readonly gridColumn: string;
  readonly gridRow: number;
  readonly lane: number;
  readonly eventColorMode: EventColorMode;
  readonly teamColorStyle?: TeamColorStyle;
  readonly onTimelineEdit?: (event: PlanningEvent, mode: AbsenceTimelineEditMode, halfDayDelta: number) => void;
  readonly onOpen: (event: PlanningEvent) => void;
  readonly t: (key: TranslationKey) => string;
}

interface DragState {
  readonly mode: AbsenceTimelineEditMode;
  readonly startX: number;
  readonly halfDayDelta: number;
}

const eventIconByType: Record<PlanningEventType, JSX.Element> = {
  vacation: <CalendarLtrRegular />,
  compensation: <ClockRegular />,
  education: <LearningAppRegular />,
  military: <ShieldRegular />,
  unpaidLeave: <WalletCreditCardRegular />,
  otherAbsence: <MoreCircleRegular />,
  homeOffice: <HomeRegular />,
  training: <LearningAppRegular />,
  project: <BriefcaseRegular />,
  maintenance: <WrenchRegular />,
  onCall: <ShieldRegular />,
  standby: <PersonClockRegular />
};

const eventLabelKeyByType: Record<PlanningEventType, TranslationKey> = {
  vacation: "eventTypeVacation",
  compensation: "eventTypeCompensation",
  education: "eventTypeEducation",
  homeOffice: "eventTypeHomeOffice",
  training: "eventTypeTraining",
  military: "eventTypeMilitary",
  unpaidLeave: "eventTypeUnpaidLeave",
  otherAbsence: "eventTypeOtherAbsence",
  project: "eventTypeProject",
  maintenance: "eventTypeMaintenance",
  onCall: "eventTypeOnCall",
  standby: "eventTypeStandby"
};

export function TimelineEvent({ event, gridColumn, gridRow, lane, eventColorMode, teamColorStyle, onTimelineEdit, onOpen, t }: TimelineEventProps) {
  const [dragState, setDragState] = useState<DragState>();
  const isInteractive = Boolean(event.absenceId && onTimelineEdit);
  const approvalStatusClass = event.approvalStatus ? approvalStatusClassByStatus[event.approvalStatus] : "";
  const eventTypeLabel = t(eventLabelKeyByType[event.type]);
  const statusText = event.approvalStatus ? ` • ${t(approvalStatusLabelKeyByStatus[event.approvalStatus])}` : "";
  const previewText = dragState?.halfDayDelta
    ? ` • ${dragState.halfDayDelta > 0 ? "+" : ""}${dragState.halfDayDelta / 2} ${t("detailsDays")}`
    : "";
  const tooltip = `${event.title} • ${eventTypeLabel}${statusText} • ${event.startDate} - ${event.endDate}${previewText}`;
  const marginLeft = 4 + (event.startHalf === "afternoon" ? 18 : 0) + (dragState?.mode === "resizeStart" ? dragState.halfDayDelta * 18 : 0);
  const marginRight = 4 + (event.endHalf === "morning" ? 18 : 0) - (dragState?.mode === "resizeEnd" ? dragState.halfDayDelta * 18 : 0);
  const transform = dragState?.mode === "move" ? `translateX(${dragState.halfDayDelta * 18}px)` : undefined;

  // EO-423: in byTeam mode, use team color; otherwise use event type class.
  const eventTypeClass = eventColorMode === "byTeam" && teamColorStyle ? "" : styles[event.type];
  const teamColorInlineStyle = eventColorMode === "byTeam" && teamColorStyle
    ? { background: teamColorStyle.background, borderColor: teamColorStyle.border, color: teamColorStyle.text }
    : undefined;

  const lastPointerTypeRef = useRef("mouse");

  const startInteraction = (pointerEvent: React.PointerEvent<HTMLElement>, mode: AbsenceTimelineEditMode) => {
    lastPointerTypeRef.current = pointerEvent.pointerType;

    if (!isInteractive) {
      return;
    }

    // EO-412: on touch devices the finger pans the timeline; direct editing stays
    // mouse/pen (and keyboard). A tap opens the details via the click handler.
    if (pointerEvent.pointerType === "touch") {
      return;
    }

    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
    setDragState({ mode, startX: pointerEvent.clientX, halfDayDelta: 0 });
  };

  const updateInteraction = (pointerEvent: React.PointerEvent<HTMLElement>) => {
    if (!dragState) {
      return;
    }

    const halfDayDelta = Math.round((pointerEvent.clientX - dragState.startX) / 18);
    setDragState({ ...dragState, halfDayDelta });
  };

  const finishInteraction = () => {
    if (!dragState) {
      return;
    }

    if (dragState.halfDayDelta === 0 && dragState.mode === "move") {
      onOpen(event);
    } else if (dragState.halfDayDelta !== 0) {
      onTimelineEdit?.(event, dragState.mode, dragState.halfDayDelta);
    }

    setDragState(undefined);
  };

  const handleKeyDown = (keyboardEvent: React.KeyboardEvent<HTMLButtonElement>) => {
    if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
      keyboardEvent.preventDefault();
      onOpen(event);
      return;
    }

    if (!isInteractive || !keyboardEvent.altKey) {
      return;
    }

    const direction = keyboardEvent.key === "ArrowRight" ? 1 : keyboardEvent.key === "ArrowLeft" ? -1 : 0;

    if (direction === 0) {
      return;
    }

    keyboardEvent.preventDefault();
    onTimelineEdit?.(event, keyboardEvent.shiftKey ? "resizeEnd" : "move", direction);
  };

  return (
    <Tooltip content={tooltip} relationship="label">
      <button
        className={`${styles.event} ${eventTypeClass} ${approvalStatusClass} ${isInteractive ? styles.interactive : ""} ${dragState ? styles.editing : ""}`}
        onClick={() => {
          // Touch taps (and clicks on non-editable events) open the details panel;
          // mouse opens via finishInteraction to distinguish click from drag.
          if (lastPointerTypeRef.current === "touch" || !isInteractive) {
            onOpen(event);
          }
        }}
        onKeyDown={handleKeyDown}
        onPointerDown={(pointerEvent) => startInteraction(pointerEvent, "move")}
        onPointerMove={updateInteraction}
        onPointerUp={finishInteraction}
        style={{ gridColumn, gridRow, marginTop: `${8 + lane * 23}px`, marginLeft, marginRight, transform, ...teamColorInlineStyle }}
        type="button"
      >
        {isInteractive ? (
          <span
            aria-hidden="true"
            className={`${styles.resizeHandle} ${styles.resizeStart}`}
            onPointerDown={(pointerEvent) => startInteraction(pointerEvent, "resizeStart")}
            onPointerMove={updateInteraction}
            onPointerUp={finishInteraction}
          />
        ) : null}
        {eventIconByType[event.type]}
        <span className={styles.label}>{event.title}</span>
        {event.approvalStatus ? <span className={styles.statusDot}>{t(approvalStatusLabelKeyByStatus[event.approvalStatus])}</span> : null}
        {dragState?.halfDayDelta ? <span className={styles.preview}>{dragState.halfDayDelta / 2}</span> : null}
        {isInteractive ? (
          <span
            aria-hidden="true"
            className={`${styles.resizeHandle} ${styles.resizeEnd}`}
            onPointerDown={(pointerEvent) => startInteraction(pointerEvent, "resizeEnd")}
            onPointerMove={updateInteraction}
            onPointerUp={finishInteraction}
          />
        ) : null}
      </button>
    </Tooltip>
  );
}

const approvalStatusClassByStatus: Record<NonNullable<PlanningEvent["approvalStatus"]>, string> = {
  approved: styles.approvalApproved,
  draft: styles.approvalDraft,
  pendingApproval: styles.approvalPendingApproval,
  rejected: styles.approvalRejected
};

const approvalStatusLabelKeyByStatus: Record<NonNullable<PlanningEvent["approvalStatus"]>, TranslationKey> = {
  approved: "absenceApprovalStatusApproved",
  draft: "absenceApprovalStatusDraft",
  pendingApproval: "absenceApprovalStatusPending",
  rejected: "absenceApprovalStatusRejected"
};
