import { memo, useMemo } from "react";
import type { TranslationKey } from "../../localization/translations";
import type { PlanningEvent } from "../../models/planningEvent";
import type { ResourceSummary } from "../../models/resource";
import type { TimelineDay } from "../../models/timeline";
import type { AbsenceTimelineEditMode } from "../../services/absenceCalculations";
import type { CapacityResult } from "../../models/capacity";
import type { EventColorMode } from "../../features/team-admin/services/teamAdminApi";
import type { TeamColorStyle } from "../../styles/teamColorPalette";
import type { TimelineHolidayTone } from "./Timeline";
import { EventLayer } from "../events/EventLayer";
import { ResourceSummaryPanel } from "../resourceSummary/ResourceSummaryPanel";
import styles from "./Timeline.module.css";

interface TimelineRowProps {
  readonly days: readonly TimelineDay[];
  readonly events: readonly PlanningEvent[];
  readonly holidayTonesByDate: ReadonlyMap<string, TimelineHolidayTone>;
  readonly capacityResults: readonly CapacityResult[];
  readonly resource: ResourceSummary;
  readonly rowIndex: number;
  readonly eventColorMode: EventColorMode;
  readonly teamColorStyle?: TeamColorStyle;
  readonly t: (key: TranslationKey) => string;
  readonly onOpenEvent: (event: PlanningEvent) => void;
  readonly onOpenResource: (resource: ResourceSummary, targetRect?: DOMRect) => void;
  readonly onCreateAbsence: (resource: ResourceSummary, date: string) => void;
  readonly onTimelineEdit: (event: PlanningEvent, mode: AbsenceTimelineEditMode, halfDayDelta: number) => void;
}

export const TimelineRow = memo(function TimelineRow({
  days,
  events,
  holidayTonesByDate,
  capacityResults,
  resource,
  rowIndex,
  eventColorMode,
  teamColorStyle,
  t,
  onCreateAbsence,
  onOpenEvent,
  onOpenResource,
  onTimelineEdit
}: TimelineRowProps) {
  const capacityByDate = useMemo(() => new Map(capacityResults.map((capacity) => [capacity.date, capacity])), [capacityResults]);

  return (
    <>
      <ResourceSummaryPanel onOpen={onOpenResource} resource={resource} rowIndex={rowIndex} t={t} />
      {days.map((day, dayIndex) => (
        <button
          aria-label={`${t("absenceCreateTitle")} ${resource.displayName} ${day.key}, ${t("capacityAvailable")}: ${capacityByDate.get(day.key)?.availableCapacity ?? 0}`}
          className={`${styles.gridCell} ${getHolidayToneClass(holidayTonesByDate.get(day.key))} ${day.isWeekend ? styles.weekend : ""} ${day.isToday ? styles.today : ""}`}
          key={`${resource.id}-${day.key}`}
          onClick={() => onCreateAbsence(resource, day.key)}
          style={{ gridColumn: dayIndex + 2, gridRow: rowIndex }}
          type="button"
        >
        </button>
      ))}
      <EventLayer days={days} events={events} eventColorMode={eventColorMode} teamColorStyle={teamColorStyle} onTimelineEdit={onTimelineEdit} onOpen={onOpenEvent} rowIndex={rowIndex} t={t} />
    </>
  );
});

function getHolidayToneClass(tone: TimelineHolidayTone | undefined): string {
  if (tone === "publicHoliday1") {
    return styles.publicHolidayDay;
  }

  if (tone === "publicHoliday2") {
    return styles.publicHolidayDay2;
  }

  if (tone === "publicHoliday3") {
    return styles.publicHolidayDay3;
  }

  if (tone === "schoolHoliday1") {
    return styles.schoolHolidaySgDay;
  }

  if (tone === "schoolHoliday2") {
    return styles.schoolHolidayDubendorfDay;
  }

  if (tone === "schoolHoliday3") {
    return styles.schoolHoliday3Day;
  }

  return "";
}
