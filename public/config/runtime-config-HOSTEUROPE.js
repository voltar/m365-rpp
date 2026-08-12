// Host Europe (rpp.example.com) — Kestrel behind nginx.
// Package with: npm run package:api -- --env hosteurope
// releaseVersion / sourceRevision are stamped at package time (EO-427).
//
// apiBaseUrl is the public HTTPS origin (same host as the SPA). Relative "" is not used in the
// template because packaging validation requires a non-empty api URL; same-origin is achieved by
// matching the page origin.
//
// standaloneBrowserUsesMock: plain browser visits (marketing / demo) get mock data; the same
// artefact inside Microsoft Teams keeps api + m365 (Teams SSO). No localStorage hack required.
window.__RESOURCE_PRESENCE_PLANNER_CONFIG__ = {
  environmentName: "HOSTEUROPE",
  planningMembershipSource: "graph",
  planningDataSource: "api",
  approvalMode: "m365",
  standaloneBrowserUsesMock: true,
  sharePointSiteUrl: "",
  apiBaseUrl: "https://rpp.example.com",
  // Entra app "RPP Example" (profile example / rpp-config-example.psd1). Must match
  // teams-app-package/rpp-he webApplicationInfo.resource and AzureAd__Audience on the server.
  apiAccessTokenScopes: [
    "api://rpp.example.com/00000000-0000-0000-0000-000000000003/access_as_user"
  ],
  healthCheckUrl: "/health"
};
