import type { Logger } from "../core/logging";
import type {
  ApprovalEvaluationContext,
  ApprovalPolicyEvaluation,
  ApprovalResultCallback,
  ApprovalSubmission,
  PowerAutomateApprovalInput,
  VacationRequest,
  VacationRequestLifecycleEvent,
  VacationRequestDraft,
  VacationRequestSubmissionOptions
} from "../models/approval";
import type { ApprovalRepositories } from "../repositories/approvalRepositories";
import type { RepositoryError } from "../repositories/planningRepositories";

export type ApprovalServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RepositoryError };

export interface ApprovalIntegrationService {
  saveDraft(draft: VacationRequestDraft, actorId: string): Promise<ApprovalServiceResult<VacationRequest>>;
  updateDraft(request: VacationRequest, draft: VacationRequestDraft, actorId: string): Promise<ApprovalServiceResult<VacationRequest>>;
  deleteVacationRequest(request: VacationRequest): Promise<ApprovalServiceResult<void>>;
  evaluateApprovalPolicy(
    request: VacationRequest,
    context: ApprovalEvaluationContext
  ): Promise<ApprovalServiceResult<ApprovalPolicyEvaluation>>;
  submitVacationRequest(
    request: VacationRequest,
    context: ApprovalEvaluationContext,
    options?: VacationRequestSubmissionOptions
  ): Promise<ApprovalServiceResult<ApprovalSubmission>>;
  applyApprovalResult(callback: ApprovalResultCallback): Promise<ApprovalServiceResult<VacationRequest>>;
}

export type VacationRequestLifecycleEventHandler = (event: VacationRequestLifecycleEvent) => Promise<void>;

export function createApprovalIntegrationService(
  repositories: ApprovalRepositories,
  logger?: Logger,
  onVacationRequestLifecycleEvent?: VacationRequestLifecycleEventHandler
): ApprovalIntegrationService {
  return {
    async saveDraft(draft, actorId) {
      const timestamp = new Date().toISOString();
      const request: VacationRequest = {
        id: draft.id ?? createRequestId(),
        teamId: draft.teamId,
        userId: draft.userId,
        absenceType: draft.absenceType,
        startDate: draft.startDate,
        startHalf: draft.startHalf,
        endDate: draft.endDate,
        endHalf: draft.endHalf,
        comment: draft.comment,
        approvalRequired: false,
        approvalProvider: "none",
        status: "draft",
        syncToOutlook: draft.syncToOutlook,
        outlookSync: {
          enabled: draft.syncToOutlook,
          syncStatus: "notRequired"
        },
        createdAt: timestamp,
        createdBy: actorId,
        modifiedAt: timestamp,
        modifiedBy: actorId
      };

      return repositories.vacationRequests.saveVacationRequest(request);
    },

    async updateDraft(request, draft, actorId) {
      if (request.status !== "draft" && request.status !== "rejected" && request.status !== "failed") {
        return validationError("Only draft, rejected, or failed vacation requests can be edited.");
      }

      const updatedRequest: VacationRequest = {
        ...request,
        teamId: draft.teamId,
        userId: draft.userId,
        absenceType: draft.absenceType,
        startDate: draft.startDate,
        startHalf: draft.startHalf,
        endDate: draft.endDate,
        endHalf: draft.endHalf,
        comment: draft.comment,
        approvalReferenceId: undefined,
        approverUserId: undefined,
        approvalRequired: false,
        approvalProvider: "none",
        status: "draft",
        syncToOutlook: draft.syncToOutlook,
        outlookSync: {
          enabled: draft.syncToOutlook,
          graphEventId: request.outlookSync.graphEventId,
          syncStatus: "notRequired"
        },
        modifiedAt: new Date().toISOString(),
        modifiedBy: actorId
      };

      return repositories.vacationRequests.saveVacationRequest(updatedRequest);
    },

    async deleteVacationRequest(request) {
      if (request.status === "pendingApproval" || request.status === "approved") {
        return validationError("Pending or approved vacation requests cannot be deleted by the draft lifecycle.");
      }

      return repositories.vacationRequests.deleteVacationRequest(request.id);
    },

    async evaluateApprovalPolicy(request, context) {
      if (context.requesterUserType === "guest") {
        return {
          ok: true,
          value: {
            approvalRequired: false,
            approvalProvider: "none",
            nextStatus: "approved"
          }
        };
      }

      const policyResult = await repositories.approvalPolicies.listApprovalPolicies({
        enabled: true,
        plannerRole: context.requesterPlanningRole,
        teamId: request.teamId
      });

      if (!policyResult.ok) {
        logger?.warn("Approval policy lookup failed.", {
          source: "approval",
          component: "ApprovalIntegrationService",
          operation: "evaluateApprovalPolicy",
          details: { requestId: request.id, teamId: request.teamId, errorCode: policyResult.error.code }
        });

        return policyResult;
      }

      if (policyResult.value.items.length > 1) {
        logger?.warn("Multiple active approval policies matched a vacation request.", {
          source: "approval",
          component: "ApprovalIntegrationService",
          operation: "evaluateApprovalPolicy",
          details: {
            requestId: request.id,
            teamId: request.teamId,
            plannerRole: context.requesterPlanningRole
          }
        });

        return validationError("Multiple active approval policies matched the vacation request.");
      }

      const policy = policyResult.value.items[0] ?? await loadDefaultPolicy(context.requesterPlanningRole);

      if (!policy) {
        logger?.warn("No enabled approval policy or default policy found for vacation request.", {
          source: "approval",
          component: "ApprovalIntegrationService",
          operation: "evaluateApprovalPolicy",
          details: {
            requestId: request.id,
            teamId: request.teamId,
            plannerRole: context.requesterPlanningRole
          }
        });

        return {
          ok: false,
          error: {
            code: "validation",
            message: "No enabled approval policy found for the request team and planning role.",
            recoverable: true
          }
        };
      }

      if (!policy.approvalRequired) {
        return {
          ok: true,
          value: {
            approvalRequired: false,
            approvalProvider: "none",
            nextStatus: "approved",
            policyId: policy.id
          }
        };
      }

      const routingResult = await repositories.approvalRouting.getRouting({
        enabled: true,
        requesterUserId: request.userId,
        teamId: request.teamId
      });

      if (!routingResult.ok) {
        logger?.warn("Approval policy requires Microsoft Approvals but routing could not be resolved.", {
          source: "approval",
          component: "ApprovalIntegrationService",
          operation: "evaluateApprovalPolicy",
          details: { requestId: request.id, policyId: policy.id, teamId: request.teamId, requesterUserId: request.userId }
        });

        return routingResult;
      }

      const routingRule = routingResult.value;

      if (!routingRule.approvalRequired) {
        return {
          ok: true,
          value: {
            approvalRequired: false,
            approvalProvider: "none",
            nextStatus: "approved",
            policyId: policy.id,
            routingRuleId: routingRule.id
          }
        };
      }

      const approverId = context.selectedApproverId ?? routingRule.approverUserId;

      if (!approverId) {
        logger?.warn("Approval routing rule requires approval but has no approver.", {
          source: "approval",
          component: "ApprovalIntegrationService",
          operation: "evaluateApprovalPolicy",
          details: { requestId: request.id, policyId: policy.id, routingRuleId: routingRule.id }
        });

        return validationError("Approval routing rule requires approval but has no approver.");
      }

      if (!isAllowedApprover(routingRule.approverUserId, routingRule.alternateApproverUserIds, approverId)) {
        logger?.warn("Selected approver is not allowed by approval routing configuration.", {
          source: "approval",
          component: "ApprovalIntegrationService",
          operation: "evaluateApprovalPolicy",
          details: { requestId: request.id, routingRuleId: routingRule.id, selectedApproverId: approverId }
        });

        return validationError("Selected approver is not allowed by approval routing configuration.");
      }

      return {
        ok: true,
        value: {
          approvalRequired: true,
          approvalProvider: "microsoftApprovals",
          nextStatus: "submitted",
          policyId: policy.id,
          routingRuleId: routingRule.id,
          approverId
        }
      };
    },

    async submitVacationRequest(request, context, options) {
      if (request.status !== "draft" && request.status !== "rejected" && request.status !== "failed") {
        return validationError("Only draft, rejected, or failed vacation requests can be submitted.");
      }

      const evaluationContext: ApprovalEvaluationContext = {
        ...context,
        selectedApproverId: options?.selectedApproverId ?? context.selectedApproverId
      };
      const evaluationResult = await this.evaluateApprovalPolicy(request, evaluationContext);

      if (!evaluationResult.ok) {
        return evaluationResult;
      }

      const evaluation = evaluationResult.value;
      const submittedRequest = withWorkflowFields(request, {
        approvalRequired: evaluation.approvalRequired,
        approverUserId: evaluation.approverId,
        approvalProvider: evaluation.approvalProvider,
        status: evaluation.nextStatus
      });

      if (!evaluation.approvalRequired) {
        const saveResult = await repositories.vacationRequests.saveVacationRequest(submittedRequest);

        if (!saveResult.ok) {
          return saveResult;
        }

        await publishLifecycleEvent("vacationSubmitted", saveResult.value);
        await publishLifecycleEvent("vacationApproved", saveResult.value);

        return { ok: true, value: { request: saveResult.value } };
      }

      const approvalInput = createPowerAutomateInput(submittedRequest, evaluationContext, evaluation, options);

      logger?.info("Starting Power Automate approval flow.", {
        source: "approval",
        component: "ApprovalIntegrationService",
        operation: "submitVacationRequest",
        details: { requestId: request.id, teamId: request.teamId, provider: "microsoftApprovals" }
      });

      const flowResult = await repositories.approvalIntegration.startApprovalFlow(approvalInput);

      if (!flowResult.ok) {
        logger?.warn("Power Automate approval flow start failed.", {
          source: "approval",
          component: "ApprovalIntegrationService",
          operation: "submitVacationRequest",
          details: { requestId: request.id, teamId: request.teamId, errorCode: flowResult.error.code }
        });

        const failedRequest = withWorkflowFields(submittedRequest, { status: "failed" });
        await repositories.vacationRequests.saveVacationRequest(failedRequest);

        return flowResult;
      }

      const pendingRequest = withWorkflowFields(submittedRequest, {
        approvalReferenceId: flowResult.value.approvalReferenceId,
        status: flowResult.value.status
      });
      const saveResult = await repositories.vacationRequests.saveVacationRequest(pendingRequest);

      if (!saveResult.ok) {
        return saveResult;
      }

      await publishLifecycleEvent("vacationSubmitted", saveResult.value);

      return {
        ok: true,
        value: {
          request: saveResult.value,
          providerOutput: flowResult.value
        }
      };
    },

    async applyApprovalResult(callback) {
      const requestResult = await repositories.vacationRequests.listVacationRequests({
        requestId: callback.requestId,
        status: "pendingApproval"
      });

      if (!requestResult.ok) {
        return requestResult;
      }

      const request = requestResult.value.items[0];

      if (!request || request.approvalReferenceId !== callback.approvalReferenceId) {
        logger?.warn("Approval callback could not be matched to a pending request.", {
          source: "approval",
          component: "ApprovalIntegrationService",
          operation: "applyApprovalResult",
          details: { requestId: callback.requestId, approvalReferenceId: callback.approvalReferenceId }
        });

        return {
          ok: false,
          error: {
            code: "notFound",
            message: "Approval callback could not be matched to a pending vacation request.",
            recoverable: true
          }
        };
      }

      const updatedRequest = withWorkflowFields(request, {
        status: callback.decision === "approved" ? "approved" : "rejected"
      });

      const saveResult = await repositories.vacationRequests.saveVacationRequest(updatedRequest);

      if (saveResult.ok) {
        await publishLifecycleEvent(callback.decision === "approved" ? "vacationApproved" : "vacationRejected", saveResult.value);
      }

      return saveResult;
    }
  };

  async function loadDefaultPolicy(planningRole: ApprovalEvaluationContext["requesterPlanningRole"]) {
    const result = await repositories.approvalPolicies.getPolicy({
      enabled: true,
      plannerRole: planningRole,
      teamId: "default"
    });

    if (result.ok) {
      return result.value;
    }

    logger?.warn("Default approval policy lookup failed.", {
      source: "approval",
      component: "ApprovalIntegrationService",
      operation: "evaluateApprovalPolicy",
      details: { plannerRole: planningRole, errorCode: result.error.code }
    });

    return undefined;
  }

  async function publishLifecycleEvent(type: VacationRequestLifecycleEvent["type"], request: VacationRequest) {
    if (!onVacationRequestLifecycleEvent) {
      return;
    }

    await onVacationRequestLifecycleEvent({
      type,
      request,
      occurredAt: new Date().toISOString()
    });
  }
}

function createPowerAutomateInput(
  request: VacationRequest,
  context: ApprovalEvaluationContext,
  evaluation: ApprovalPolicyEvaluation,
  options?: VacationRequestSubmissionOptions
): PowerAutomateApprovalInput {
  return {
    requestId: request.id,
    teamId: request.teamId,
    userId: request.userId,
    userDisplayName: context.requesterDisplayName,
    absenceType: request.absenceType,
    startDate: request.startDate,
    startHalf: request.startHalf,
    endDate: request.endDate,
    endHalf: request.endHalf,
    comment: request.comment,
    commentToApprover: options?.commentToApprover,
    policyId: evaluation.policyId ?? "",
    routingRuleId: evaluation.routingRuleId ?? "",
    approverId: evaluation.approverId ?? ""
  };
}

function withWorkflowFields(
  request: VacationRequest,
  values: Partial<Pick<
    VacationRequest,
    "approvalReferenceId" | "approvalProvider" | "approvalRequired" | "modifiedAt" | "modifiedBy" | "status"
    | "approverUserId"
  >>
): VacationRequest {
  return {
    ...request,
    ...values,
    modifiedAt: values.modifiedAt ?? new Date().toISOString()
  };
}

function isAllowedApprover(
  defaultApproverId: string | undefined,
  alternateApproverIds: readonly string[] | undefined,
  selectedApproverId: string
): boolean {
  return defaultApproverId === selectedApproverId || Boolean(alternateApproverIds?.includes(selectedApproverId));
}

function createRequestId(): string {
  return `vacation-request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validationError<T>(message: string): ApprovalServiceResult<T> {
  return {
    ok: false,
    error: {
      code: "validation",
      message,
      recoverable: true
    }
  };
}
