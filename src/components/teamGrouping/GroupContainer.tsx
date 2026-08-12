import { useMemo } from "react";
import type { TranslationKey } from "../../localization/translations";
import type { PlanningEvent } from "../../models/planningEvent";
import type { ResourceSummary } from "../../models/resource";
import type { CapacityResult } from "../../models/capacity";
import type { TimelineDay } from "../../models/timeline";
import type { TeamResourceGroup } from "../../models/teamGrouping";
import type { AbsenceTimelineEditMode } from "../../services/absenceCalculations";
import type { EventColorMode } from "../../features/team-admin/services/teamAdminApi";
import type { TeamColorStyle } from "../../styles/teamColorPalette";
import type { TimelineHolidayTone } from "../timeline/Timeline";
import { TeamGroup } from "./TeamGroup";

interface GroupContainerProps {
  readonly days: readonly TimelineDay[];
  readonly events: readonly PlanningEvent[];
  readonly capacityByEmployeeId: ReadonlyMap<string, readonly CapacityResult[]>;
  readonly holidayTonesByDate: ReadonlyMap<string, TimelineHolidayTone>;
  readonly groups: readonly TeamResourceGroup[];
  readonly collapsedGroupIds: ReadonlySet<string>;
  readonly eventColorMode: EventColorMode;
  readonly teamColorByResourceId: ReadonlyMap<string, TeamColorStyle>;
  readonly t: (key: TranslationKey) => string;
  readonly onToggleGroup: (groupId: string) => void;
  readonly onCreateAbsence: (resource: ResourceSummary, date: string) => void;
  readonly onTimelineEdit: (event: PlanningEvent, mode: AbsenceTimelineEditMode, halfDayDelta: number) => void;
  readonly onOpenEvent: (event: PlanningEvent) => void;
  readonly onOpenResource: (resource: ResourceSummary, targetRect?: DOMRect) => void;
}

export function GroupContainer({
  days,
  events,
  capacityByEmployeeId,
  holidayTonesByDate,
  groups,
  collapsedGroupIds,
  eventColorMode,
  teamColorByResourceId,
  t,
  onCreateAbsence,
  onTimelineEdit,
  onToggleGroup,
  onOpenEvent,
  onOpenResource
}: GroupContainerProps) {
  const eventsByResourceId = useMemo(() => {
    const grouped = new Map<string, PlanningEvent[]>();

    events.forEach((event) => {
      const current = grouped.get(event.resourceId);

      if (current) {
        current.push(event);
        return;
      }

      grouped.set(event.resourceId, [event]);
    });

    return grouped;
  }, [events]);

  let rowIndex = 4;

  return (
    <>
      {groups.map((group) => {
        const isExpanded = !collapsedGroupIds.has(group.id);
        const currentRowIndex = rowIndex;
        rowIndex += isExpanded ? group.resources.length + 1 : 1;

        return (
          <TeamGroup
            capacityByEmployeeId={capacityByEmployeeId}
            days={days}
            eventsByResourceId={eventsByResourceId}
            group={group}
            holidayTonesByDate={holidayTonesByDate}
            isExpanded={isExpanded}
            eventColorMode={eventColorMode}
            teamColorByResourceId={teamColorByResourceId}
            key={group.id}
            onCreateAbsence={onCreateAbsence}
            onTimelineEdit={onTimelineEdit}
            onOpenEvent={onOpenEvent}
            onOpenResource={onOpenResource}
            onToggle={onToggleGroup}
            rowIndex={currentRowIndex}
            t={t}
          />
        );
      })}
    </>
  );
}
