import {
  getApproverOptionsForResource,
  isApprovalExemptResource
} from "../features/team-admin/services/teamAdminApi";
import type { ApprovalPolicy, ApprovalRoutingRule } from "../models/approval";
import type {
  ApprovalPolicyQuery,
  ApprovalRoutingQuery,
  IApprovalPolicyRepository,
  IApprovalRoutingRepository
} from "./approvalRepositories";
import type { RepositoryResult } from "./planningRepositories";

/**
 * EO-410: approval policy and routing backed by the Team Admin Center (EO-201
 * configuration source for the api data source). Approval is required for every
 * member unless the Team Admin marked them approval-exempt; the approver is the
 * member's effective approver, falling back to the team's default approver.
 */

export function createTeamAdminApprovalPolicyRepository(): IApprovalPolicyRepository {
  return {
    async listApprovalPolicies(query?: ApprovalPolicyQuery) {
      return ok({ items: [createPolicy(query?.teamId ?? "default", query?.plannerRole ?? "employee")] });
    },

    async getPolicy(query: ApprovalPolicyQuery) {
      return ok(createPolicy(query.teamId ?? "default", query.plannerRole ?? "employee"));
    },

    async savePolicy() {
      return notSupported<ApprovalPolicy>();
    },

    async updatePolicy() {
      return notSupported<ApprovalPolicy>();
    },

    async deletePolicy() {
      return notSupported<void>();
    }
  };
}

export function createTeamAdminApprovalRoutingRepository(): IApprovalRoutingRepository {
  return {
    async listRoutingRules(query?: ApprovalRoutingQuery) {
      const rule = query?.requesterUserId ? createRoutingRule(query.requesterUserId, query.teamId) : undefined;

      return ok({ items: rule ? [rule] : [] });
    },

    async getRouting(query: ApprovalRoutingQuery) {
      if (!query.requesterUserId) {
        return {
          ok: false as const,
          error: {
            code: "validation" as const,
            message: "Approval routing lookup requires a requester user id.",
            recoverable: true
          }
        };
      }

      return ok(createRoutingRule(query.requesterUserId, query.teamId));
    },

    async saveRouting() {
      return notSupported<ApprovalRoutingRule>();
    },

    async updateRouting() {
      return notSupported<ApprovalRoutingRule>();
    },

    async deleteRouting() {
      return notSupported<void>();
    }
  };
}

function createPolicy(teamId: string, plannerRole: ApprovalPolicy["plannerRole"]): ApprovalPolicy {
  return {
    id: `team-admin-policy-${teamId}-${plannerRole}`,
    teamId,
    plannerRole,
    approvalRequired: true,
    enabled: true,
    description: "Managed by the Team Admin Center (EO-410)."
  };
}

function createRoutingRule(requesterUserId: string, teamId: string | undefined): ApprovalRoutingRule {
  const exempt = isApprovalExemptResource(requesterUserId);
  const options = getApproverOptionsForResource(requesterUserId);

  return {
    id: `team-admin-routing-${requesterUserId}`,
    teamId: teamId ?? "team-admin",
    requesterUserId,
    approverUserId: options.defaultApproverUserId,
    // EO-417: with "allow user override" every team member is an allowed approver.
    alternateApproverUserIds: options.allowOverride ? options.candidates.map((candidate) => candidate.userId) : undefined,
    approvalRequired: !exempt,
    enabled: true
  };
}

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

function notSupported<T>(): RepositoryResult<T> {
  return {
    ok: false,
    error: {
      code: "validation",
      message: "Approval configuration is managed in the Team Admin Center.",
      recoverable: false
    }
  };
}
