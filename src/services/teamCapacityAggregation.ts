import type { CapacityResult } from "../models/capacity";
import type { ResourceSummary } from "../models/resource";
import type { CapacityStatus, CapacityThresholds, TeamCapacitySummary, TeamCapacityWeek } from "../models/teamCapacity";
import type { Logger } from "../core/logging";

interface AggregateTeamCapacityInput {
  readonly resources: readonly ResourceSummary[];
  readonly capacityByEmployeeId: ReadonlyMap<string, readonly CapacityResult[]>;
  readonly locale: string;
  readonly calendarWeekPrefix: string;
  readonly thresholds: CapacityThresholds;
  readonly requiredStaffingByTeamName?: ReadonlyMap<string, number>;
  // FR-413.2: Team Admin teams without members still appear in the dashboard.
  readonly additionalTeamNames?: readonly string[];
  readonly logger?: Logger;
}

interface WeekBucket {
  readonly key: string;
  readonly label: string;
  readonly startDate: Date;
  readonly dates: Set<string>;
  readonly sortedDates: string[];
}

const dayMs = 24 * 60 * 60 * 1000;

export function aggregateTeamCapacity(input: AggregateTeamCapacityInput): readonly TeamCapacitySummary[] {
  try {
    const groupedResources = groupResourcesByTeam(input.resources, input.additionalTeamNames);
    const weekBuckets = createWeekBuckets(input.capacityByEmployeeId, input.locale, input.calendarWeekPrefix);
    const intervalFormatter = new Intl.DateTimeFormat(input.locale, { day: "2-digit", month: "2-digit" });

    return Array.from(groupedResources.entries())
      .map(([teamName, resources]) => {
        const requiredStaffing = input.requiredStaffingByTeamName?.get(teamName);

        return {
          teamId: normalizeTeamId(teamName),
          teamName,
          requiredStaffing,
          resources,
          weeks: weekBuckets.map((week) =>
            aggregateWeek(week, resources, input.capacityByEmployeeId, input.thresholds, intervalFormatter, requiredStaffing)
          )
        };
      })
      .sort((first, second) => first.teamName.localeCompare(second.teamName));
  } catch (error) {
    input.logger?.error(
      "Team capacity aggregation failed.",
      {
        source: "capacityDashboard",
        component: "teamCapacityAggregation",
        operation: "aggregateTeamCapacity"
      },
      error
    );

    return [];
  }
}

function aggregateWeek(
  week: WeekBucket,
  resources: readonly ResourceSummary[],
  capacityByEmployeeId: ReadonlyMap<string, readonly CapacityResult[]>,
  thresholds: CapacityThresholds,
  intervalFormatter: Intl.DateTimeFormat,
  requiredStaffing?: number
): TeamCapacityWeek {
  const results = resources.flatMap((resource) =>
    (capacityByEmployeeId.get(resource.id) ?? []).filter((capacity) => week.dates.has(capacity.date))
  );
  const nominalCapacity = round(results.reduce((sum, result) => sum + result.nominalCapacity, 0));
  const availableCapacity = round(results.reduce((sum, result) => sum + result.availableCapacity, 0));
  const absenceCapacity = round(results.reduce((sum, result) => sum + result.absenceCapacity, 0));
  // A team without planned capacity (no members) is neutral, not critical.
  const availabilityPercentage = nominalCapacity > 0 ? Math.round((availableCapacity / nominalCapacity) * 100) : 100;
  const minDailyAvailable = getMinDailyAvailable(week, results);
  const understaffed =
    requiredStaffing !== undefined && requiredStaffing > 0 && minDailyAvailable !== undefined && minDailyAvailable < requiredStaffing;
  const affectedResources = resources.filter((resource) =>
    (capacityByEmployeeId.get(resource.id) ?? []).some(
      (capacity) => week.dates.has(capacity.date) && capacity.absenceCapacity > 0
    )
  );

  return {
    key: week.key,
    label: week.label,
    dateInterval: formatWeekInterval(week.startDate, week.sortedDates[week.sortedDates.length - 1], intervalFormatter),
    nominalCapacity,
    availableCapacity,
    absenceCapacity,
    availabilityPercentage,
    minDailyAvailable,
    understaffed,
    status: understaffed ? "critical" : nominalCapacity === 0 ? "ok" : getCapacityStatus(availabilityPercentage, thresholds),
    affectedResources
  };
}

function getMinDailyAvailable(week: WeekBucket, results: readonly CapacityResult[]): number | undefined {
  const availableByDate = new Map<string, number>();

  results.forEach((result) => {
    if (!result.workingDay || result.publicHoliday) {
      return;
    }

    availableByDate.set(result.date, (availableByDate.get(result.date) ?? 0) + result.availableCapacity);
  });

  if (availableByDate.size === 0) {
    return undefined;
  }

  return round(Math.min(...availableByDate.values()));
}

function getCapacityStatus(availabilityPercentage: number, thresholds: CapacityThresholds): CapacityStatus {
  if (availabilityPercentage < thresholds.critical) {
    return "critical";
  }

  if (availabilityPercentage < thresholds.warning) {
    return "warning";
  }

  return "ok";
}

function createWeekBuckets(
  capacityByEmployeeId: ReadonlyMap<string, readonly CapacityResult[]>,
  locale: string,
  calendarWeekPrefix: string
): readonly WeekBucket[] {
  const dateKeys = Array.from(
    new Set(Array.from(capacityByEmployeeId.values()).flatMap((results) => results.map((result) => result.date)))
  ).sort();
  const buckets = new Map<string, WeekBucket>();

  dateKeys.forEach((dateKey) => {
    const date = new Date(`${dateKey}T00:00:00`);
    const weekNumber = getWeekNumber(date);
    const key = `${date.getFullYear()}-${weekNumber}`;
    const current = buckets.get(key);

    if (current) {
      current.dates.add(dateKey);
      current.sortedDates.push(dateKey);
      return;
    }

    buckets.set(key, {
      key,
      label: `${calendarWeekPrefix} ${weekNumber}`,
      startDate: date,
      dates: new Set([dateKey]),
      sortedDates: [dateKey]
    });
  });

  return Array.from(buckets.values());
}

function groupResourcesByTeam(
  resources: readonly ResourceSummary[],
  additionalTeamNames?: readonly string[]
): ReadonlyMap<string, readonly ResourceSummary[]> {
  const groups = new Map<string, ResourceSummary[]>();

  additionalTeamNames?.forEach((teamName) => {
    if (teamName) {
      groups.set(teamName, []);
    }
  });

  resources.forEach((resource) => {
    const current = groups.get(resource.primaryTeam) ?? [];
    current.push(resource);
    groups.set(resource.primaryTeam, current);
  });

  return groups;
}

function formatWeekInterval(start: Date, endDateKey: string, formatter: Intl.DateTimeFormat): string {
  const end = new Date(`${endDateKey}T00:00:00`);

  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function getWeekNumber(date: Date): number {
  const current = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));

  return Math.ceil(((current.getTime() - yearStart.getTime()) / dayMs + 1) / 7);
}

function normalizeTeamId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
