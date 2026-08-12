import type { Logger } from "../core/logging";
import { getRuntimeConfiguration } from "../infrastructure/deployment/runtimeConfig";
import { createMicrosoft365ClientFoundation } from "../infrastructure/microsoft365";
import type { SharePointClient } from "../infrastructure/microsoft365/sharePointClient";
import { createMockApprovalRepositories } from "./mockApprovalRepositories";
import { createSharePointVacationRequestRepository } from "./sharePointVacationRequestRepository";
import { createPowerAutomateApprovalIntegrationRepository } from "./powerAutomateApprovalIntegrationRepository";
import { createApiApprovalIntegrationRepository, createApiVacationRequestRepository } from "./apiApprovalRepositories";
import { createTeamAdminApprovalPolicyRepository, createTeamAdminApprovalRoutingRepository } from "./teamAdminApprovalRepositories";
import type { ApprovalRepositories } from "./approvalRepositories";

export function createDefaultApprovalRepositories(logger?: Logger): ApprovalRepositories {
  const runtimeConfiguration = getRuntimeConfiguration(logger);
  const { apiBaseUrl, approvalMode, approvalFlowUrl, planningDataSource, sharePointSiteUrl } = runtimeConfiguration;

  // EO-410: with the api data source the approval workflow runs through the RPP Web API;
  // policies/routing come from the Team Admin Center (EO-201 configuration source).
  if (approvalMode === "m365" && planningDataSource === "api" && apiBaseUrl) {
    return {
      approvalPolicies: createTeamAdminApprovalPolicyRepository(),
      approvalRouting: createTeamAdminApprovalRoutingRepository(),
      vacationRequests: createApiVacationRequestRepository(apiBaseUrl, logger),
      approvalIntegration: createApiApprovalIntegrationRepository(apiBaseUrl, logger)
    };
  }

  // EO-207: SharePoint-backed path for the sharepoint data source (static SPA scenario).
  if (approvalMode === "m365" && approvalFlowUrl && sharePointSiteUrl) {
    const microsoft365 = createMicrosoft365ClientFoundation(
      { sharePointSiteUrl },
      logger
    );

    const sharePointClient = microsoft365.createSharePointClient();

    if (sharePointClient) {
      return createM365ApprovalRepositories(sharePointClient, approvalFlowUrl, logger);
    }
  }

  if (approvalMode === "m365") {
    logger?.warn("approvalMode=m365 configured but no usable backend (api data source or approvalFlowUrl + SharePoint site URL) is available. Falling back to mock approval workflow.", {
      source: "repository",
      component: "defaultApprovalRepositories",
      operation: "createDefaultApprovalRepositories",
      details: { approvalMode, planningDataSource, hasApiBaseUrl: !!apiBaseUrl, hasFlowUrl: !!approvalFlowUrl, hasSharePointUrl: !!sharePointSiteUrl }
    });
  }

  return createMockApprovalRepositories();
}

export const approvalRepositories = createDefaultApprovalRepositories();

function createM365ApprovalRepositories(
  sharePointClient: SharePointClient,
  approvalFlowUrl: string,
  logger?: Logger
): ApprovalRepositories {
  return {
    ...createMockApprovalRepositories(), // policies + routing stay mock for now (EO-201)
    vacationRequests: createSharePointVacationRequestRepository(sharePointClient, logger),
    approvalIntegration: createPowerAutomateApprovalIntegrationRepository(approvalFlowUrl, logger),
  };
}
