export type PlanningEventType =
  | "vacation"
  | "compensation"
  | "education"
  | "training"
  | "military"
  | "unpaidLeave"
  | "otherAbsence"
  | "homeOffice"
  | "project"
  | "maintenance"
  | "onCall"
  | "standby";

export interface PlanningEvent {
  readonly id: string;
  readonly resourceId: string;
  readonly type: PlanningEventType;
  readonly title: string;
  readonly startDate: string;
  readonly startHalf?: "morning" | "afternoon" | "fullDay";
  readonly endDate: string;
  readonly endHalf?: "morning" | "afternoon" | "fullDay";
  readonly absenceId?: string;
  readonly approvalStatus?: "draft" | "pendingApproval" | "approved" | "rejected";
}
