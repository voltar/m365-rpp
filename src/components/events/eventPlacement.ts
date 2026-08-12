import type { PlanningEvent } from "../../models/planningEvent";
import type { TimelineDay } from "../../models/timeline";

export interface PlacedPlanningEvent {
  readonly event: PlanningEvent;
  readonly startColumn: number;
  readonly span: number;
  readonly lane: number;
}

export function placeEventsForResource(
  events: readonly PlanningEvent[],
  days: readonly TimelineDay[]
): readonly PlacedPlanningEvent[] {
  const dayIndexByKey = new Map(days.map((day, index) => [day.key, index]));
  const laneEndColumns: number[] = [];

  return events
    .map((event) => {
      const startIndex = dayIndexByKey.get(event.startDate) ?? 0;
      const endIndex = dayIndexByKey.get(event.endDate) ?? days.length - 1;
      const normalizedStart = Math.max(0, Math.min(startIndex, days.length - 1));
      const normalizedEnd = Math.max(normalizedStart, Math.min(endIndex, days.length - 1));

      return {
        event,
        startColumn: normalizedStart + 2,
        span: normalizedEnd - normalizedStart + 1
      };
    })
    .sort((first, second) => first.startColumn - second.startColumn || second.span - first.span)
    .map((placement) => {
      const lane = laneEndColumns.findIndex((endColumn) => endColumn < placement.startColumn);
      const resolvedLane = lane === -1 ? laneEndColumns.length : lane;
      laneEndColumns[resolvedLane] = placement.startColumn + placement.span - 1;

      return {
        ...placement,
        lane: resolvedLane
      };
    });
}
