import { memo, useMemo } from "react";
import type { TranslationKey } from "../../localization/translations";
import type { PlanningEvent } from "../../models/planningEvent";
import type { ResourceSummary } from "../../models/resource";
import type { TeamResourceGroup } from "../../models/teamGrouping";
import type { TimelineDay, TimelineMonth, TimelineWeek } from "../../models/timeline";
import type { AbsenceTimelineEditMode } from "../../services/absenceCalculations";
import type { CapacityResult } from "../../models/capacity";
import type { EventColorMode } from "../../features/team-admin/services/teamAdminApi";
import type { TeamColorStyle } from "../../styles/teamColorPalette";
import type { TimelineHolidayTone } from "./Timeline";
import { GroupContainer } from "../teamGrouping/GroupContainer";
import { TimelineHeader } from "./TimelineHeader";
import styles from "./Timeline.module.css";

interface TimelineGridProps {
  readonly days: readonly TimelineDay[];
  readonly months: readonly TimelineMonth[];
  readonly weeks: readonly TimelineWeek[];
  readonly groups: readonly TeamResourceGroup[];
  readonly holidayTonesByDate: ReadonlyMap<string, TimelineHolidayTone>;
  readonly capacityByEmployeeId: ReadonlyMap<string, readonly CapacityResult[]>;
  readonly events: readonly PlanningEvent[];
  readonly collapsedGroupIds: ReadonlySet<string>;
  readonly employeeColumnLabel: string;
  readonly eventColorMode: EventColorMode;
  readonly teamColorByResourceId: ReadonlyMap<string, TeamColorStyle>;
  readonly onCreateAbsence: (resource: ResourceSummary, date: string) => void;
  readonly onTimelineEdit: (event: PlanningEvent, mode: AbsenceTimelineEditMode, halfDayDelta: number) => void;
  readonly onOpenEvent: (event: PlanningEvent) => void;
  readonly onOpenResource: (resource: ResourceSummary, targetRect?: DOMRect) => void;
  readonly onToggleGroup: (groupId: string) => void;
  readonly t: (key: TranslationKey) => string;
}

export const TimelineGrid = memo(function TimelineGrid({
  days,
  months,
  weeks,
  groups,
  holidayTonesByDate,
  capacityByEmployeeId,
  events,
  collapsedGroupIds,
  employeeColumnLabel,
  eventColorMode,
  teamColorByResourceId,
  onCreateAbsence,
  onTimelineEdit,
  onOpenEvent,
  onOpenResource,
  onToggleGroup,
  t
}: TimelineGridProps) {
  const visibleResourceCount = useMemo(
    () => new Set(
      groups
        .filter((group) => !collapsedGroupIds.has(group.id))
        .flatMap((group) => group.resources.map((resource) => resource.id))
    ).size,
    [groups, collapsedGroupIds]
  );
  const footerStartRow = useMemo(
    () => 4 + groups.reduce((count, group) => count + (collapsedGroupIds.has(group.id) ? 1 : group.resources.length + 1), 0),
    [groups, collapsedGroupIds]
  );
  const minimumStaffing = Math.max(1, Math.floor(visibleResourceCount * 0.74));
  const availableByDate = useMemo(() => {
    const available = new Map<string, number>();

    capacityByEmployeeId.forEach((results) => {
      results.forEach((result) => {
        available.set(result.date, (available.get(result.date) ?? 0) + result.availableCapacity);
      });
    });

    return available;
  }, [capacityByEmployeeId]);

  return (
    <div
      className={styles.grid}
      style={{
        gridTemplateColumns: `var(--timeline-resource-column) repeat(${days.length}, var(--timeline-day-column))`
      }}
    >
      <TimelineHeader days={days} months={months} weeks={weeks} employeeColumnLabel={employeeColumnLabel} holidayTonesByDate={holidayTonesByDate} />
      <GroupContainer
        collapsedGroupIds={collapsedGroupIds}
        days={days}
        events={events}
        groups={groups}
        holidayTonesByDate={holidayTonesByDate}
        capacityByEmployeeId={capacityByEmployeeId}
        eventColorMode={eventColorMode}
        teamColorByResourceId={teamColorByResourceId}
        onCreateAbsence={onCreateAbsence}
        onTimelineEdit={onTimelineEdit}
        onOpenEvent={onOpenEvent}
        onOpenResource={onOpenResource}
        onToggleGroup={onToggleGroup}
        t={t}
      />
      <div className={styles.summaryLabel} style={{ gridColumn: 1, gridRow: footerStartRow }}>
        {t("timelineAvailablePeople")}
      </div>
      <div className={styles.summaryLabel} style={{ gridColumn: 1, gridRow: footerStartRow + 1 }}>
        {t("timelineMinimumStaffing")}
      </div>
      <div className={styles.summaryLabel} style={{ gridColumn: 1, gridRow: footerStartRow + 2 }}>
        {t("teamCapacityStatus")}
      </div>
      {weeks.map((week) => {
        let weekdayCount = 0;
        let availableSum = 0;

        days
          .slice(week.startColumn - 2, week.startColumn - 2 + week.span)
          .forEach((day) => {
            if (day.isWeekend) {
              return;
            }

            weekdayCount += 1;
            availableSum += availableByDate.get(day.key) ?? 0;
          });

        const averageAvailable = Math.round(
          availableSum / Math.max(1, weekdayCount)
        );
        const statusClass =
          averageAvailable < minimumStaffing
            ? styles.statusCritical
            : averageAvailable <= minimumStaffing + 1
              ? styles.statusWarning
              : styles.statusOk;

        return (
          <div className={styles.weekSummary} key={week.key} style={{ gridColumn: `${week.startColumn} / span ${week.span}`, gridRow: `${footerStartRow} / span 3` }}>
            <span>{averageAvailable}</span>
            <span>{minimumStaffing}</span>
            <strong className={statusClass} aria-label={t("teamCapacityStatus")} />
          </div>
        );
      })}
    </div>
  );
});
