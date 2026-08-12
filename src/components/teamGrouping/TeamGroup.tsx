import { memo, useCallback } from "react";
import type { TranslationKey } from "../../localization/translations";
import type { PlanningEvent } from "../../models/planningEvent";
import type { ResourceSummary } from "../../models/resource";
import type { TimelineDay } from "../../models/timeline";
import type { AbsenceTimelineEditMode } from "../../services/absenceCalculations";
import type { CapacityResult } from "../../models/capacity";
import type { TeamResourceGroup } from "../../models/teamGrouping";
import type { EventColorMode } from "../../features/team-admin/services/teamAdminApi";
import type { TeamColorStyle } from "../../styles/teamColorPalette";
import type { TimelineHolidayTone } from "../timeline/Timeline";
import { TimelineRow } from "../timeline/TimelineRow";
import { TeamHeader } from "./TeamHeader";

interface TeamGroupProps {
  readonly days: readonly TimelineDay[];
  readonly eventsByResourceId: ReadonlyMap<string, readonly PlanningEvent[]>;
  readonly capacityByEmployeeId: ReadonlyMap<string, readonly CapacityResult[]>;
  readonly holidayTonesByDate: ReadonlyMap<string, TimelineHolidayTone>;
  readonly group: TeamResourceGroup;
  readonly isExpanded: boolean;
  readonly rowIndex: number;
  readonly eventColorMode: EventColorMode;
  readonly teamColorByResourceId: ReadonlyMap<string, TeamColorStyle>;
  readonly t: (key: TranslationKey) => string;
  readonly onToggle: (groupId: string) => void;
  readonly onCreateAbsence: (resource: ResourceSummary, date: string) => void;
  readonly onTimelineEdit: (event: PlanningEvent, mode: AbsenceTimelineEditMode, halfDayDelta: number) => void;
  readonly onOpenEvent: (event: PlanningEvent) => void;
  readonly onOpenResource: (resource: ResourceSummary, targetRect?: DOMRect) => void;
}

export const TeamGroup = memo(function TeamGroup({
  days,
  eventsByResourceId,
  capacityByEmployeeId,
  holidayTonesByDate,
  group,
  isExpanded,
  rowIndex,
  eventColorMode,
  teamColorByResourceId,
  t,
  onCreateAbsence,
  onTimelineEdit,
  onToggle,
  onOpenEvent,
  onOpenResource
}: TeamGroupProps) {
  const headerTeamColorStyle = group.resources[0] ? teamColorByResourceId.get(group.resources[0].id) : undefined;
  const handleToggle = useCallback(() => onToggle(group.id), [group.id, onToggle]);

  return (
    <>
      <TeamHeader
        group={group}
        isExpanded={isExpanded}
        onToggle={handleToggle}
        resourceCountLabel={`${group.resources.length} ${t("teamGroupingResourceCountCompact")}`}
        rowIndex={rowIndex}
        teamColorStyle={headerTeamColorStyle}
        toggleLabel={isExpanded ? t("teamGroupingCollapse") : t("teamGroupingExpand")}
      />
      {isExpanded
        ? group.resources.map((resource, index) => (
            <TimelineRow
              capacityResults={capacityByEmployeeId.get(resource.id) ?? []}
              days={days}
              events={eventsByResourceId.get(resource.id) ?? []}
              holidayTonesByDate={holidayTonesByDate}
              eventColorMode={eventColorMode}
              teamColorStyle={teamColorByResourceId.get(resource.id)}
              key={resource.id}
              onCreateAbsence={onCreateAbsence}
              onTimelineEdit={onTimelineEdit}
              onOpenEvent={onOpenEvent}
              onOpenResource={onOpenResource}
              resource={resource}
              rowIndex={rowIndex + index + 1}
              t={t}
            />
          ))
        : null}
    </>
  );
});
