// Packaging template for a demo build without a backend. Select it explicitly:
//   node scripts/stamp-runtime-config.mjs --env mock
// releaseVersion and sourceRevision are stamped during packaging and must not be added here
// (EO-427 FR-427.1).
window.__RESOURCE_PRESENCE_PLANNER_CONFIG__ = {
  environmentName: "MOCK",
  planningMembershipSource: "mock",
  planningDataSource: "mock",
  approvalMode: "mock",
  sharePointSiteUrl: "",
  apiBaseUrl: "",
  apiAccessTokenScopes: [],
  healthCheckUrl: "/health.json"
};
