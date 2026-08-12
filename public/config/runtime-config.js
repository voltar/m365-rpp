// Development default, served by `npm run dev`. Stays on mock so a local run can never target a
// tenant by accident (EO-427 FR-427.2). Packaging never reads this file — it stamps a copy of
// runtime-config-<ENV>.js into dist/. releaseVersion and sourceRevision are deliberately absent;
// the app then falls back to "local", which is the truth for a dev run.
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
