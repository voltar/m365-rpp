# Deployment

EO-302 defines the deployment baseline for reproducible Version 1.0 releases.

**Release order (checklist):** [complete-release-build.md](./complete-release-build.md) — version → code/schema → texts/docs → one `package:api` → deploy → Help re-index → smoke.

## Build

Production artefacts are created from source control with:

```bash
npm run build
```

The build performs TypeScript validation, creates the Vite production bundle, copies `public/` verbatim into `dist/`, and writes release metadata to `dist/release.json`.

For a deployment-ready build plus validation:

```bash
npm run build:deployment
```

`npm run build` and `npm run build:deployment` produce a **frontend bundle, not a deployable artefact**: the runtime configuration in `dist/config/runtime-config.js` is still the mock development default. The deployable artefact comes from `npm run package:api` below, which stamps the chosen environment into it.

## Release Version (EO-427)

`release.json` at the repository root is the one place the release label is written by hand:

```json
{ "version": "4.0.7" }
```

Everything else derives from it or is validated against it:

| Surface | How it gets the version |
| --- | --- |
| `RppWebApi` assembly → `/health` | `RppWebApi.csproj` reads `release.json` during evaluation; a hardcoded `<Version>` fails the build |
| `dist/config/runtime-config.js` → Info tab | stamped by `scripts/stamp-runtime-config.mjs` during packaging |
| `dist/release.json` | written by `scripts/write-release-metadata.mjs` |
| `teams-app-package/manifest.json` | hand-edited on package upload, **checked** by the consistency gate |

Two things are deliberately *not* derived from it:

- **`package.json` `version`** identifies the npm package and stays at `0.1.0`. It appears in release metadata as `packageVersion`, next to `releaseVersion`.
- **The Info page badge** (`infoPageBadge`, e.g. "Release Candidate 5") is an end-user communication label, not a version field. It is localized and maintained independently on purpose — users are told a name they can repeat, not `4.0.5`.

To raise the release: edit `release.json`, edit `version` in `teams-app-package/manifest.json` to match (keeping `id` unchanged, see *App Identity* below), and package. The gate fails when they disagree.

`sourceRevision` is never hand-written; it is `git rev-parse --short=12 HEAD` at packaging time.

## Packaging

One command produces the deployable API artefact, with the target environment chosen explicitly:

```bash
npm run package:api -- --env prod
```

It runs, in order, and stops at the first failure:

1. `npm run build`
2. stamp `dist/config/runtime-config.js` from `public/config/runtime-config-PROD.js`, adding `releaseVersion` and `sourceRevision`, and remove the other templates from `dist/`
3. `validate-deployment`, `validate-security`, `validate-release-consistency`
4. clean mirror of `dist/` into `RppWebApi/wwwroot/`, then a byte-for-byte comparison of both trees
5. `dotnet publish` with `-p:SourceRevisionId=<commit>`
6. ZIP via `scripts/make-zip.py`

`--env` is mandatory. The template is `public/config/runtime-config-<ENV>.js`; `mock` and `prod` exist today. `public/config/runtime-config.js` is the development default only — it stays on mock so `npm run dev` cannot target a tenant by accident, and packaging never reads it.

The individual steps remain available as `npm run stamp:runtime-config -- --env prod` and `npm run validate:release` for diagnosis.

## Graph Settings Are Deployment Configuration (EO-428)

`Graph:TeamGroupId` and `Graph:TeamName` are empty in committed `appsettings.json` and must be set
per deployment, or left unset. They are **not** a default team: since EO-428 no request falls back
to them when the caller's team context is unknown, because substituting a team produced a permission
error for a legitimate user in the field. `TeamGroupId` remains the team used when a call names no
team explicitly (for example a display-name lookup); leaving it empty is safe.

The Graph **application** permissions the API needs for planning (client credentials /
`GetAccessTokenForAppAsync`) are:

| Permission | Purpose |
| --- | --- |
| `GroupMember.Read.All` | Group members/owners and `/users/{id}/memberOf` (EO-428 personal team picker / `GET /api/planning/my-teams`) |
| `Group.Read.All` | Group display names (EO-456 default team name, header badge) |
| `User.Read.All` | Member display names, UPN, profile photos, and **companyName / officeLocation** (organisation & location) — without this the UI shows **Unknown User** and empty Firma/Standort |

Provision and verify with `.\scripts\configure-graph-planning.ps1` (`-Profile example` on Host Europe).
That script is separate from `configure-entra-sso.ps1` (API scope only) and from
`configure-graph-approvals.ps1` (delegated Approvals).

**Client secret pitfall:** Entra Certificates & secrets shows a **Secret ID** and a **Value**.
`AzureAd__ClientSecret` must be the **Value**. The Secret ID is not a credential; using it breaks
app-only Graph token acquisition while Teams SSO user tokens (and App Admin) can still work.

See also [kestrel-hosteurope.md §4.1](./kestrel-hosteurope.md) (Host Europe / Voltar runbook and
symptom table).

## Runtime Configuration

Environment-specific values are externalized in:

```text
dist/config/runtime-config.js
```

Deployment automation may replace this file without rebuilding the application. The browser reads `window.__RESOURCE_PRESENCE_PLANNER_CONFIG__` before the React bundle starts.

Supported values:

- `environmentName`
- `planningMembershipSource` (`mock` | `graph`)
- `planningDataSource` (`mock` | `sharepoint` | `api`)
- `approvalMode` (`mock` | `m365`)
- `standaloneBrowserUsesMock` (`true` | `false`, optional; default `false`)
- `sharePointSiteUrl`
- `apiBaseUrl`
- `apiAccessTokenScopes`
- `healthCheckUrl`
- `releaseVersion`
- `sourceRevision`

Build-time `VITE_` variables remain supported as fallbacks for local development and SPFx packaging scenarios.

### Resolution Order (EO-401 / ADR-003)

Effective configuration is resolved per value with fixed precedence, highest first:

1. Local override (`localStorage`, set via the App Admin Center; current browser only)
2. Deployment configuration (`config/runtime-config.js`)
3. Build-time `VITE_` variables
4. Default (`mock`)

A higher-precedence source overrides in both directions (for example, a runtime `mock` beats a build-time `sharepoint`). Invalid values are logged and fall through to the next source. The App Admin Center (`/administration/app-admin`) displays the origin of every effective value and can export a ready-to-deploy `runtime-config.js`.

### Standalone browser mock demo (same artefact as Teams)

Some public hosts (e.g. Host Europe / `rpp.example.com`) should show the **mock product** when someone opens the URL in a normal browser, while Microsoft Teams keeps the real **API + m365** providers. That is one deployment config, not two builds:

```js
window.__RESOURCE_PRESENCE_PLANNER_CONFIG__ = {
  planningDataSource: "api",
  planningMembershipSource: "graph",
  approvalMode: "m365",
  standaloneBrowserUsesMock: true,
  // apiBaseUrl, apiAccessTokenScopes, …
};
```

Behaviour:

| Session | Effective providers |
|---------|---------------------|
| Microsoft Teams tab (`detectHostKind() === "teams"`) | deployment values (`api` / `graph` / `m365`) |
| SharePoint embed | deployment values (unchanged) |
| Standalone browser (`detectHostKind() === "browser"`), including “open link from Teams chat” | `mock` / `mock` / `mock` when the flag is `true` |

The mock switch keys off **host kind** (ADR-004), not “top-level frame” alone. Teams desktop often runs the tab as a top-level WebView (`self === top`); that must still keep API providers. Host detection uses query (`?host=teams` on the Teams `contentUrl`), `ancestorOrigins`, and Teams client user-agent — not chat referrers or `window.microsoftTeams` (our bundle may set that outside Teams). Local overrides still win. Origin badge in App Admin: **Standalone browser (mock demo)**.

Host Europe packages set `contentUrl` to `https://rpp.example.com/?host=teams` and leave `websiteUrl` as the plain origin (browser/demo). The packaging template enables the flag (`public/config/runtime-config-HOSTEUROPE.js`).

#### Local mock override without App Admin (developer console)

Use this only when `standaloneBrowserUsesMock` is **not** set and you still need mock data in one browser profile. Standalone browser sessions against an **API** deployment have no Teams SSO and no MSAL login today (`browserHostAdapter` → auth unavailable).

Key and envelope shape are defined in `src/infrastructure/deployment/runtimeConfig.ts` (`resourcePresencePlanner.runtimeConfig.override`, version `1`).

On the target origin, open DevTools → Console:

```js
// Force mock/demo data for this browser only (no server change, no M365 login)
localStorage.setItem(
  "resourcePresencePlanner.runtimeConfig.override",
  JSON.stringify({
    version: 1,
    value: {
      planningDataSource: "mock",
      planningMembershipSource: "mock",
      approvalMode: "mock"
    }
  })
);
location.reload();
```

Clear the override and return to the deployment config:

```js
localStorage.removeItem("resourcePresencePlanner.runtimeConfig.override");
location.reload();
```

Notes:

- Affects **only this browser profile** on that origin; Teams tabs and other users are unchanged.
- Does **not** bypass API auth for real data — it switches the client to the in-app mock repositories.
- Prefer `standaloneBrowserUsesMock: true` on public demo hosts; prefer App Admin when you already have an authenticated session; the console path is a developer escape hatch.

### API Provider Notes

- `apiBaseUrl` must be HTTPS; `http` is accepted for `localhost` / `127.0.0.1` development only.
- `apiAccessTokenScopes` must point to the Entra delegated scope exposed by the protected API, for example `api://<api-client-id>/access_as_user`.
- The connection test probes `<apiBaseUrl>/health`.
- When `planningDataSource: "api"` is enabled, the deployment CSP in `index.html` must include the API origin in `connect-src`, otherwise browser requests are blocked.
- Until the RPP Web API ships (ADR-003 Phase 2B), the `api` source renders a recoverable "not available" bootstrap state.

### EO-405 Release Gate

Before any shared or public deployment with `planningDataSource: "api"`:

1. Confirm that `config/runtime-config.js` contains the correct `apiBaseUrl` and `apiAccessTokenScopes` values for the target tenant.
2. Confirm that the Teams package deployed to the same tenant contains matching `webApplicationInfo.id` and `webApplicationInfo.resource` values.
3. Confirm that the target API environment runs with authentication enabled and rejects unauthenticated planning requests.
4. Perform one end-to-end verification inside Microsoft Teams against the target environment before releasing broadly.

## Release Metadata

Each build writes:

```text
dist/release.json
```

The metadata includes the package version, release version, source revision, deployment environment, and build timestamp. Deployment records should retain this file with the deployed artefact for traceability.

## Validation

Deployment validation checks:

- `dist/index.html` exists
- JavaScript and CSS chunks exist under `dist/assets`
- runtime configuration is present, and its provider has the values it needs (`apiBaseUrl` for `api`, `sharePointSiteUrl` for `sharepoint`)
- release metadata is present and valid JSON
- static health resource is present and valid JSON

```bash
npm run validate:deployment
```

Release consistency validation (EO-427 FR-427.5) additionally asserts that all four version surfaces state the same release, and that the stamped revision is the commit being packaged. It **fails** the packaging run rather than warning:

```bash
npm run validate:release
```

It reads the runtime configuration by evaluating it in a sandbox, not by matching on text — the stamped file is generated with JSON quoting, so substring checks against `planningDataSource: "api"` would silently never match again.

## Rollback

Rollback should restore the previously deployed immutable `dist` artefact, including its matching `config/runtime-config.js` and `release.json`. Rollback must not require rebuilding from source.

## Out Of Scope

EO-302 does not provision infrastructure, select a cloud platform, implement blue/green deployments, automate production approvals, or introduce container orchestration.

## Local Teams loop (Dev Tunnel)

To test real Teams behaviour (SSO, host context, EO-456 seed) against code on your machine
without ZIP-deploying to Azure every time, see **[local-teams-loop.md](./local-teams-loop.md)**.
That path uses Microsoft Dev Tunnel + a separate sideload app (“RPP Local”); the shared
`rpp-dev` package stays on App Service.

## Azure Web App Deployment (Linux / .NET)

For the current RC deployment target (`rpp-dev`), use ZIP deploy to Azure App Service.

### Build The Artefact

```bash
npm run package:api -- --env prod
```

That is the whole build (see *Packaging* above). The steps below describe what it does and why, for diagnosis — running them by hand is what produced the 2026-07-26 field defect and is no longer the documented path.

**Publish output location.** `publish/` at the repository root is the output; both `publish/` and a stray `RppWebApi/publish/` are deleted first. A publish folder inside the project directory is worse than stale output: the Web SDK globs its configuration files as content items, so they land nested as `publish/RppWebApi/publish/…` inside the deploy zip. The csproj excludes `publish/**` defensively, but the folder should not exist in the first place.

**Commit stamp.** `-p:SourceRevisionId=<commit>` makes .NET append `+<sha>` to the InformationalVersion, which is the form `HealthController.TryExtractSourceRevision` parses; without it `/health` reports no usable revision.

**Development settings.** `appsettings.Development.json` is excluded from the publish output (`CopyToPublishDirectory="Never"`). It carries `ApiSettings:RequireAuthentication=false`, which registers `DevelopmentAllowAnonymousHandler` and makes every `[Authorize]` requirement succeed — it must never reach a deployed environment (EO-405). Local `dotnet run` is unaffected.

**Frontend mirror.** The API serves the SPA from its own `wwwroot`, a copy of `dist/`. The target is deleted before copying, otherwise hashed assets from earlier builds survive and the deployment mixes bundles; packaging then compares both trees file by file and refuses to continue on any difference. Skipping this step is how a stale artefact once shipped with `planningDataSource: "mock"`.

**ZIP.** Do **not** use PowerShell `Compress-Archive`: it stores backslash paths in the archive, which breaks Kudu deployment on Linux App Service (`failed to stat wwwroot\assets\...`). Packaging uses `scripts/make-zip.py`, because Python's zipfile normalizes to forward slashes.

### Deploy ZIP

```bash
az webapp deploy --resource-group RPP-DEV --name rpp-dev --src-path ./publish/RppWebApi.zip --type zip --clean true
```

### Required Azure App Settings

Secrets never travel inside the deploy zip — they live in the App Service settings, which survive every deployment; see [secret-management.md](../projectmanagement/secret-management.md) for the full model. Set these in Web App -> Environment variables:

- `ConnectionStrings__DefaultConnection`
- `AzureAd__TenantId`
- `AzureAd__ClientId`
- `AzureAd__ClientSecret`
- `AzureAd__Audience`
- `ApiSettings__RequireAuthentication=true`
- `ApiSettings__AllowedOrigins__0=https://rpp-api.example.com`
- `ASPNETCORE_ENVIRONMENT=Production`

Must **not** be set in App Service: `ApiSettings__EnableDeveloperTools`, `ApiSettings__SeedDevelopmentData`. Both default to `false`; setting either to `true` re-enables developer tooling or demo-data seeding against the deployed database.

#### `ASPNETCORE_ENVIRONMENT` Must Be `Production`

`Development` is not a harmless label. The RC5 deployment ran with `ASPNETCORE_ENVIRONMENT=Development`, which served `/swagger` publicly, enabled the developer exception page, and seeded test data into `rpp-db-dev` on every restart.

Environment name alone is now no longer sufficient to enable any of that — each behaviour additionally requires an explicit opt-in, so a mis-set environment variable cannot open the app up on its own:

| Behaviour | Requires |
| --- | --- |
| Swagger UI + `UseDeveloperExceptionPage()` | `Development` **and** `ApiSettings:EnableDeveloperTools=true` |
| `DataSeeder.SeedAsync` | `Development` **and** `ApiSettings:SeedDevelopmentData=true` |
| `ApiSettings:RequireAuthentication=false` (authorization bypass) | `appsettings.Development.json`, which is excluded from the publish output |
| `Database.Migrate()` | a configured `ConnectionStrings:DefaultConnection` — runs in **every** environment |

Both opt-in flags default to `false` in `appsettings.json` and must never be set in App Service. `appsettings.Development.json` sets `EnableDeveloperTools=true` for local work and leaves `SeedDevelopmentData=false`, so seeding is always a deliberate act.

Migrations were deliberately decoupled from the environment gate: they previously shared a single `IsDevelopment()` check with seeding, which meant switching to `Production` would have silently stopped applying them and let the schema drift. The App Service identity already holds `db_ddladmin` for exactly this purpose (see below). When no connection string is configured the startup logs a warning and skips migrations instead of failing.

Verified on the built artefact (2026-07-26): started with `ASPNETCORE_ENVIRONMENT=Development` from the publish output, `/swagger/index.html` and `/swagger/v1/swagger.json` answered 404, `/api/planning/access` stayed 401, the log reported developer tools off, and no seeding ran.

**Set `Production` only after deploying an artefact that contains this decoupling.** On older builds, migrations are gated on `Development` and switching the environment stops them.

#### Local Runs In `Development` Hit The Deployed Database

`ASPNETCORE_ENVIRONMENT=Development` makes the host load .NET User Secrets from the developer machine, and `ConnectionStrings:DefaultConnection` there points at `rpp-app-dev-server.database.windows.net` / `rpp-db-dev` with a DDL-capable login. A local `dotnet run` — or a local start of the published artefact — therefore runs `Database.Migrate()` against the **deployed** database, not a local one. Verified accidentally on 2026-07-26; no migration was pending, so nothing changed, but a pending one would have been applied.

Before running locally in `Development`, either point the User Secret at a local database or expect every migration to land on the shared one. Seeding cannot happen unnoticed anymore because `SeedDevelopmentData` defaults to `false`.

### Microsoft 365 Application Permissions — Access Policy Is Mandatory

Every app-only Graph permission RPP holds against mailboxes or calendars is **tenant-wide by
default**. Granting one without scoping it means the API may read and write that resource in
every mailbox in the organisation. The Entra grant on its own is therefore never a finished
state — it is half of a two-part step, and the second half lives in Exchange Online.

| Permission | Granted for | Scope control | Script |
| --- | --- | --- | --- |
| `GroupMember.Read.All`, `Group.Read.All`, `User.Read.All` (app-only) | Planning memberships, EO-428 team picker, display names/photos | Directory-wide (no Exchange AAP); least privilege is the app registration itself | `scripts/configure-graph-planning.ps1` |
| `Calendars.ReadWrite` (app-only) | EO-414 outbound Outlook sync | Application Access Policy over a group of planning members | `scripts/configure-outlook-sync.ps1` |
| `Mail.ReadWrite` (app-only) | EO-424 inbound mailbox sync | Application Access Policy over a group containing only the shared absence mailbox | `scripts/configure-mailbox-sync.ps1` |

Directory permissions in the first row do **not** use Exchange Application Access Policies. Mailbox/calendar rows below still require the two-part grant + AAP process.

**Deployment checklist for either feature:**

1. Grant the application permission and admin consent.
2. Verify the delegated grants still contain `ApprovalSolution.ReadWrite` — `admin-consent`
   rewrites the grant and has dropped a freshly added scope before (EO-410 rollout lesson).
3. Create the scope group and the `RestrictAccess` Application Access Policy.
4. **Verify against two mailboxes**: the intended one and an unrelated control. Both reporting
   the same result means the policy is not in effect.
5. Only then set the feature's `__Enabled=true` app setting.
6. Re-check after any change to the group, the policy, or the app registration.

Steps 3 to 5 are automated and, importantly, **ordered** in `configure-mailbox-sync.ps1`: it
refuses to run step 5 unless step 4 passes. Enabling a sync while the permission is still
unscoped is the failure nobody notices, because everything works — it just works on far more
mailboxes than intended.

**Repository script sequence (deployment checklist):**

1. `./scripts/configure-entra-sso.ps1`  
   Creates/aligns API SSO scope (`access_as_user`) and preauthorized Teams/M365 clients.
2. `./scripts/configure-graph-planning.ps1`  
   Grants required Graph application permissions for planning (`GroupMember.Read.All`, `Group.Read.All`, `User.Read.All`).
3. `./scripts/configure-graph-approvals.ps1` *(optional, Graph Approvals tenants)*  
   Grants delegated `ApprovalSolution.ReadWrite`.
4. `./scripts/configure-outlook-sync.ps1` *(optional, EO-414 outbound Outlook sync)*  
   Grants `Calendars.ReadWrite` and verifies grant state.
5. `./scripts/configure-mailbox-sync.ps1` *(optional, EO-424 inbound mailbox sync)*  
   Grants `Mail.ReadWrite`, creates/verifies Exchange Application Access Policy, and only then enables the feature.

Always re-check delegated grants after admin consent steps to ensure `ApprovalSolution.ReadWrite` remains present.

Two traps found in the field (2026-07-30):

- **Propagation.** Exchange needs up to an hour. Immediately after creating the policy both
  mailboxes still report access; that is expected, not a failure. Re-run the verification later.
- **Localization.** `Test-ApplicationAccessPolicy` returns `AccessCheckResult` in the tenant
  language — a German tenant answers `Gewährt`, not `Granted`. Never compare against English
  literals in automation; compare the two mailboxes against **each other** and require a
  policy to exist.

### Database Permissions (Azure SQL with Managed Identity)

The App Service Managed Identity must have **DDL permissions** on the target database so EF Core can apply migrations at startup. The identity needs at minimum these database roles:

| Role | Purpose |
|------|---------|
| `db_datareader` | Read planning data |
| `db_datawriter` | Write planning data |
| `db_ddladmin` | Execute EF Core migrations (`CREATE TABLE`, `ALTER TABLE`, etc.) |

If the Managed Identity lacks `db_ddladmin`, the container will crash with `SqlException: Cannot find the object … because it does not exist or you do not have permissions` (SQL error 1088) — the error message is misleading; the real cause is insufficient DDL rights.

**Grant DDL rights** (run once per database, requires Entra Admin on the SQL Server):

```sql
ALTER ROLE db_ddladmin ADD MEMBER [<app-service-name>];
```

Verify with:

```sql
SELECT DP2.name AS DatabaseRole, DP1.name AS DatabaseUser
FROM sys.database_role_members AS DRM
RIGHT OUTER JOIN sys.database_principals AS DP1 ON DRM.member_principal_id = DP1.principal_id
LEFT OUTER JOIN sys.database_principals AS DP2 ON DRM.role_principal_id = DP2.principal_id
WHERE DP1.name = '<app-service-name>';
```

For `rpp-dev` the command is:

```powershell
$token = az account get-access-token --resource https://database.windows.net --query accessToken -o tsv
Invoke-SqlCmd -AccessToken $token -ServerInstance rpp-app-dev-server.database.windows.net -Database rpp-db-dev -Query "ALTER ROLE db_ddladmin ADD MEMBER [rpp-dev]"
```

### Startup Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Container exit code 134, `SqlException 1088` | Missing `db_ddladmin` role | Grant DDL rights (see above) |
| Container exit code 134, `Invalid column name` | Missing EF Core migration | Generate and apply migration locally, redeploy |
| Container exit code 134, `Cannot resolve scoped service` | DI scope mismatch (singleton injecting scoped) | Use `IServiceScopeFactory` in `IHostedService` |
| Site fails to start within 10 min | Serverless DB cold start | Wait 2 min, redeploy; DB is now warm |
| `Application Error` on `/health` | App still starting or crashed | Check Kudu Docker logs at `https://<app>.scm.<region>.azurewebsites.net/api/logs/docker` |

## Teams Package (RC)

Current release artifact for upload in Teams Admin Center / Developer Portal:

- `teams-app-package/rpp-teams-app-v4.0.7.zip` — app id `00000000-0000-0000-0000-000000000013`, `manifestVersion` 1.27

`rpp-teams-app-v4.0.5.zip` is kept alongside it for rollback. 4.0.7 was produced from it by replacing `manifest.json` and nothing else, reusing the container profile of a package the tenant demonstrably accepted.

`teams-app-package/manifest.json` mirrors the **RC** package, and it is the only manifest the release consistency gate reads.

### Demo Package — A Deliberate Second App Identity

`rpp-teams-app-v1.0.0-demo.zip` is the original pure-mock demo, kept so that version cannot be lost. It is **not** a release artefact and is outside the version chain:

- App id `8d21a8db-1c49-4f45-8e8d-5a3c30bbf877` — different from the RC app on purpose. This is the one case where a different id is correct: a demo must install *next to* the real app, not replace it. The "keep the id stable" rule above governs releases of one app, not the boundary between two.
- No `webApplicationInfo`, so no SSO — consistent with an installation that never talks to a backend.
- `contentUrl` is `https://rpp.example.com`, the public demo site, which runs on the mock provider.
- `manifestVersion` 1.19 and three entries only (manifest plus two icons), no locale files.

Do not bump its version with the release, and do not point it at the tenant deployment.

`teams-app-package/manifest.json` is kept identical to the manifest inside the current release artifact, so the repository always states what was actually shipped. The release consistency gate reads that file and fails when its `version` disagrees with `release.json` — which is why it must be extracted from the ZIP again after every package upload.

### App Identity: Keep The Id, Bump The Version

**Keep `manifest.id` stable across releases and only increase `version`.** Teams then updates the app in place: the Admin Center shows the new version, and existing installations, pinned tabs, and tab configuration survive.

Changing the id creates an **additional** catalog entry instead of an update. Every RC up to 4.0.5 used a fresh id (`e95f6006-…`, `ba5249b8-…`, `d65eba27-…`), which is why the Admin Center kept showing an older version while a newer package existed — the newer package was simply a different app. Do not delete and re-upload to publish a new version; deleting a catalog entry removes the app from every team it is installed in.

### Known Manifest Incompatibility: `staticTabs[].context`

**Do not add `staticTabs[].context`.** The field is schema-valid, but Teams rejects the custom-app upload when it is present.

Verified on 2026-07-26 by controlled test: a package identical to the accepted 4.0.5 release except for `context: ["personalTab","channelTab","teamLevelApp"]` (with a fresh app id and a higher version) failed, while the release itself was accepted. `personalTab` and `channelTab` carry no information beyond `scopes: ["personal","team"]`, so nothing is lost by omitting the field. Whether `teamLevelApp` alone is responsible was not determined.

`developer.mpnId` was ruled out as a cause but is only meaningful with a registered Partner Center id; it is omitted from the release package.

### ZIP Container Requirements

The package must mirror the container profile of a known-good artifact, not only be structurally valid:

- `manifest.json`, icons, and locale files at the **archive root** — no directory entries, no wrapping folder.
- Forward slashes only. Do **not** use PowerShell `Compress-Archive` (backslash paths, see the API deploy section above).
- `external_attr = 0` on every entry. Python's `zipfile.writestr()` sets `0o600 << 16`, i.e. Unix mode bits without the regular-file bit. Assigning to the `ZipInfo` before `writestr` does **not** stick — set it afterwards via `infolist()` while the archive is still open, because the central directory is only written on `close()`.
- DEFLATE compression (`compress_type = 8`).
- Every file referenced by `localizationInfo.additionalLanguages` must be present, and locale overrides such as `name.short` must be kept in sync with the manifest — a stale locale override silently shows the wrong app name to users of that language.

### Diagnosing A Failed Upload

The Teams Admin Center reports **every** package problem with the same generic message ("We're unable to upload your app"), naming neither field nor reason. Two faster paths:

1. **Developer Portal** (`dev.teams.microsoft.com` → Apps → Import app) validates the same ZIP and names the offending field. Note that its publish-validation report checks the stricter Microsoft Store requirements, so expect findings that are irrelevant to a tenant custom upload.
2. **Offline schema validation** — fast, but it only rules syntax out, not business rules such as the `context` case above:

```bash
curl -sSL -o teams.schema.json https://developer.microsoft.com/en-us/json-schemas/teams/v1.27/MicrosoftTeams.schema.json
```

Validate the extracted `manifest.json` against it with a draft-04 validator (the schema is draft-04, and its root sets `additionalProperties: false`, so unknown fields fail).

When bisecting, diff against the last artifact that was demonstrably uploaded and change **one** variable at a time — including the container properties above. Give every test package a fresh app id and a distinct `name.short` so it can be installed next to the working release without deleting it.

### After Every Upload

Update `OutlookSync__TeamsAppId` in the App Service settings to the installed app's id, otherwise the "open in RPP" deep links in synced Outlook events point at the previous app. `OutlookSync__TabEntityId` may stay unset as long as the manifest uses `entityId: "rpp-planning"`, which is the code default in `OutlookSyncSettings`.

## Managed Package (Power Platform)

For customer-ready managed Power Platform packages, use solution export from Dataverse.

See:

- `scripts/build-managed-solution.ps1`
- `docs/managed-package-build.md`
