import type { AbsenceType, DayHalf } from "./absence";
import type { UserType } from "./identity";

export type ApprovalProvider = "none" | "microsoftApprovals";

export type VacationRequestStatus =
  | "draft"
  | "submitted"
  | "pendingApproval"
  | "approved"
  | "rejected"
  | "cancelled"
  | "failed";

export type ApprovalDecisionOutcome = "approved" | "rejected";

export type OutlookSyncStatus = "notRequired" | "pending" | "synced" | "failed";

export interface OutlookSync {
  readonly enabled: boolean;
  readonly graphEventId?: string;
  readonly syncStatus: OutlookSyncStatus;
  readonly lastSyncedAt?: string;
  readonly lastError?: string;
}

export type StandardPlanningRole = "employee" | "teamLead" | "departmentHead" | "guest";

export type PlanningRole = StandardPlanningRole | (string & {});

export interface VacationRequest {
  readonly id: string;
  readonly teamId: string;
  readonly userId: string;
  readonly absenceType: AbsenceType;
  readonly startDate: string;
  readonly startHalf: DayHalf;
  readonly endDate: string;
  readonly endHalf: DayHalf;
  readonly comment?: string;
  readonly approvalRequired: boolean;
  readonly approverUserId?: string;
  readonly status: VacationRequestStatus;
  readonly approvalProvider: ApprovalProvider;
  readonly approvalReferenceId?: string;
  readonly syncToOutlook: boolean;
  readonly outlookSync: OutlookSync;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly modifiedAt: string;
  readonly modifiedBy: string;
}

export interface VacationRequestDraft {
  readonly id?: string;
  readonly teamId: string;
  readonly userId: string;
  readonly absenceType: AbsenceType;
  readonly startDate: string;
  readonly startHalf: DayHalf;
  readonly endDate: string;
  readonly endHalf: DayHalf;
  readonly comment?: string;
  readonly syncToOutlook: boolean;
}

export interface ApprovalPolicy {
  readonly id: string;
  readonly teamId: string;
  readonly plannerRole: PlanningRole;
  readonly approvalRequired: boolean;
  readonly enabled: boolean;
  readonly description?: string;
}

export interface ApprovalRoutingRule {
  readonly id: string;
  readonly teamId: string;
  readonly requesterUserId: string;
  readonly approverUserId?: string;
  readonly alternateApproverUserIds?: readonly string[];
  readonly approvalRequired: boolean;
  readonly enabled: boolean;
}

export interface ApprovalEvaluationContext {
  readonly requesterUserType: UserType;
  readonly requesterPlanningRole: PlanningRole;
  readonly requesterDisplayName: string;
  readonly selectedApproverId?: string;
}

export interface ApprovalPolicyEvaluation {
  readonly approvalRequired: boolean;
  readonly approvalProvider: ApprovalProvider;
  readonly nextStatus: Extract<VacationRequestStatus, "approved" | "submitted">;
  readonly policyId?: string;
  readonly routingRuleId?: string;
  readonly approverId?: string;
}

export interface VacationRequestSubmissionOptions {
  readonly selectedApproverId?: string;
  readonly commentToApprover?: string;
}

export interface PowerAutomateApprovalInput {
  readonly requestId: string;
  readonly teamId: string;
  readonly userId: string;
  readonly userDisplayName: string;
  readonly absenceType: AbsenceType;
  readonly startDate: string;
  readonly startHalf: DayHalf;
  readonly endDate: string;
  readonly endHalf: DayHalf;
  readonly comment?: string;
  readonly commentToApprover?: string;
  readonly policyId: string;
  readonly routingRuleId: string;
  readonly approverId: string;
}

export interface PowerAutomateApprovalOutput {
  readonly requestId: string;
  readonly approvalReferenceId: string;
  readonly decision?: ApprovalDecisionOutcome;
  readonly decisionBy?: string;
  readonly decisionDate?: string;
  readonly decisionComment?: string;
  readonly flowRunId: string;
  readonly status: Extract<VacationRequestStatus, "pendingApproval" | "approved" | "rejected" | "failed">;
}

export interface ApprovalSubmission {
  readonly request: VacationRequest;
  readonly providerOutput?: PowerAutomateApprovalOutput;
}

export interface ApprovalResultCallback {
  readonly requestId: string;
  readonly approvalReferenceId: string;
  readonly decision: ApprovalDecisionOutcome;
  readonly decisionBy: string;
  readonly decisionDate: string;
  readonly decisionComment?: string;
  readonly flowRunId: string;
}

export type VacationRequestLifecycleEventType =
  | "vacationSubmitted"
  | "vacationApproved"
  | "vacationUpdated"
  | "vacationCancelled"
  | "vacationRejected";

export interface VacationRequestLifecycleEvent {
  readonly type: VacationRequestLifecycleEventType;
  readonly request: VacationRequest;
  readonly occurredAt: string;
}
