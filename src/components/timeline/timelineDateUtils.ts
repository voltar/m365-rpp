import type { TimelineDay, TimelineMonth, TimelineWeek } from "../../models/timeline";

const dayMs = 24 * 60 * 60 * 1000;

export function createTimelineDays(start: Date, monthCount: number): readonly TimelineDay[] {
  const end = new Date(start.getFullYear(), start.getMonth() + monthCount, 0);
  return createTimelineDaysUntil(start, end);
}

export function createTimelineDaysForDayCount(start: Date, dayCount: number): readonly TimelineDay[] {
  const normalizedDayCount = Math.max(1, dayCount);
  const end = new Date(startOfDay(start).getTime() + (normalizedDayCount - 1) * dayMs);
  return createTimelineDaysUntil(start, end);
}

function createTimelineDaysUntil(start: Date, end: Date): readonly TimelineDay[] {
  const today = startOfDay(new Date());
  const days: TimelineDay[] = [];

  for (let current = startOfDay(start); current <= end; current = new Date(current.getTime() + dayMs)) {
    days.push({
      date: current,
      key: toIsoDate(current),
      dayOfMonth: current.getDate(),
      isWeekend: current.getDay() === 0 || current.getDay() === 6,
      isToday: toIsoDate(current) === toIsoDate(today)
    });
  }

  return days;
}

export function createTimelineMonths(days: readonly TimelineDay[], locale: string): readonly TimelineMonth[] {
  const formatter = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
  const months: TimelineMonth[] = [];

  days.forEach((day, index) => {
    const key = `${day.date.getFullYear()}-${day.date.getMonth()}`;
    const current = months[months.length - 1];

    if (current?.key === key) {
      months[months.length - 1] = { ...current, span: current.span + 1 };
      return;
    }

    months.push({
      key,
      label: formatter.format(day.date),
      startColumn: index + 2,
      span: 1
    });
  });

  return months;
}

interface TimelineWeekDraft extends TimelineWeek {
  readonly startDate: Date;
}

export function createTimelineWeeks(
  days: readonly TimelineDay[],
  locale: string,
  calendarWeekPrefix: string
): readonly TimelineWeek[] {
  const weeks: TimelineWeekDraft[] = [];
  const dateFormatter = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" });

  days.forEach((day, index) => {
    const weekNumber = getWeekNumber(day.date);
    const weekKey = `${day.date.getFullYear()}-${weekNumber}`;
    const current = weeks[weeks.length - 1];

    if (current?.key === weekKey) {
      weeks[weeks.length - 1] = {
        ...current,
        dateInterval: formatWeekInterval(current.startDate, day.date, dateFormatter),
        span: current.span + 1
      };
      return;
    }

    weeks.push({
      key: weekKey,
      label: `${calendarWeekPrefix} ${weekNumber}`,
      dateInterval: formatWeekInterval(day.date, day.date, dateFormatter),
      startDate: day.date,
      startColumn: index + 2,
      span: 1
    });
  });

  return weeks;
}

export function getTimelineStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatWeekInterval(start: Date, end: Date, formatter: Intl.DateTimeFormat): string {
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function getWeekNumber(date: Date): number {
  const current = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  return Math.ceil(((current.getTime() - yearStart.getTime()) / dayMs + 1) / 7);
}
