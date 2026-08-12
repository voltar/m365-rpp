import { mockApprovalPolicies } from "../data/mockApprovalPolicies";
import { mockApprovalRoutingRules } from "../data/mockApprovalRoutingRules";
import type {
  ApprovalPolicy,
  ApprovalRoutingRule,
  PowerAutomateApprovalInput,
  PowerAutomateApprovalOutput,
  VacationRequest
} from "../models/approval";
import type {
  ApprovalPolicyQuery,
  ApprovalRoutingQuery,
  ApprovalRepositories,
  IApprovalIntegrationRepository,
  IApprovalPolicyRepository,
  IApprovalRoutingRepository,
  IVacationRequestRepository,
  VacationRequestQuery
} from "./approvalRepositories";
import type { RepositoryPage, RepositoryPageRequest, RepositoryResult } from "./planningRepositories";

export class MockApprovalPolicyRepository implements IApprovalPolicyRepository {
  private policies: readonly ApprovalPolicy[];

  constructor(initialPolicies: readonly ApprovalPolicy[] = mockApprovalPolicies) {
    this.policies = initialPolicies;
  }

  async listApprovalPolicies(query?: ApprovalPolicyQuery): Promise<RepositoryResult<RepositoryPage<ApprovalPolicy>>> {
    const filteredPolicies = this.policies.filter((policy) => {
      const matchesPolicy = !query?.policyId || policy.id === query.policyId;
      const matchesTeam = !query?.teamId || policy.teamId === query.teamId;
      const matchesRole = !query?.plannerRole || policy.plannerRole === query.plannerRole;
      const matchesEnabled = query?.enabled === undefined || policy.enabled === query.enabled;

      return matchesPolicy && matchesTeam && matchesRole && matchesEnabled;
    });

    return ok(pageItems(filteredPolicies, query));
  }

  async getPolicy(query: ApprovalPolicyQuery): Promise<RepositoryResult<ApprovalPolicy>> {
    const result = await this.listApprovalPolicies({ ...query, pageSize: 1 });

    if (!result.ok) {
      return result;
    }

    const policy = result.value.items[0] ?? this.findDefaultPolicy(query);

    return policy ? ok(policy) : notFound("No approval policy or default policy was found.");
  }

  async savePolicy(policy: ApprovalPolicy): Promise<RepositoryResult<ApprovalPolicy>> {
    if (!isValidPolicy(policy)) {
      return validationError("Approval policy is invalid.");
    }

    if (this.policies.some((candidate) => candidate.id === policy.id)) {
      return validationError("Approval policy already exists.");
    }

    if (this.hasDuplicateActivePolicy(policy)) {
      return validationError("An active approval policy already exists for this team and planning role.");
    }

    this.policies = [...this.policies, policy];
    return ok(policy);
  }

  async updatePolicy(policy: ApprovalPolicy): Promise<RepositoryResult<ApprovalPolicy>> {
    if (!isValidPolicy(policy)) {
      return validationError("Approval policy is invalid.");
    }

    const exists = this.policies.some((candidate) => candidate.id === policy.id);

    if (!exists) {
      return notFound("Approval policy was not found.");
    }

    if (this.hasDuplicateActivePolicy(policy)) {
      return validationError("An active approval policy already exists for this team and planning role.");
    }

    this.policies = this.policies.map((candidate) => (candidate.id === policy.id ? policy : candidate));
    return ok(policy);
  }

  async deletePolicy(policyId: string): Promise<RepositoryResult<void>> {
    this.policies = this.policies.filter((policy) => policy.id !== policyId);
    return ok(undefined);
  }

  private findDefaultPolicy(query: ApprovalPolicyQuery): ApprovalPolicy | undefined {
    return this.policies.find((policy) => {
      const matchesRole = !query.plannerRole || policy.plannerRole === query.plannerRole;
      const matchesEnabled = query.enabled === undefined || policy.enabled === query.enabled;

      return policy.teamId === "default" && matchesRole && matchesEnabled;
    });
  }

  private hasDuplicateActivePolicy(policy: ApprovalPolicy): boolean {
    if (!policy.enabled) {
      return false;
    }

    return this.policies.some((candidate) => (
      candidate.id !== policy.id
      && candidate.enabled
      && candidate.teamId === policy.teamId
      && candidate.plannerRole === policy.plannerRole
    ));
  }
}

export class MockApprovalRoutingRepository implements IApprovalRoutingRepository {
  private rules: readonly ApprovalRoutingRule[];

  constructor(initialRules: readonly ApprovalRoutingRule[] = mockApprovalRoutingRules) {
    this.rules = initialRules;
  }

  async listRoutingRules(query?: ApprovalRoutingQuery): Promise<RepositoryResult<RepositoryPage<ApprovalRoutingRule>>> {
    const filteredRules = this.rules.filter((rule) => {
      const matchesRule = !query?.routingRuleId || rule.id === query.routingRuleId;
      const matchesTeam = !query?.teamId || rule.teamId === query.teamId;
      const matchesRequester = !query?.requesterUserId || rule.requesterUserId === query.requesterUserId;
      const matchesEnabled = query?.enabled === undefined || rule.enabled === query.enabled;

      return matchesRule && matchesTeam && matchesRequester && matchesEnabled;
    });

    return ok(pageItems(filteredRules, query));
  }

  async getRouting(query: ApprovalRoutingQuery): Promise<RepositoryResult<ApprovalRoutingRule>> {
    const result = await this.listRoutingRules({ ...query, pageSize: 2 });

    if (!result.ok) {
      return result;
    }

    if (result.value.items.length > 1) {
      return validationError("Multiple approval routing rules matched the request.");
    }

    const rule = result.value.items[0];

    return rule ? ok(rule) : notFound("No approval routing rule was found.");
  }

  async saveRouting(rule: ApprovalRoutingRule): Promise<RepositoryResult<ApprovalRoutingRule>> {
    if (!isValidRoutingRule(rule)) {
      return validationError("Approval routing rule is invalid.");
    }

    if (this.rules.some((candidate) => candidate.id === rule.id)) {
      return validationError("Approval routing rule already exists.");
    }

    if (this.hasDuplicateActiveRoutingRule(rule)) {
      return validationError("An active approval routing rule already exists for this team and requester.");
    }

    this.rules = [...this.rules, rule];
    return ok(rule);
  }

  async updateRouting(rule: ApprovalRoutingRule): Promise<RepositoryResult<ApprovalRoutingRule>> {
    if (!isValidRoutingRule(rule)) {
      return validationError("Approval routing rule is invalid.");
    }

    const exists = this.rules.some((candidate) => candidate.id === rule.id);

    if (!exists) {
      return notFound("Approval routing rule was not found.");
    }

    if (this.hasDuplicateActiveRoutingRule(rule)) {
      return validationError("An active approval routing rule already exists for this team and requester.");
    }

    this.rules = this.rules.map((candidate) => (candidate.id === rule.id ? rule : candidate));
    return ok(rule);
  }

  async deleteRouting(routingRuleId: string): Promise<RepositoryResult<void>> {
    this.rules = this.rules.filter((rule) => rule.id !== routingRuleId);
    return ok(undefined);
  }

  private hasDuplicateActiveRoutingRule(rule: ApprovalRoutingRule): boolean {
    if (!rule.enabled) {
      return false;
    }

    return this.rules.some((candidate) => (
      candidate.id !== rule.id
      && candidate.enabled
      && candidate.teamId === rule.teamId
      && candidate.requesterUserId === rule.requesterUserId
    ));
  }
}

export class MockVacationRequestRepository implements IVacationRequestRepository {
  private requests: readonly VacationRequest[];

  constructor(initialRequests: readonly VacationRequest[] = []) {
    this.requests = initialRequests;
  }

  async listVacationRequests(query?: VacationRequestQuery): Promise<RepositoryResult<RepositoryPage<VacationRequest>>> {
    const filteredRequests = this.requests.filter((request) => {
      const matchesRequest = !query?.requestId || request.id === query.requestId;
      const matchesUser = !query?.userId || request.userId === query.userId;
      const matchesTeam = !query?.teamId || request.teamId === query.teamId;
      const matchesStatus = !query?.status || request.status === query.status;
      const matchesFrom = !query?.fromDate || request.endDate >= query.fromDate;
      const matchesTo = !query?.toDate || request.startDate <= query.toDate;

      return matchesRequest && matchesUser && matchesTeam && matchesStatus && matchesFrom && matchesTo;
    });

    return ok(pageItems(filteredRequests, query));
  }

  async saveVacationRequest(request: VacationRequest): Promise<RepositoryResult<VacationRequest>> {
    const exists = this.requests.some((candidate) => candidate.id === request.id);
    this.requests = exists
      ? this.requests.map((candidate) => (candidate.id === request.id ? request : candidate))
      : [...this.requests, request];

    return ok(request);
  }

  async deleteVacationRequest(requestId: string): Promise<RepositoryResult<void>> {
    this.requests = this.requests.filter((request) => request.id !== requestId);
    return ok(undefined);
  }
}

export class MockApprovalIntegrationRepository implements IApprovalIntegrationRepository {
  async startApprovalFlow(input: PowerAutomateApprovalInput): Promise<RepositoryResult<PowerAutomateApprovalOutput>> {
    return ok({
      requestId: input.requestId,
      approvalReferenceId: `m365-approval-${input.requestId}`,
      flowRunId: `flow-run-${input.requestId}`,
      status: "pendingApproval"
    });
  }
}

export function createMockApprovalRepositories(): ApprovalRepositories {
  return {
    approvalPolicies: new MockApprovalPolicyRepository(),
    approvalRouting: new MockApprovalRoutingRepository(),
    vacationRequests: new MockVacationRequestRepository(),
    approvalIntegration: new MockApprovalIntegrationRepository()
  };
}

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

function notFound<T>(message: string): RepositoryResult<T> {
  return {
    ok: false,
    error: {
      code: "notFound",
      message,
      recoverable: true
    }
  };
}

function validationError<T>(message: string): RepositoryResult<T> {
  return {
    ok: false,
    error: {
      code: "validation",
      message,
      recoverable: true
    }
  };
}

function pageItems<T>(items: readonly T[], request?: RepositoryPageRequest): RepositoryPage<T> {
  const start = request?.pageToken ? Number.parseInt(request.pageToken, 10) : 0;
  const safeStart = Number.isFinite(start) && start > 0 ? start : 0;
  const pageSize = request?.pageSize && request.pageSize > 0 ? request.pageSize : items.length;
  const page = items.slice(safeStart, safeStart + pageSize);
  const nextPageToken = safeStart + pageSize < items.length ? `${safeStart + pageSize}` : undefined;

  return { items: page, nextPageToken };
}

function isValidPolicy(policy: ApprovalPolicy): boolean {
  return Boolean(policy.id && policy.teamId && policy.plannerRole);
}

function isValidRoutingRule(rule: ApprovalRoutingRule): boolean {
  return Boolean(rule.id && rule.teamId && rule.requesterUserId && (!rule.approvalRequired || rule.approverUserId));
}
