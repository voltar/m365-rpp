import type {
  ApprovalRoutingRule,
  ApprovalPolicy,
  PlanningRole,
  PowerAutomateApprovalInput,
  PowerAutomateApprovalOutput,
  VacationRequest,
} from "../models/approval";
import type {
  RepositoryPage,
  RepositoryPageRequest,
  RepositoryResult,
} from "./planningRepositories";
export type { RepositoryResult, RepositoryPage, RepositoryError } from "./planningRepositories";
export type { VacationRequest } from "../models/approval";
export type { PowerAutomateApprovalInput, PowerAutomateApprovalOutput } from "../models/approval";

export interface ApprovalPolicyQuery extends RepositoryPageRequest {
  readonly policyId?: string;
  readonly teamId?: string;
  readonly plannerRole?: PlanningRole;
  readonly enabled?: boolean;
}

export interface ApprovalRoutingQuery extends RepositoryPageRequest {
  readonly routingRuleId?: string;
  readonly teamId?: string;
  readonly requesterUserId?: string;
  readonly enabled?: boolean;
}

export interface VacationRequestQuery extends RepositoryPageRequest {
  readonly requestId?: string;
  readonly userId?: string;
  readonly teamId?: string;
  readonly status?: VacationRequest["status"];
  readonly fromDate?: string;
  readonly toDate?: string;
}

export interface IApprovalPolicyRepository {
  listApprovalPolicies(query?: ApprovalPolicyQuery): Promise<RepositoryResult<RepositoryPage<ApprovalPolicy>>>;
  getPolicy(query: ApprovalPolicyQuery): Promise<RepositoryResult<ApprovalPolicy>>;
  savePolicy(policy: ApprovalPolicy): Promise<RepositoryResult<ApprovalPolicy>>;
  updatePolicy(policy: ApprovalPolicy): Promise<RepositoryResult<ApprovalPolicy>>;
  deletePolicy(policyId: string): Promise<RepositoryResult<void>>;
}

export interface IVacationRequestRepository {
  listVacationRequests(query?: VacationRequestQuery): Promise<RepositoryResult<RepositoryPage<VacationRequest>>>;
  saveVacationRequest(request: VacationRequest): Promise<RepositoryResult<VacationRequest>>;
  deleteVacationRequest(requestId: string): Promise<RepositoryResult<void>>;
}

export interface IApprovalRoutingRepository {
  listRoutingRules(query?: ApprovalRoutingQuery): Promise<RepositoryResult<RepositoryPage<ApprovalRoutingRule>>>;
  getRouting(query: ApprovalRoutingQuery): Promise<RepositoryResult<ApprovalRoutingRule>>;
  saveRouting(rule: ApprovalRoutingRule): Promise<RepositoryResult<ApprovalRoutingRule>>;
  updateRouting(rule: ApprovalRoutingRule): Promise<RepositoryResult<ApprovalRoutingRule>>;
  deleteRouting(routingRuleId: string): Promise<RepositoryResult<void>>;
}

export interface IApprovalIntegrationRepository {
  startApprovalFlow(input: PowerAutomateApprovalInput): Promise<RepositoryResult<PowerAutomateApprovalOutput>>;
}

export interface ApprovalRepositories {
  readonly approvalPolicies: IApprovalPolicyRepository;
  readonly approvalRouting: IApprovalRoutingRepository;
  readonly vacationRequests: IVacationRequestRepository;
  readonly approvalIntegration: IApprovalIntegrationRepository;
}
