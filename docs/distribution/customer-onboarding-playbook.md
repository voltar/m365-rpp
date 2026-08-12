# Customer Onboarding Playbook

Revision: **EO-500R** (2026-07-20). Original: EO-500 v1 (2026-07-18).

This playbook describes the repeatable onboarding path for a new customer tenant. It is tenant-agnostic and intended to be filled in with the parameter sheet in [customer-onboarding-parameter-sheet.md](customer-onboarding-parameter-sheet.md).

## 1. Purpose

The onboarding package standardizes deployment, provisioning, verification, and handover for the RPP solution so each customer installation follows the same sequence and produces the same evidence.

## 2. Inputs

Before you start, complete the parameter sheet with the tenant-specific values:

- Tenant ID and tenant name
- API app registration values and audience
- Azure Web App resource group and app name
- SharePoint site URL
- Teams package and manifest identifiers
- Approval mode and flow URL if the tenant uses Power Automate handover

## 3. Prerequisites

- Azure CLI authenticated against the target subscription
- .NET SDK installed locally for backend publish and migrations
- Node.js / npm installed for the frontend build
- SharePoint site owner access or higher for list provisioning
- Teams admin access for app package upload or update
- Required Entra app registrations and delegated permissions prepared
- **`scripts/rpp-config.psd1` updated with the tenant-specific values** (AppId, ObjectId, ApiDomain, SharePointSiteUrl) — this is the single source of truth for all PowerShell provisioning scripts

### 3.1 Tenant Configuration (rpp-config.psd1)

Before running any provisioning or Entra configuration scripts, update `scripts/rpp-config.psd1` with the tenant-specific values from the parameter sheet:

```powershell
@{
    AppId              = '<api-client-id>'
    ObjectId           = '<entra-app-object-id>'
    ApiDomain          = '<app-service-name>.azurewebsites.net'
    SharePointSiteUrl  = 'https://<tenant>.sharepoint.com/sites/<site>'
    GraphResourceAppId = '00000003-0000-0000-c000-000000000000'  # constant
    # Teams/M365 preauthorized app IDs are constants, do not change
}
```

All scripts (`configure-entra-sso.ps1`, `configure-graph-planning.ps1`, `configure-graph-approvals.ps1`, `configure-outlook-sync.ps1`, `provision-sharepoint-lists.ps1`) read from this file automatically. They also respect environment variable overrides (`$env:RPP_APP_ID`, `$env:RPP_OBJECT_ID`, `$env:RPP_API_DOMAIN`) for CI/CD scenarios. Use `-Profile example` with the Host Europe config file (`rpp-config-example.psd1`) when installing that edition.

## 4. Installation Runbook

### 4.1 Publish and Deploy the API

Build the deployable API+SPA artefact with the EO-427 packaging path only. Do **not** hand-roll `dotnet publish` + zip — that path shipped mixed/stale frontends in the field. Full order: [complete-release-build.md](../deploy/complete-release-build.md).

1. Ensure `release.json` and `teams-app-package/manifest.json` state the same version (manifest `id` unchanged).
1. Package for the target environment (`--env` is mandatory):

```powershell
npm run package:api -- --env prod
# Host Europe / Voltar:
# npm run package:api -- --env hosteurope
```

Output: `publish/RppWebApi.zip` (API + SPA). This does **not** build the Teams catalog ZIP.

1. Deploy to the Azure Web App (`--clean true` removes leftovers from earlier deployments):

```powershell
az webapp deploy -g <resource-group> -n <app-service-name> --type zip --src-path publish/RppWebApi.zip --clean true
```

Host Europe Kestrel: follow [kestrel-hosteurope.md](../deploy/kestrel-hosteurope.md) after `--env hosteurope`.

1. Configure the required app settings in Azure App Service (or `kestrel.env` on Host Europe):

- `ConnectionStrings__DefaultConnection`
- `AzureAd__TenantId`
- `AzureAd__ClientId`
- `AzureAd__ClientSecret` — Entra secret **Value**, never the Secret **ID**
- `AzureAd__Audience`
- `ApiSettings__RequireAuthentication=true`
- `ApiSettings__AllowedOrigins__0=<frontend-origin>`

### 4.1a Entra SSO and Graph application permissions

1. Configure Teams SSO (Application ID URI, `access_as_user`, preauthorized Teams clients):

```powershell
./scripts/configure-entra-sso.ps1
# Host Europe / Voltar edition:
./scripts/configure-entra-sso.ps1 -Profile example
```

1. Grant Graph **application** permissions required for planning (team picker, memberships, display names). Without these, personal scope fails to load teams and the timeline shows **Unknown User**:

```powershell
./scripts/configure-graph-planning.ps1
./scripts/configure-graph-planning.ps1 -Profile example
./scripts/configure-graph-planning.ps1 -Profile example -VerifyOnly
```

Permissions added and consented: `GroupMember.Read.All`, `Group.Read.All`, `User.Read.All` (all **Application**).  
Details and symptom table: [kestrel-hosteurope.md §4.1](../deploy/kestrel-hosteurope.md), [deployment.md — Graph settings](../deploy/deployment.md).

1. Restart the API process after secret rotation or new Graph grants so in-process Graph caches clear.

### 4.2 Database schema (SQL Server / PostgreSQL)

Schema handling depends on `Planning:Provider`. Migrations are **not** a separate production CLI step for the normal SQL path.

**SQL Server (`sql`)**

1. Ensure the target connection string is set in app settings / user secrets before the API starts.
1. Ensure the app identity has DDL rights (`db_ddladmin` or equivalent) so startup can apply schema.
1. Deploy the API artefact from `npm run package:api` (see [complete-release-build.md](../deploy/complete-release-build.md)). On startup the API runs `Database.Migrate()` when a connection string is configured.
1. Confirm via `GET /health` (version, planning store, database host/name when relational) and a simple planning call.
1. Optional local/dev only: `dotnet ef database update --project RppWebApi/RppWebApi.csproj` against a **dev** database to validate a new migration before packaging — not the preferred production apply path.

**PostgreSQL (`postgres`)**

1. Empty databases get tables at startup (`CreateTables`).
1. Existing databases are **not** upgraded via EF `Migrate()` yet (ADR-007). Plan upgrades explicitly (recreate non-prod, or a documented manual process).

### 4.3 Provision SharePoint Lists (only for `sharepoint` provider tenants)

Skip this section when the tenant runs `planningDataSource: "api"` (the current default architecture, API + SQL). It applies only when the tenant uses the client-side `sharepoint` provider.

1. Validate the site and list schema before first write access:

```powershell
./scripts/provision-sharepoint-lists.ps1 -ValidateOnly
```

1. Provision the lists when validation passes:

```powershell
./scripts/provision-sharepoint-lists.ps1
```

`SiteUrl` and `ClientId` are read from `rpp-config.psd1` automatically. Override them explicitly if needed: `-SiteUrl <url> -ClientId <id>`.

1. Re-run validation after provisioning to confirm there is no type drift.

### 4.4 Upload or Update the Teams Package

`npm run package:api` produces **only** `publish/RppWebApi.zip` (API + SPA). The Teams catalog/sideload package is a **separate** artefact under `teams-app-package/` (for example `rpp-teams-app-v<version>.zip`).

1. Ensure `teams-app-package/manifest.json` `version` matches root `release.json`, and keep `manifest.id` **unchanged** across releases so Teams updates in place.
1. Build or refresh the Teams ZIP per the Teams Package section in [deployment.md](../deploy/deployment.md) (archive root layout, forward slashes, no PowerShell `Compress-Archive`).
1. Upload that ZIP in Teams Admin Center or Developer Portal.
1. Keep repo `teams-app-package/manifest.json` identical to the uploaded package (extract from the ZIP after upload if needed — the release consistency gate reads this file).
1. A package with a **different** manifest id installs as a separate, parallel app — do not rotate the id for a normal release.
1. Reinstall the app in the customer tenant if the package was previously cached.
1. If Outlook deep links are used, set `OutlookSync__TeamsAppId` to the installed app id.
1. Note for Developer Portal imports: the portal flags Application ID URIs longer than 100 characters (Azure default domains exceed this). The manifest schema allows 2048 characters — the warning can be ignored; direct upload to Teams validates against the real schema.

### 4.5 Runtime Configuration Check

1. Confirm `public/config/runtime-config.js` (or the deployed equivalent) contains the correct values for:

- `planningDataSource`
- `planningMembershipSource`
- `apiBaseUrl`
- `apiAccessTokenScopes`
- `sharePointSiteUrl`
- `approvalMode`

1. Confirm the browser origin is allowed by the API CORS policy.
1. Confirm the Teams manifest and runtime API audience are aligned.

## 5. Approval Flow Handover

The approval handover depends on the tenant mode. **The Graph provider (5.1) is the default since EO-410** — it needs no Power Automate license. Use the Power Automate path (5.2) only for tenants that explicitly require it and hold Premium licensing.

### 5.1 Graph Provider Handover (default)

Use this path when the tenant uses the API-backed Graph approval provider (`GraphApprovals:Enabled=true`, the appsettings default).

1. Follow the Graph setup steps in [approval-flow-setup.md](../deploy/approval-flow-setup.md).
1. Run `scripts/configure-graph-approvals.ps1` if the delegated approval scope is not yet granted. The script reads the AppId from `rpp-config.psd1`. The admin-consent grant must list **all** delegated scopes including `ApprovalSolution.ReadWrite` — a grant written before the scope was added silently drops it (AADSTS65001).
1. Verify the approval solution permission is present in Entra.
1. Confirm decision sync on refresh and linked absence writeback. Decision values from the beta API arrive as `Approve`, not `Approved` — the tolerant mapping in the API handles this; do not "fix" it.

### 5.2 Power Automate / EO-207 Handover (legacy alternative)

Use this path only when the tenant requires a Power Automate-based approval flow (Premium licensing needed).

1. Follow [approval-flow-setup.md](../deploy/approval-flow-setup.md).
1. Build the flow manually against the blueprint `rpp-approval-flow-eo410.json` (in the release package). Do **not** import `rpp-approval-flow.json` as a package — the Power Automate importer rejects it; it serves as a structural reference only.
1. Store the callback secret outside source control.
1. Verify the `VacationRequests` writeback path and the approval reference fields.
1. Confirm the approver surface in Microsoft Teams Approvals.

## 6. Verification Checklist

Run the following checks in the target tenant and record the result:

- `GET /health` returns 200
- Teams SSO token acquisition succeeds
- Planning snapshot loads without errors
- Timeline shows the expected resources and team groups
- Team Admin opens and loads managed teams
- Vacation request creation succeeds
- Approval submission reaches the configured approval provider
- Approval decision writes back correctly
- Teams app opens in desktop and mobile clients

## 7. Operational Handover

Document the following ownership items before closeout:

- Secret rotation owner and cadence
- Azure App Service update path
- Database migration owner
- SharePoint provisioning owner
- Approval-flow maintenance owner
- Incident contact for failed approvals or auth failures
- Rollback source artefact and restore procedure

## 8. Acceptance Evidence

Attach the following evidence to the customer handover package:

- Filled parameter sheet
- Deployment notes
- Migration confirmation
- SharePoint provisioning validation output
- Teams package version used for rollout
- Verification checklist with pass/fail status
- Named operational owners

## 9. Reference Commands

Release order: [complete-release-build.md](../deploy/complete-release-build.md).

- `npm run package:api -- --env prod` — deployable API+SPA ZIP (`publish/RppWebApi.zip`); also `--env hosteurope`, `--env mock`
- `npm run build:deployment` — optional stricter frontend gates (not a substitute for `package:api`)
- `az webapp deploy -g <resource-group> -n <app-service-name> --type zip --src-path publish/RppWebApi.zip --clean true`
- `dotnet test RppWebApi.Tests`
- `dotnet ef migrations add <Name> --project RppWebApi/RppWebApi.csproj` — create migration during development (SQL)
- `dotnet ef database update --project RppWebApi/RppWebApi.csproj` — optional **local/dev** apply only; production SQL uses `Database.Migrate()` at API startup
- `./scripts/provision-sharepoint-lists.ps1` (only `sharepoint` provider tenants; `SiteUrl`/`ClientId` from `rpp-config.psd1`)
- `./scripts/configure-entra-sso.ps1` (AppId/ObjectId from `rpp-config.psd1`)
- `./scripts/configure-graph-planning.ps1` (planning Graph application permissions)
- `./scripts/configure-graph-approvals.ps1` (AppId from `rpp-config.psd1`)
- `./scripts/configure-outlook-sync.ps1` (AppId from `rpp-config.psd1`)

Do **not** hand-roll `dotnet publish` + zip for production artefacts; that path produced field defects and is superseded by `package:api` (EO-427).

## 10. Revision History

| Revision | Date | Changes |
| --- | --- | --- |
| EO-500 | 2026-07-18 | Initial playbook v1 |
| docs | 2026-08-12 | Align §4.1 packaging with `package:api`, migrations (startup `Migrate()`), Teams package (not from `package:api`), reference commands with EO-427 checklist |
| EO-500R | 2026-07-20 | Deploy zip via Python zipfile + `--clean true` (Compress-Archive breaks Kudu on Linux); publish-folder cleanup step; Teams package reference updated to v4.0.3 + Dev Portal URI note; SharePoint provisioning marked conditional; Graph approval provider promoted to default path, Power Automate marked legacy (importer rejects the legacy flow package); parameter sheet: domain-form Application ID URI |
