import { useMemo } from "react";
import type { TranslationKey } from "../../localization/translations";
import type { PlanningEvent } from "../../models/planningEvent";
import type { ResourceSummary } from "../../models/resource";
import type { EventColorMode } from "../../features/team-admin/services/teamAdminApi";
import type { TeamColorStyle } from "../../styles/teamColorPalette";
import type { TimelineHolidayTone } from "./Timeline";
import styles from "./TimelineCalendar.module.css";

interface TimelineCalendarProps {
  readonly year: number;
  readonly month: number; // 0-based (0 = January)
  readonly events: readonly PlanningEvent[];
  readonly locale: string;
  readonly resources: readonly ResourceSummary[];
  readonly holidayTonesByDate: ReadonlyMap<string, TimelineHolidayTone>;
  readonly eventColorMode: EventColorMode;
  readonly teamColorByResourceId: ReadonlyMap<string, TeamColorStyle>;
  readonly onOpenEvent: (event: PlanningEvent) => void;
  readonly t: (key: TranslationKey) => string;
}

interface CalendarDay {
  readonly date: Date;
  readonly key: string;
  readonly dayOfMonth: number;
  readonly isCurrentMonth: boolean;
  readonly isToday: boolean;
  readonly weekNumber: number;
}

interface CalendarWeek {
  readonly weekNumber: number;
  readonly days: readonly CalendarDay[];
}

// Continuous bars per week row, like Outlook: each event occupies one lane
// across the columns it spans; days with more events show a "+n" indicator.
interface WeekBarPlacement {
  readonly event: PlanningEvent;
  readonly startColumn: number; // 1-based day column within the week
  readonly span: number;
  readonly lane: number;
  readonly isStart: boolean; // true start of the event (not clamped to the week)
  readonly isEnd: boolean;
}

interface WeekLayout {
  readonly bars: readonly WeekBarPlacement[];
  readonly overflowByColumn: readonly number[];
}

const MAX_LANES = 3;

export function TimelineCalendar({
  year,
  month,
  events,
  locale,
  resources,
  holidayTonesByDate,
  eventColorMode,
  teamColorByResourceId,
  onOpenEvent,
  t
}: TimelineCalendarProps) {
  const weeks = useMemo(() => buildCalendarWeeks(year, month), [year, month]);

  // Stable order (start date, then id) keeps a bar in the same lane across weeks.
  const orderedEvents = useMemo(
    () => [...events].sort(
      (first, second) => first.startDate.localeCompare(second.startDate) || first.id.localeCompare(second.id)
    ),
    [events]
  );

  const weekLayouts = useMemo(
    () => weeks.map((week) => layoutWeekBars(week, orderedEvents)),
    [orderedEvents, weeks]
  );

  const resourceById = useMemo(() => {
    return new Map(resources.map((resource) => [resource.id, resource]));
  }, [resources]);

  // Monday-first weekday headers in the host language (2024-01-01 is a Monday).
  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: "long" });

    return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(2024, 0, 1 + index)));
  }, [locale]);

  const boundaryDayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }),
    [locale]
  );

  return (
    <div className={styles.calendar}>
      <div className={styles.headerRow}>
        <div className={styles.kwHeader}>{t("timelineCalendarWeekPrefix")}</div>
        {weekdayLabels.map((label) => (
          <div key={label} className={styles.dayHeader}>{label}</div>
        ))}
      </div>
      <div className={styles.weeks}>
        {weeks.map((week, weekIndex) => {
          const layout = weekLayouts[weekIndex] ?? { bars: [], overflowByColumn: [] };

          return (
            <div key={week.weekNumber} className={styles.weekRow}>
              <div className={styles.kwCell}>{week.weekNumber}</div>
              {week.days.map((day, dayIndex) => {
                const holidayTone = holidayTonesByDate.get(day.key);
                // Like Teams/Outlook, month boundaries carry the month name.
                const showMonthName = day.dayOfMonth === 1 || (weekIndex === 0 && dayIndex === 0);

                return (
                  <div
                    key={day.key}
                    className={classNames(
                      styles.dayCell,
                      !day.isCurrentMonth && styles.outOfMonth,
                      day.isToday && styles.today,
                      holidayTone && styles[holidayToneClassByTone[holidayTone]]
                    )}
                  >
                    <span className={styles.dayNumber}>
                      {showMonthName ? boundaryDayFormatter.format(day.date) : day.dayOfMonth}
                    </span>
                  </div>
                );
              })}
              <div className={styles.weekOverlay}>
                {layout.bars.map((bar) => {
                  const resource = resourceById.get(bar.event.resourceId);
                  const label = resource ? `${resource.displayName} · ${bar.event.title}` : bar.event.title;
                  // EO-423: in byTeam mode, use team color; otherwise use event type class.
                  const teamColor = eventColorMode === "byTeam" ? teamColorByResourceId.get(bar.event.resourceId) : undefined;
                  const eventTypeClass = teamColor ? "" : styles[eventTypeClassByType[bar.event.type ?? ""] ?? ""];
                  const colorStyle = teamColor
                    ? { background: teamColor.background, borderColor: teamColor.border, color: teamColor.text }
                    : undefined;

                  return (
                    <button
                      key={bar.event.id}
                      type="button"
                      className={classNames(
                        styles.eventBar,
                        eventTypeClass,
                        bar.event.approvalStatus && styles[approvalClassByStatus[bar.event.approvalStatus] ?? ""],
                        !bar.isStart && styles.barClampedStart,
                        !bar.isEnd && styles.barClampedEnd
                      )}
                      style={{ gridColumn: `${bar.startColumn} / span ${bar.span}`, gridRow: bar.lane + 1, ...colorStyle }}
                      onClick={(clickEvent) => { clickEvent.stopPropagation(); onOpenEvent(bar.event); }}
                      title={label}
                    >
                      <span className={styles.barLabel}>{label}</span>
                    </button>
                  );
                })}
                {layout.overflowByColumn.map((count, columnIndex) =>
                  count > 0 ? (
                    <span
                      key={week.days[columnIndex]?.key ?? columnIndex}
                      className={styles.overflow}
                      style={{ gridColumn: `${columnIndex + 1} / span 1`, gridRow: MAX_LANES + 1 }}
                    >
                      {t("timelineCalendarOverflow").replace("{count}", String(count))}
                    </span>
                  ) : null
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function layoutWeekBars(week: CalendarWeek, orderedEvents: readonly PlanningEvent[]): WeekLayout {
  const weekStartKey = week.days[0]?.key ?? "";
  const weekEndKey = week.days[6]?.key ?? "";
  const bars: WeekBarPlacement[] = [];
  const overflowByColumn = Array.from({ length: 7 }, () => 0);
  // Per lane: the last occupied column, so overlapping events stack downwards.
  const laneEndColumns: number[] = [];

  orderedEvents.forEach((event) => {
    // ISO date keys compare correctly as strings.
    if (event.startDate > weekEndKey || event.endDate < weekStartKey) {
      return;
    }

    const clampedStart = event.startDate > weekStartKey ? event.startDate : weekStartKey;
    const clampedEnd = event.endDate < weekEndKey ? event.endDate : weekEndKey;
    const startColumn = week.days.findIndex((day) => day.key === clampedStart) + 1;
    const endColumn = week.days.findIndex((day) => day.key === clampedEnd) + 1;

    if (startColumn === 0 || endColumn === 0) {
      return;
    }

    let lane = laneEndColumns.findIndex((endedAt) => endedAt < startColumn);

    if (lane === -1) {
      lane = laneEndColumns.length;
      laneEndColumns.push(0);
    }

    laneEndColumns[lane] = endColumn;

    if (lane < MAX_LANES) {
      bars.push({
        event,
        startColumn,
        span: endColumn - startColumn + 1,
        lane,
        isStart: event.startDate === clampedStart,
        isEnd: event.endDate === clampedEnd
      });
    } else {
      for (let column = startColumn; column <= endColumn; column += 1) {
        overflowByColumn[column - 1] = (overflowByColumn[column - 1] ?? 0) + 1;
      }
    }
  });

  return { bars, overflowByColumn };
}

function classNames(...values: readonly (string | false | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}

function buildCalendarWeeks(year: number, month: number): readonly CalendarWeek[] {
  const todayKey = toDateKey(new Date());
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Start from the Monday of the week containing the 1st
  const startDate = new Date(firstDay);
  const startDayOfWeek = startDate.getDay() || 7; // Monday=1, Sunday=7
  startDate.setDate(startDate.getDate() - (startDayOfWeek - 1));

  // End on the Sunday of the week containing the last day
  const endDate = new Date(lastDay);
  const endDayOfWeek = endDate.getDay() || 7;
  endDate.setDate(endDate.getDate() + (7 - endDayOfWeek));

  const weeks: CalendarWeek[] = [];
  let currentWeek: CalendarDay[] = [];

  for (let cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
    const date = new Date(cursor);

    currentWeek.push({
      date,
      key: toDateKey(date),
      dayOfMonth: date.getDate(),
      isCurrentMonth: date.getMonth() === month,
      isToday: toDateKey(date) === todayKey,
      weekNumber: getISOWeekNumber(date)
    });

    if (currentWeek.length === 7) {
      weeks.push({ weekNumber: currentWeek[0]!.weekNumber, days: [...currentWeek] });
      currentWeek = [];
    }
  }

  return weeks;
}

function getISOWeekNumber(date: Date): number {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));

  return Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

const holidayToneClassByTone: Record<string, string> = {
  publicHoliday1: "holidayPublic",
  publicHoliday2: "holidayPublic2",
  publicHoliday3: "holidayPublic3",
  schoolHoliday1: "holidaySg",
  schoolHoliday2: "holidayDubendorf",
  schoolHoliday3: "holidaySchool3"
};

const eventTypeClassByType: Record<string, string> = {
  vacation: "eventVacation",
  compensation: "eventCompensation",
  education: "eventEducation",
  homeOffice: "eventHomeOffice",
  training: "eventTraining",
  military: "eventMilitary",
  unpaidLeave: "eventUnpaidLeave",
  otherAbsence: "eventOtherAbsence",
  project: "eventProject",
  maintenance: "eventMaintenance",
  onCall: "eventOnCall",
  standby: "eventStandby"
};

const approvalClassByStatus: Record<string, string> = {
  draft: "approvalDraft",
  pendingApproval: "approvalPending",
  approved: "",
  rejected: "approvalRejected"
};
