import type { DayHalf } from "../../../models/absence";

export interface VacationBalance {
  readonly userId: string;
  readonly vacationYear: number;
  readonly annualEntitlement: number;
  readonly carryForward: number;
  readonly manualAdjustments: number;
  readonly pendingVacation: number;
  readonly approvedVacation: number;
  readonly remainingBalance: number;
}

export interface VacationBalanceAdjustment {
  readonly id: string;
  readonly userId: string;
  readonly vacationYear: number;
  readonly adjustment: number;
  readonly reason: string;
  readonly adjustedBy: string;
  readonly adjustedAt: string;
  readonly previousValue: number;
  readonly newValue: number;
}

export interface VacationBalancePreview {
  readonly currentBalance: number;
  readonly requestedVacation: number;
  readonly remainingAfterSubmission: number;
  readonly exceedsBalance: boolean;
}

export interface VacationBalanceOverview {
  readonly balance: VacationBalance;
  readonly history: readonly VacationBalanceAdjustment[];
}

export interface VacationBalancePatch {
  readonly annualEntitlement?: number;
  readonly carryForward?: number;
  readonly adjustment?: number;
  readonly reason: string;
  readonly administrator: string;
}

export interface VacationBalancePreviewRequest {
  readonly userId: string;
  readonly vacationYear: number;
  readonly startDate: string;
  readonly startHalf: DayHalf;
  readonly endDate: string;
  readonly endHalf: DayHalf;
}
