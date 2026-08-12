import type { TimelineDay, TimelineMonth, TimelineWeek } from "../../models/timeline";
import type { TimelineHolidayTone } from "./Timeline";
import styles from "./Timeline.module.css";

interface TimelineHeaderProps {
  readonly months: readonly TimelineMonth[];
  readonly weeks: readonly TimelineWeek[];
  readonly days: readonly TimelineDay[];
  readonly holidayTonesByDate: ReadonlyMap<string, TimelineHolidayTone>;
  readonly employeeColumnLabel: string;
}

export function TimelineHeader({ months, weeks, days, holidayTonesByDate, employeeColumnLabel }: TimelineHeaderProps) {
  return (
    <>
      <div className={styles.corner}>{employeeColumnLabel}</div>
      {months.map((month) => (
        <div
          className={styles.monthCell}
          key={month.key}
          style={{ gridColumn: `${month.startColumn} / span ${month.span}` }}
        >
          {month.label}
        </div>
      ))}
      {weeks.map((week) => (
        <div
          className={styles.weekCell}
          key={week.key}
          style={{ gridColumn: `${week.startColumn} / span ${week.span}` }}
        >
          <span className={styles.weekLabel}>{week.label}</span>
          <span className={styles.weekInterval}>{week.dateInterval}</span>
        </div>
      ))}
      {days.map((day, index) => (
        <div
          className={`${styles.dayCell} ${getHolidayToneClass(holidayTonesByDate.get(day.key))} ${day.isWeekend ? styles.weekend : ""} ${day.isToday ? styles.today : ""}`}
          key={day.key}
          style={{ gridColumn: index + 2 }}
        >
          {day.dayOfMonth}
        </div>
      ))}
    </>
  );
}

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
