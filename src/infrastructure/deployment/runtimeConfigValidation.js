export function validateCriticalRuntimeConfiguration(input) {
  if (input.isBrowser && !input.deploymentPresent) {
    return {
      code: "missingDeploymentConfiguration",
      message: "The deployment runtime configuration was not loaded."
    };
  }

  if (!["mock", "sharepoint", "api"].includes(input.planningDataSource)) {
    return {
      code: "invalidPlanningDataSource",
      message: "The runtime configuration must explicitly select mock, sharepoint, or api planning data."
    };
  }

  if (input.planningDataSource === "api" && !input.apiBaseUrlValid) {
    return {
      code: "invalidApiBaseUrl",
      message: "The API planning data source requires a valid API base URL."
    };
  }

  if (input.planningDataSource === "sharepoint" && !input.sharePointSiteUrlValid) {
    return {
      code: "invalidSharePointSiteUrl",
      message: "The SharePoint planning data source requires a valid SharePoint site URL."
    };
  }

  return undefined;
}
