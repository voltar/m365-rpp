import type { TranslationKey } from "../localization/translations";
import type { PlanningEventType } from "./planningEvent";

export type BuiltInAbsenceType =
  | "vacation"
  | "compensation"
  | "education"
  | "training"
  | "military"
  | "unpaidLeave"
  | "otherAbsence";

export type AbsenceType = BuiltInAbsenceType | (string & {});

export type DayHalf = "morning" | "afternoon" | "fullDay";

export type AbsenceApprovalStatus = "draft" | "pendingApproval" | "approved" | "rejected";

export interface AbsenceTypeOption {
  readonly key: AbsenceType;
  readonly labelKey?: TranslationKey;
  readonly label?: string;
  readonly eventType: PlanningEventType;
  readonly consumesVacationBalance: boolean;
}

export interface Absence {
  readonly id: string;
  readonly employeeId: string;
  readonly type: AbsenceType;
  readonly startDate: string;
  readonly startHalf: DayHalf;
  readonly endDate: string;
  readonly endHalf: DayHalf;
  readonly duration: number;
  readonly substitute?: string;
  readonly comment?: string;
  readonly approvalStatus: AbsenceApprovalStatus;
  // EO-410: links the absence to its vacation request so the server-side approval
  // decision updates this absence instead of creating a duplicate.
  readonly vacationRequestId?: string;
  readonly created: string;
  readonly modified: string;
}

export interface AbsenceDraft {
  readonly employeeId: string;
  readonly type: AbsenceType;
  readonly startDate: string;
  readonly startHalf: DayHalf;
  readonly endDate: string;
  readonly endHalf: DayHalf;
  readonly substitute?: string;
  readonly comment?: string;
}

export interface AbsenceValidationResult {
  readonly isValid: boolean;
  readonly duration: number;
  readonly errors: readonly TranslationKey[];
}
