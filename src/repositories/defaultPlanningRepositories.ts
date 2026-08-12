import { createMockPlanningRepositories } from "./mockPlanningRepositories";
import type { Logger } from "../core/logging";
import type { PlanningRepositories } from "./planningRepositories";
import {
  getRuntimeConfiguration,
  type ResolvedRuntimeConfiguration
} from "../infrastructure/deployment/runtimeConfig";
import { createMicrosoft365ClientFoundation, GraphTeamMembershipProvider } from "../infrastructure/microsoft365";
import { createSharePointPlanningRepositories } from "./sharePointPlanningRepositories";
import { createApiPlanningRepositories } from "./apiPlanningRepositories";

export function createDefaultPlanningRepositories(
  logger?: Logger,
  configuration?: ResolvedRuntimeConfiguration
): PlanningRepositories {
  const runtimeConfiguration = configuration ?? getRuntimeConfiguration(logger);
  const membershipSource = runtimeConfiguration.planningMembershipSource;
  const planningDataSource = runtimeConfiguration.planningDataSource;

  let repositories: PlanningRepositories = createMockPlanningRepositories();

  if (planningDataSource === "api" && runtimeConfiguration.apiBaseUrl) {
    repositories = createApiPlanningRepositories(runtimeConfiguration.apiBaseUrl, logger);
  } 
  else if (planningDataSource === "sharepoint") {
    const microsoft365 = createMicrosoft365ClientFoundation({
      sharePointSiteUrl: runtimeConfiguration.sharePointSiteUrl
    }, logger);

    const sharePointClient = microsoft365.createSharePointClient();

    if (sharePointClient) {
      repositories = createSharePointPlanningRepositories(repositories, sharePointClient);
    }
  }

  // With the "api" data source the API already delivers real Graph memberships server-side
  // (EO-406); the browser-side Graph provider would require Teams SSO and must not override them.
  if (membershipSource === "graph" && planningDataSource !== "api") {
    const microsoft365 = createMicrosoft365ClientFoundation({
      sharePointSiteUrl: runtimeConfiguration.sharePointSiteUrl
    }, logger);

    const graphClient = microsoft365.createGraphClient();

    repositories = {
      ...repositories,
      teamMemberships: new GraphTeamMembershipProvider(graphClient, microsoft365.teamsContextProvider, logger)
    };
  }

  return repositories;
}
