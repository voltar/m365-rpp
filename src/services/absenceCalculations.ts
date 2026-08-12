import { getConfiguredAbsenceTypes } from "../data/absenceTypes";
import { publicHolidays } from "../data/publicHolidays";
import type { TranslationKey } from "../localization/translations";
import type { Absence, AbsenceDraft, AbsenceType, AbsenceValidationResult, DayHalf } from "../models/absence";
import type { PlanningEvent } from "../models/planningEvent";
import type { ResourceSummary } from "../models/resource";

export type AbsenceTimelineEditMode = "move" | "resizeStart" | "resizeEnd";

export interface AbsenceTimelineEditResult {
  readonly absence?: Absence;
  readonly validation: AbsenceValidationResult;
}

const halfDayValue: Record<DayHalf, number> = {
  morning: 0.5,
  afternoon: 0.5,
  fullDay: 1
};

const publicHolidayDates = new Set(
  publicHolidays
    .filter((holiday) => !holiday.location || holiday.location.startsWith("public-"))
    .map((holiday) => holiday.date)
);
const absenceTypeConfigByKey = new Map(getConfiguredAbsenceTypes().map((option) => [option.key, option]));

export function validateAbsenceDraft(draft: AbsenceDraft): AbsenceValidationResult {
  const errors: TranslationKey[] = [];

  if (!draft.employeeId || !draft.type || !draft.startDate || !draft.startHalf || !draft.endDate || !draft.endHalf) {
    errors.push("absenceValidationRequired");
  }

  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    errors.push("absenceValidationEndBeforeStart");
  }

  const duration = calculateAbsenceDuration(draft);

  if (duration <= 0) {
    errors.push("absenceValidationDuration");
  }

  return {
    duration,
    errors,
    isValid: errors.length === 0
  };
}

export function calculateAbsenceDuration(draft: Pick<AbsenceDraft, "startDate" | "startHalf" | "endDate" | "endHalf">): number {
  if (!draft.startDate || !draft.endDate || draft.endDate < draft.startDate) {
    return 0;
  }

  const dates = enumerateDates(draft.startDate, draft.endDate).filter(isWorkingDay);

  if (dates.length === 0) {
    return 0;
  }

  if (draft.startDate === draft.endDate) {
    return isWorkingDay(draft.startDate) ? singleDayDuration(draft.startHalf, draft.endHalf) : 0;
  }

  const middleDays = Math.max(0, dates.length - 2);
  const startDuration = isWorkingDay(draft.startDate) ? startDayDuration(draft.startHalf) : 0;
  const endDuration = isWorkingDay(draft.endDate) ? endDayDuration(draft.endHalf) : 0;

  return startDuration + middleDays + endDuration;
}

export function createAbsenceFromDraft(draft: AbsenceDraft): Absence {
  const now = new Date().toISOString();

  return {
    ...draft,
    id: `absence-${Date.now()}`,
    duration: calculateAbsenceDuration(draft),
    approvalStatus: "draft",
    created: now,
    modified: now
  };
}

export function updateAbsenceFromDraft(absence: Absence, draft: AbsenceDraft): Absence {
  return {
    ...absence,
    ...draft,
    duration: calculateAbsenceDuration(draft),
    approvalStatus: absence.approvalStatus,
    modified: new Date().toISOString()
  };
}

export function absenceToPlanningEvent(absence: Absence, typeLabel: string): PlanningEvent {
  const eventType = getAbsenceEventType(absence.type);

  return {
    id: `event-${absence.id}`,
    absenceId: absence.id,
    resourceId: absence.employeeId,
    type: eventType,
    title: absence.comment?.trim() || typeLabel,
    startDate: absence.startDate,
    startHalf: absence.startHalf,
    endDate: absence.endDate,
    endHalf: absence.endHalf,
    approvalStatus: absence.approvalStatus
  };
}

export function editAbsenceOnTimeline(
  absence: Absence,
  mode: AbsenceTimelineEditMode,
  halfDayDelta: number,
  visibleDateKeys: readonly string[]
): AbsenceTimelineEditResult {
  if (halfDayDelta === 0) {
    return { absence, validation: validateAbsenceDraft(absence) };
  }

  const currentStartSlot = getStartBoundarySlot(absence, visibleDateKeys);
  const currentEndSlot = getEndBoundarySlot(absence, visibleDateKeys);

  if (currentStartSlot === undefined || currentEndSlot === undefined) {
    return {
      validation: {
        duration: 0,
        errors: ["absenceValidationOutsideTimeline"],
        isValid: false
      }
    };
  }

  const nextStartSlot = mode === "move" || mode === "resizeStart" ? currentStartSlot + halfDayDelta : currentStartSlot;
  const nextEndSlot = mode === "move" || mode === "resizeEnd" ? currentEndSlot + halfDayDelta : currentEndSlot;
  const timelineEndSlot = visibleDateKeys.length * 2;

  if (nextStartSlot < 0 || nextEndSlot > timelineEndSlot) {
    return {
      validation: {
        duration: 0,
        errors: ["absenceValidationOutsideTimeline"],
        isValid: false
      }
    };
  }

  if (nextEndSlot <= nextStartSlot) {
    return {
      validation: {
        duration: 0,
        errors: ["absenceValidationDuration"],
        isValid: false
      }
    };
  }

  const start = slotToStart(nextStartSlot, visibleDateKeys);
  const end = slotToEnd(nextEndSlot, visibleDateKeys);

  if (!start || !end) {
    return {
      validation: {
        duration: 0,
        errors: ["absenceValidationOutsideTimeline"],
        isValid: false
      }
    };
  }

  const draft: AbsenceDraft = {
    employeeId: absence.employeeId,
    type: absence.type,
    startDate: start.date,
    startHalf: start.half,
    endDate: end.date,
    endHalf: end.half,
    substitute: absence.substitute,
    comment: absence.comment
  };
  const validation = validateAbsenceDraft(draft);

  if (!validation.isValid) {
    return { validation };
  }

  if (mode === "move" && validation.duration !== absence.duration) {
    return {
      validation: {
        duration: validation.duration,
        errors: ["absenceValidationMoveDuration"],
        isValid: false
      }
    };
  }

  return {
    absence: updateAbsenceFromDraft(absence, draft),
    validation
  };
}

export function calculateResourcesWithAbsences(
  resources: readonly ResourceSummary[],
  absences: readonly Absence[]
): readonly ResourceSummary[] {
  const relevantAbsenceDurationByEmployeeId = new Map<string, number>();

  absences.forEach((absence) => {
    if (absence.approvalStatus === "rejected" || !consumesVacationBalance(absence.type)) {
      return;
    }

    relevantAbsenceDurationByEmployeeId.set(
      absence.employeeId,
      (relevantAbsenceDurationByEmployeeId.get(absence.employeeId) ?? 0) + absence.duration
    );
  });

  return resources.map((resource) => {
    const bookedVacation = resource.vacation.booked + (relevantAbsenceDurationByEmployeeId.get(resource.id) ?? 0);

    return {
      ...resource,
      vacation: {
        ...resource.vacation,
        booked: bookedVacation,
        remaining: Math.max(0, resource.vacation.annualEntitlement - bookedVacation)
      }
    };
  });
}

export function getAbsenceEventType(type: AbsenceType): PlanningEvent["type"] {
  return absenceTypeConfigByKey.get(type)?.eventType ?? "otherAbsence";
}

function consumesVacationBalance(type: AbsenceType): boolean {
  return absenceTypeConfigByKey.get(type)?.consumesVacationBalance ?? type === "vacation";
}

function singleDayDuration(startHalf: DayHalf, endHalf: DayHalf): number {
  if (startHalf === "fullDay" || endHalf === "fullDay") {
    return 1;
  }

  if (startHalf === "morning" && endHalf === "afternoon") {
    return 1;
  }

  if (startHalf === endHalf) {
    return halfDayValue[startHalf];
  }

  return 0;
}

function startDayDuration(startHalf: DayHalf): number {
  return startHalf === "afternoon" ? 0.5 : 1;
}

function endDayDuration(endHalf: DayHalf): number {
  return endHalf === "morning" ? 0.5 : 1;
}

function enumerateDates(startDate: string, endDate: string): readonly string[] {
  const dates: string[] = [];
  const end = new Date(`${endDate}T00:00:00`);

  for (let current = new Date(`${startDate}T00:00:00`); current <= end; current.setDate(current.getDate() + 1)) {
    dates.push(toIsoDate(current));
  }

  return dates;
}

function isWorkingDay(dateKey: string): boolean {
  const date = new Date(`${dateKey}T00:00:00`);
  const day = date.getDay();

  return day !== 0 && day !== 6 && !publicHolidayDates.has(dateKey);
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getStartBoundarySlot(absence: Absence, visibleDateKeys: readonly string[]): number | undefined {
  const dayIndex = visibleDateKeys.indexOf(absence.startDate);

  if (dayIndex === -1) {
    return undefined;
  }

  return dayIndex * 2 + (absence.startHalf === "afternoon" ? 1 : 0);
}

function getEndBoundarySlot(absence: Absence, visibleDateKeys: readonly string[]): number | undefined {
  const dayIndex = visibleDateKeys.indexOf(absence.endDate);

  if (dayIndex === -1) {
    return undefined;
  }

  return dayIndex * 2 + (absence.endHalf === "morning" ? 1 : 2);
}

function slotToStart(slot: number, visibleDateKeys: readonly string[]): { readonly date: string; readonly half: DayHalf } | undefined {
  const date = visibleDateKeys[Math.floor(slot / 2)];

  if (!date) {
    return undefined;
  }

  return {
    date,
    half: slot % 2 === 0 ? "morning" : "afternoon"
  };
}

function slotToEnd(slot: number, visibleDateKeys: readonly string[]): { readonly date: string; readonly half: DayHalf } | undefined {
  const date = visibleDateKeys[Math.floor((slot - 1) / 2)];

  if (!date) {
    return undefined;
  }

  return {
    date,
    half: slot % 2 === 1 ? "morning" : "afternoon"
  };
}
