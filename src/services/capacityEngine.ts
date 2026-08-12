import type { Absence, DayHalf } from "../models/absence";
import type { CapacityCalculationInput, CapacityCalculationResult, CapacityResult } from "../models/capacity";
import type { ResourceSummary } from "../models/resource";
import type { Logger } from "../core/logging";

const defaultWorkingDays = [1, 2, 3, 4, 5] as const;

export function calculateCapacity(input: CapacityCalculationInput, logger?: Logger): CapacityCalculationResult {
  try {
    const holidays = new Set(
      input.publicHolidays
        .filter((holiday) => !holiday.location || holiday.location.startsWith("public-"))
        .map((holiday) => holiday.date)
    );
    const dayOfWeekByDate = new Map(input.dateKeys.map((dateKey) => [dateKey, new Date(`${dateKey}T00:00:00`).getDay()]));
    const absencesByEmployee = groupAbsencesByEmployee(input.absences);
    const results = input.resources.flatMap((resource) =>
      input.dateKeys.map((dateKey) =>
        calculateDailyCapacity(
          resource,
          dateKey,
          absencesByEmployee.get(resource.id) ?? [],
          holidays,
          dayOfWeekByDate.get(dateKey)
        )
      )
    );

    return {
      results,
      byEmployeeId: groupResultsByEmployee(results)
    };
  } catch (error) {
    logger?.error(
      "Capacity calculation failed.",
      {
        source: "capacityEngine",
        component: "capacityEngine",
        operation: "calculateCapacity"
      },
      error
    );

    return {
      results: [],
      byEmployeeId: new Map()
    };
  }
}

export function calculateDailyCapacity(
  resource: ResourceSummary,
  dateKey: string,
  absences: readonly Absence[],
  publicHolidayDates: ReadonlySet<string>,
  dayOfWeek?: number
): CapacityResult {
  const employmentRate = normalizeEmploymentRate(resource.employmentRate);
  const publicHoliday = publicHolidayDates.has(dateKey);
  const workingDay = isConfiguredWorkingDay(resource, dateKey, dayOfWeek) && !publicHoliday;
  const nominalCapacity = workingDay ? employmentRate : 0;
  const absenceFraction = workingDay ? calculateAbsenceFraction(dateKey, absences) : 0;
  const absenceCapacity = roundCapacity(Math.min(nominalCapacity, nominalCapacity * absenceFraction));
  const availableCapacity = roundCapacity(Math.max(0, nominalCapacity - absenceCapacity));

  return {
    employeeId: resource.id,
    date: dateKey,
    nominalCapacity,
    absenceCapacity,
    availableCapacity,
    workingDay,
    publicHoliday
  };
}

function calculateAbsenceFraction(dateKey: string, absences: readonly Absence[]): number {
  if (absences.length === 0) {
    return 0;
  }

  const absenceFraction = absences.reduce((sum, absence) => {
    if (absence.startDate > dateKey || absence.endDate < dateKey) {
      return sum;
    }

    return sum + getAbsenceFractionForDate(dateKey, absence);
  }, 0);

  return Math.min(1, absenceFraction);
}

function getAbsenceFractionForDate(dateKey: string, absence: Absence): number {
  if (absence.startDate === absence.endDate) {
    return getSingleDayFraction(absence.startHalf, absence.endHalf);
  }

  if (dateKey === absence.startDate) {
    return absence.startHalf === "afternoon" ? 0.5 : 1;
  }

  if (dateKey === absence.endDate) {
    return absence.endHalf === "morning" ? 0.5 : 1;
  }

  return 1;
}

function getSingleDayFraction(startHalf: DayHalf, endHalf: DayHalf): number {
  if (startHalf === "fullDay" || endHalf === "fullDay") {
    return 1;
  }

  if (startHalf === endHalf) {
    return 0.5;
  }

  return startHalf === "morning" && endHalf === "afternoon" ? 1 : 0;
}

function groupAbsencesByEmployee(absences: readonly Absence[]): ReadonlyMap<string, readonly Absence[]> {
  const grouped = new Map<string, Absence[]>();

  absences.filter((absence) => absence.approvalStatus !== "rejected").forEach((absence) => {
    const current = grouped.get(absence.employeeId) ?? [];
    current.push(absence);
    grouped.set(absence.employeeId, current);
  });

  return grouped;
}

function groupResultsByEmployee(results: readonly CapacityResult[]): ReadonlyMap<string, readonly CapacityResult[]> {
  const grouped = new Map<string, CapacityResult[]>();

  results.forEach((result) => {
    const current = grouped.get(result.employeeId) ?? [];
    current.push(result);
    grouped.set(result.employeeId, current);
  });

  return grouped;
}

function isConfiguredWorkingDay(resource: ResourceSummary, dateKey: string, dayOfWeek?: number): boolean {
  const resolvedDayOfWeek = dayOfWeek ?? new Date(`${dateKey}T00:00:00`).getDay();
  const workingDays = resource.workingDays ?? defaultWorkingDays;

  return workingDays.includes(resolvedDayOfWeek);
}

function normalizeEmploymentRate(employmentRate: number | undefined): number {
  if (employmentRate === undefined) {
    return 1;
  }

  return roundCapacity(Math.max(0, Math.min(1, employmentRate)));
}

function roundCapacity(value: number): number {
  return Math.round(value * 100) / 100;
}
