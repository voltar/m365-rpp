import type { Logger } from "../core/logging";
import type {
  IApprovalIntegrationRepository,
  PowerAutomateApprovalInput,
  PowerAutomateApprovalOutput,
  RepositoryResult,
} from "./approvalRepositories";

const APPROVAL_FLOW_TIMEOUT_MS = 30000;

/**
 * Implements the live Power Automate integration for EO-207.
 * Posts the approval request to the configured flow URL and returns the
 * Microsoft Approval reference according to the EO-200 contract.
 */
export class PowerAutomateApprovalIntegrationRepository
  implements IApprovalIntegrationRepository
{
  constructor(
    private readonly flowUrl: string,
    private readonly logger?: Logger
  ) {
    // URL is already validated by runtimeConfig
  }

  async startApprovalFlow(
    input: PowerAutomateApprovalInput
  ): Promise<RepositoryResult<PowerAutomateApprovalOutput>> {
    this.logger?.info("Starting Microsoft 365 approval flow via Power Automate.", {
      source: "repository",
      component: "PowerAutomateApprovalIntegrationRepository",
      operation: "startApprovalFlow",
      details: {
        requestId: input.requestId,
        teamId: input.teamId,
        approverId: input.approverId,
        flowUrlHost: new URL(this.flowUrl).hostname,
      },
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), APPROVAL_FLOW_TIMEOUT_MS);

    try {
      const response = await fetch(this.flowUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        this.logger?.error("Power Automate flow returned error.", {
          source: "repository",
          component: "PowerAutomateApprovalIntegrationRepository",
          operation: "startApprovalFlow",
          details: { status: response.status, requestId: input.requestId, errorText },
        });

        return {
          ok: false,
          error: {
            code: response.status >= 500 ? "unknown" : "validation",
            message: `Flow returned HTTP ${response.status}`,
            recoverable: response.status >= 500,
            details: { status: response.status, body: errorText },
          },
        };
      }

      const result = (await response.json()) as PowerAutomateApprovalOutput;

      // Validate response conforms to EO-200 contract
      if (!result.approvalReferenceId || !result.flowRunId) {
        this.logger?.warn("Power Automate response missing required fields.", {
          source: "repository",
          component: "PowerAutomateApprovalIntegrationRepository",
          operation: "startApprovalFlow",
          details: { requestId: input.requestId, hasReference: !!result.approvalReferenceId },
        });

        return {
          ok: false,
          error: {
            code: "validation",
            message: "Flow response did not contain approvalReferenceId or flowRunId",
            recoverable: true,
          },
        };
      }

      this.logger?.info("Power Automate approval flow started successfully.", {
        source: "repository",
        component: "PowerAutomateApprovalIntegrationRepository",
        operation: "startApprovalFlow",
        details: {
          requestId: result.requestId,
          approvalReferenceId: result.approvalReferenceId,
          flowRunId: result.flowRunId,
        },
      });

      return { ok: true, value: result };
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      const isAbort = error instanceof DOMException && error.name === "AbortError";
      const message = isAbort
        ? "Power Automate flow call timed out"
        : "Failed to call Power Automate approval flow";

      this.logger?.error(message, {
        source: "repository",
        component: "PowerAutomateApprovalIntegrationRepository",
        operation: "startApprovalFlow",
        details: { requestId: input.requestId, flowUrl: this.flowUrl },
      }, error);

      return {
        ok: false,
        error: {
          code: isAbort ? "timeout" : "network",
          message,
          recoverable: true,
          details: { requestId: input.requestId },
        },
      };
    }
  }
}

export function createPowerAutomateApprovalIntegrationRepository(
  flowUrl: string,
  logger?: Logger
): PowerAutomateApprovalIntegrationRepository {
  return new PowerAutomateApprovalIntegrationRepository(flowUrl, logger);
}
