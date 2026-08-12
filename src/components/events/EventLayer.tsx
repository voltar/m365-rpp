import { memo, useMemo } from "react";
import type { TranslationKey } from "../../localization/translations";
import type { PlanningEvent } from "../../models/planningEvent";
import type { TimelineDay } from "../../models/timeline";
import type { AbsenceTimelineEditMode } from "../../services/absenceCalculations";
import type { EventColorMode } from "../../features/team-admin/services/teamAdminApi";
import type { TeamColorStyle } from "../../styles/teamColorPalette";
import { placeEventsForResource } from "./eventPlacement";
import { TimelineEvent } from "./TimelineEvent";

interface EventLayerProps {
  readonly days: readonly TimelineDay[];
  readonly events: readonly PlanningEvent[];
  readonly eventColorMode: EventColorMode;
  readonly teamColorStyle?: TeamColorStyle;
  readonly onTimelineEdit: (event: PlanningEvent, mode: AbsenceTimelineEditMode, halfDayDelta: number) => void;
  readonly onOpen: (event: PlanningEvent) => void;
  readonly rowIndex: number;
  readonly t: (key: TranslationKey) => string;
}

export const EventLayer = memo(function EventLayer({
  days,
  events,
  eventColorMode,
  teamColorStyle,
  onTimelineEdit,
  onOpen,
  rowIndex,
  t
}: EventLayerProps) {
  const placements = useMemo(() => placeEventsForResource(events, days), [events, days]);

  return (
    <>
      {placements.map((placement) => (
        <TimelineEvent
          event={placement.event}
          gridColumn={`${placement.startColumn} / span ${placement.span}`}
          gridRow={rowIndex}
          key={placement.event.id}
          lane={placement.lane}
          eventColorMode={eventColorMode}
          teamColorStyle={teamColorStyle}
          onTimelineEdit={onTimelineEdit}
          onOpen={onOpen}
          t={t}
        />
      ))}
    </>
  );
});
