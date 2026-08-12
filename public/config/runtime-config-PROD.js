// Packaging template for the tenant deployment. Select it explicitly:
//   node scripts/stamp-runtime-config.mjs --env prod
// releaseVersion and sourceRevision are stamped during packaging and must not be added here
// (EO-427 FR-427.1).
window.__RESOURCE_PRESENCE_PLANNER_CONFIG__ = {
  environmentName: "M365 PROD",
  planningMembershipSource: "graph",
  planningDataSource: "api",
  approvalMode: "m365",
  sharePointSiteUrl: "",
  apiBaseUrl: "https://rpp-api.example.com",
  apiAccessTokenScopes: [
    "api://rpp-api.example.com/00000000-0000-0000-0000-000000000002/access_as_user"
  ],
  healthCheckUrl: "/health"
};
