import type { VacationRequest } from "../../../models/approval";
import { loadPersistedMockState, savePersistedMockState } from "../../../data/mockStatePersistence";
import { calculateAbsenceDuration } from "../../../services/absenceCalculations";
import type {
  VacationBalance,
  VacationBalanceAdjustment,
  VacationBalanceOverview,
  VacationBalancePatch,
  VacationBalancePreview,
  VacationBalancePreviewRequest
} from "../types/vacationBalance";

interface VacationBalanceSeed {
  readonly userId: string;
  readonly vacationYear: number;
  readonly annualEntitlement: number;
  readonly carryForward: number;
  readonly manualAdjustments: number;
}

const currentYear = 2026;

let balances: readonly VacationBalanceSeed[] = loadPersistedMockState<readonly VacationBalanceSeed[]>("vacationBalances", [
  {
    userId: "gianni-zanetti",
    vacationYear: currentYear,
    annualEntitlement: 25,
    carryForward: 1,
    manualAdjustments: 0.5
  }
]);

let adjustments: readonly VacationBalanceAdjustment[] = loadPersistedMockState<readonly VacationBalanceAdjustment[]>(
  "vacationBalanceAdjustments",
  [
    {
      id: "vacation-adjustment-001",
      userId: "gianni-zanetti",
      vacationYear: currentYear,
      adjustment: 0.5,
      reason: "Administrative correction",
      adjustedBy: "team-admin-platform",
      adjustedAt: "2026-01-15T09:00:00.000Z",
      previousValue: 0,
      newValue: 0.5
    }
  ]
);

const vacationRequests: readonly VacationRequest[] = [
  createVacationRequest("vacation-request-approved-001", "approved", "2026-03-02", "2026-03-06"),
  createVacationRequest("vacation-request-approved-002", "approved", "2026-04-13", "2026-04-15"),
  createVacationRequest("vacation-request-submitted-001", "submitted", "2026-07-20", "2026-07-22")
];

export async function getMyVacationBalance(year: number = currentYear): Promise<VacationBalanceOverview> {
  return getEmployeeVacationBalance("gianni-zanetti", year);
}

export async function getEmployeeVacationBalance(userId: string, year: number = currentYear): Promise<VacationBalanceOverview> {
  const balance = calculateVacationBalance(userId, year);

  return {
    balance,
    history: await getBalanceHistory(userId, year)
  };
}

export async function updateVacationBalance(
  userId: string,
  year: number,
  patch: VacationBalancePatch
): Promise<VacationBalanceOverview> {
  const existing = getSeed(userId, year);
  const previousValue = existing.manualAdjustments;
  const adjustment = patch.adjustment ?? 0;
  const nextSeed: VacationBalanceSeed = {
    ...existing,
    annualEntitlement: patch.annualEntitlement ?? existing.annualEntitlement,
    carryForward: patch.carryForward ?? existing.carryForward,
    manualAdjustments: existing.manualAdjustments + adjustment
  };

  balances = balances.some((candidate) => candidate.userId === userId && candidate.vacationYear === year)
    ? balances.map((candidate) => (candidate.userId === userId && candidate.vacationYear === year ? nextSeed : candidate))
    : [...balances, nextSeed];

  if (adjustment !== 0) {
    adjustments = [
      ...adjustments,
      {
        id: `vacation-adjustment-${Date.now()}`,
        userId,
        vacationYear: year,
        adjustment,
        reason: patch.reason,
        adjustedBy: patch.administrator,
        adjustedAt: new Date().toISOString(),
        previousValue,
        newValue: nextSeed.manualAdjustments
      }
    ];
  }

  savePersistedMockState("vacationBalances", balances);
  savePersistedMockState("vacationBalanceAdjustments", adjustments);

  return getEmployeeVacationBalance(userId, year);
}

export async function getBalanceHistory(userId: string, year: number = currentYear): Promise<readonly VacationBalanceAdjustment[]> {
  return adjustments
    .filter((adjustment) => adjustment.userId === userId && adjustment.vacationYear === year)
    .sort((first, second) => second.adjustedAt.localeCompare(first.adjustedAt));
}

export async function previewVacationRequest(request: VacationBalancePreviewRequest): Promise<VacationBalancePreview> {
  const balance = calculateVacationBalance(request.userId, request.vacationYear);
  const requestedVacation = calculateAbsenceDuration({
    startDate: request.startDate,
    startHalf: request.startHalf,
    endDate: request.endDate,
    endHalf: request.endHalf
  });
  const remainingAfterSubmission = balance.remainingBalance - requestedVacation;

  return {
    currentBalance: balance.remainingBalance,
    requestedVacation,
    remainingAfterSubmission,
    exceedsBalance: remainingAfterSubmission < 0
  };
}

function calculateVacationBalance(userId: string, year: number): VacationBalance {
  const seed = getSeed(userId, year);
  const relevantRequests = vacationRequests.filter((request) => (
    request.userId === userId
    && request.absenceType === "vacation"
    && new Date(`${request.startDate}T00:00:00`).getFullYear() === year
  ));
  const pendingVacation = relevantRequests
    .filter((request) => request.status === "submitted" || request.status === "pendingApproval")
    .reduce((sum, request) => sum + calculateRequestDuration(request), 0);
  const approvedVacation = relevantRequests
    .filter((request) => request.status === "approved")
    .reduce((sum, request) => sum + calculateRequestDuration(request), 0);
  const remainingBalance = seed.annualEntitlement + seed.carryForward + seed.manualAdjustments - pendingVacation - approvedVacation;

  return {
    userId,
    vacationYear: year,
    annualEntitlement: seed.annualEntitlement,
    carryForward: seed.carryForward,
    manualAdjustments: seed.manualAdjustments,
    pendingVacation,
    approvedVacation,
    remainingBalance
  };
}

function getSeed(userId: string, year: number): VacationBalanceSeed {
  return balances.find((balance) => balance.userId === userId && balance.vacationYear === year) ?? {
    userId,
    vacationYear: year,
    annualEntitlement: 25,
    carryForward: 0,
    manualAdjustments: 0
  };
}

function calculateRequestDuration(request: VacationRequest): number {
  return calculateAbsenceDuration({
    startDate: request.startDate,
    startHalf: request.startHalf,
    endDate: request.endDate,
    endHalf: request.endHalf
  });
}

function createVacationRequest(
  id: string,
  status: VacationRequest["status"],
  startDate: string,
  endDate: string
): VacationRequest {
  const now = new Date().toISOString();

  return {
    id,
    teamId: "platform-services",
    userId: "gianni-zanetti",
    absenceType: "vacation",
    startDate,
    startHalf: "fullDay",
    endDate,
    endHalf: "fullDay",
    approvalRequired: status !== "approved",
    status,
    approvalProvider: status === "approved" ? "none" : "microsoftApprovals",
    syncToOutlook: true,
    outlookSync: {
      enabled: true,
      syncStatus: "synced"
    },
    createdAt: now,
    createdBy: "gianni-zanetti",
    modifiedAt: now,
    modifiedBy: "gianni-zanetti"
  };
}
