# Architecture

## Target Stack

Microsoft Teams ->  React -> Fluent UI -> Services -> SharePoint Lists -> Microsoft Graph -> Power Automate -> Power BI.

## Layers

- Presentation: React components, pages, Fluent UI controls, and localized labels.
- Business: planning rules, grouping, capacity thresholds, and validation.
- Data: repository interfaces, mock repositories in Sprint 1/EO-100, SharePoint and Graph implementations from later Sprint 2 orders.

UI components must not call SharePoint or Graph APIs directly. They consume application services, which depend on repository interfaces rather than concrete infrastructure.

## Persistence Architecture

EO-100 introduces the persistence architecture for Sprint 2 without implementing actual Microsoft 365 calls.

```text
React UI
  -> Application Services
  -> Repository Interfaces
  -> Repository Implementations
  -> Microsoft Graph / SharePoint Online
```

Responsibilities are deliberately separated:

- Microsoft Teams membership is the source of truth for plannable people.
- Microsoft Graph supplies identity and membership data such as user id, display name, e-mail, avatar, company name, and guest/member status.
- SharePoint Online stores planning data only: absences, vacation balances, public holidays, planning events, settings, and planning configuration.
- The application owns business logic such as half-day rules, capacity calculation, timeline rendering, validations, and team-capacity aggregation.

Repository contracts live in `src/repositories/planningRepositories.ts`:

- `ITeamMembershipProvider`
- `IAbsenceRepository`
- `IVacationBalanceRepository`
- `IHolidayRepository`
- `IPlanningSettingsRepository`
- `IPlanningEventRepository`
- `ITeamPlanningConfigurationRepository`

Mock implementations live in `src/repositories/mockPlanningRepositories.ts` and are exposed through `src/repositories/defaultPlanningRepositories.ts`. Later Engineering Orders may replace these with Graph and SharePoint implementations without changing UI components or business services.

`src/services/planningDataService.ts` is the application-service composition point. It loads repository data and produces a `PlanningDataSnapshot` for current planning views. It does not know whether the repositories are backed by mocks, Graph, SharePoint, or a future backend.

EO-102 formalizes the repository contracts with typed query objects, `RepositoryResult<T>` error handling, and `RepositoryPage<T>` paging. The contract reference lives in `docs/repository-contracts.md`.

## Microsoft 365 Approval Integration Architecture

EO-200 introduces approval as a Microsoft 365 integration boundary rather than a custom workflow engine. Approval remains outside the planning engine:

```text
Vacation Request
  -> Approval Policy
  -> Approval Required?
  -> Direct Approval or Power Automate Flow
  -> Microsoft Approvals
  -> Approved Absence
  -> Planning Engine
```

Approval domain types live in `src/models/approval.ts`:

- `VacationRequest`
- `ApprovalPolicy`
- `VacationRequestStatus`
- `ApprovalProvider`
- `PlanningRole`
- `PowerAutomateApprovalInput`
- `PowerAutomateApprovalOutput`

Repository contracts live in `src/repositories/approvalRepositories.ts`:

- `IApprovalPolicyRepository`
- `IVacationRequestRepository`
- `IApprovalIntegrationRepository`

`src/services/approvalIntegrationService.ts` evaluates vacation requests against enabled team- and role-specific approval policies. If no approval is required, the request is saved as `approved` with provider `none`. If approval is required, the service starts the Power Automate integration contract and stores the returned Microsoft Approval reference id with status `pendingApproval`.

Guests are directly released according to BR-200.4. Other exemptions, such as department heads, are represented through approval policies with `approvalRequired: false`; there is no organizational hardcoding for Organisation-A, Organisation-B, titles, or Microsoft Entra ID roles.

The application does not implement an Approval Inbox, approval cards, reminders, notification delivery, mobile approval, flow run monitoring, delegations, escalations, or approval history. Those responsibilities stay with Power Automate and Microsoft Approvals. UI components may show request status, pending state, rejected/approved state, failed workflow state, and a Microsoft Approval reference when available, but they do not know Power Automate implementation details.

EO-201 extends this boundary with explicit approval routing:

```text
Vacation Request
  -> Approval Policy
  -> Approval Routing Rule
  -> Determine Approver
  -> Power Automate
  -> Microsoft Approvals
```

`ApprovalPolicy` decides whether approval is required for a team and planning role. `ApprovalRoutingRule` decides which explicitly configured user approves a request within that team. The application does not derive approvers from Microsoft Graph, Entra ID roles, job titles, or manager fields.

New teams can fall back to default policies. Missing or duplicate routing rules are configuration errors and must be logged through EO-010. EO-201 still does not introduce Team Settings UI; EO-205 provides the Team Admin Center surface for team-level approval settings and policy maintenance.

EO-202 adds the vacation request lifecycle:

```text
Draft
  -> Review
  -> Submit for Approval
  -> Power Automate
  -> Microsoft Approvals
  -> Approved / Rejected
  -> Planning Engine consumes approved requests only
```

Drafts are first-class domain records. `approvalIntegrationService` can save, update, and delete editable requests before submission. The service starts no Microsoft 365 workflow until `submitVacationRequest()` is called. Draft, rejected, and failed requests can be edited and resubmitted; pending and approved requests are protected from draft lifecycle deletion.

EO-202 also stores `approverUserId` and `syncToOutlook` on `VacationRequest`. The approver is the default routing approver unless the user selects an alternate approver allowed by the routing configuration. Outlook synchronization remains independent from approval status and is not implemented in EO-202.

`src/components/approval/VacationRequestForm.tsx` provides the localized form surface for Save Draft and Submit for Approval actions. It remains a reusable component boundary and does not implement a custom Microsoft Approval Inbox.

EO-202-A adds `src/features/approvals/ApprovalsPrototypePage.tsx` as a local, removable UI prototype (only visible in `approvalMode=mock`). It demonstrates request preparation, review, submission, Team Lead decision, cancellation, approval, and rejection with local component state only.

EO-207 replaces the mock workflow with a live Microsoft 365 approval process when `approvalMode=m365`. The Approvals workspace is now mode-aware: mock mode keeps the simulation sidebar, while live mode hides it and uses the real `VacationRequestForm` + pending/decision panels that read from the `VacationRequests` SharePoint list. Only approved requests are persisted into the planning repositories.

## Team Admin Center

EO-205 introduces `src/features/team-admin/` as the team-level administration feature boundary:

```text
Administration / Team Admin Center
  -> TeamAdminPage
  -> teamAdminApi
  -> TeamSettings
```

The Team Admin Center is the configuration surface for team leads and delegated administrators. It exposes only teams the current administrator is authorized to manage, allows default approver, backup approver, user-override policy, and Outlook synchronization policy changes, and shows team members with vacation balance, active request count, and effective approver.

The Sprint 3 implementation uses a mock `teamAdminApi` with explicit permission validation. Personal profile data remains read-only and is not editable from this surface. The mock team policy is consumed by EO-206 My Settings so policy-managed approver and Outlook controls react to Team Admin Center changes during the session.

EO-205 does not implement automatic backup approver activation, multi-level approval workflows, department hierarchy management, HR master-data administration, Microsoft Entra ID synchronization, vacation balance editing, or production backend persistence.

## My Settings

EO-206 introduces `src/features/settings/` as the personal settings feature boundary:

```text
Settings / My Settings
  -> MySettingsPage
  -> settingsApi
  -> EffectiveUserSettings
```

My Settings is a personal control surface, not the team administration center. It shows profile, team, default approver, fallback approver, notification preferences, Outlook sync preference, language, and time zone. Editable controls are driven by `EffectiveUserSettings.permissions`; policy-managed fields remain visible and disabled.

The Sprint 3 implementation uses a mock `settingsApi` with `getMySettings`, `patchMySettings`, and `resetMySettings`. The service boundary is designed so future Graph `/me`, mailbox settings, SharePoint-backed user settings, and team policy integration can replace the mock without changing the page components.

EO-206 does not implement Teams Adaptive Cards, Teams notification delivery, manual regional override, complex delegation rules, multi-step approvers, substitute handling, or Graph mailbox-settings writeback.

## Outlook Calendar Synchronization

EO-203 introduces `src/features/outlook-sync/` as the Outlook synchronization boundary:

```text
Vacation lifecycle event
  -> SyncQueue
  -> OutlookSyncService
  -> GraphCalendarAdapter
  -> Microsoft Graph /me/events
```

The UI never calls Microsoft Graph directly. `GraphCalendarAdapter` is the only module that maps vacation requests to Microsoft Graph calendar event payloads. It creates events for submitted or pending vacation requests, updates the existing event for approved or updated requests, and deletes the linked event for rejected or cancelled requests.

`VacationRequest.outlookSync.graphEventId` stores the Microsoft Graph event id. This preserves the one-Outlook-event-per-vacation-request rule and avoids delete/recreate behavior when an event can be patched.

Synchronization failures do not change the approval lifecycle. They update the synchronization status to `failed`, retain the last error, and allow retry through the service/UI boundary.

## Vacation Balances

EO-204 introduces `src/features/vacation-balances/` as the vacation balance feature boundary:

```text
My Absences
  -> Vacation Balance API
  -> Vacation Requests
  -> Balance Calculation
  -> Balance Card / Preview / History
```

The frontend displays calculated balance values but does not treat them as independently authoritative. The current implementation uses a mock API boundary in `services/vacationBalanceApi.ts`; a future backend can replace that boundary while preserving the page contract.

`VacationBalance` contains the annual entitlement, carry forward, manual adjustments, pending vacation, approved vacation, and remaining balance for one user and vacation year. The remaining balance is calculated from those fields. Submitted or pending vacation requests reduce pending vacation; approved requests reduce approved vacation; draft, rejected, and cancelled requests do not reduce the current balance.

Manual administrator adjustments are modeled separately as `VacationBalanceAdjustment` records with value, reason, administrator, timestamp, previous manual-adjustment value, and new manual-adjustment value. The history view shows only manual adjustments, not every vacation request lifecycle event.

The My Absences route renders the localized balance card, live request preview, warning for overdrawn requests, adjustment entry, and audit history. EO-204 does not implement accrual, legal vacation rules, payroll integration, SAP HR integration, or carry-forward expiration.

## Microsoft 365 Authentication & Graph Integration

EO-108 introduces centralized Microsoft 365 authentication and Microsoft Graph access infrastructure under `src/infrastructure/microsoft365/`.

Authentication is infrastructure:

- UI components do not request or handle tokens.
- Tokens are acquired through `Microsoft365AuthProvider`.
- Teams context is acquired through `TeamsContextProvider`.
- Graph requests are executed through `MicrosoftGraphClient`.
- Graph membership loading is available through `GraphTeamMembershipProvider`, which implements the domain `ITeamMembershipProvider` contract.

Initial Graph scopes are `User.Read`, `GroupMember.Read.All`, and `Team.ReadBasic.All`. Final permission review remains a deployment concern.

EO-103 wires the Graph-backed membership provider into the default repository composition behind an explicit source switch. Mock membership remains the default. Setting `VITE_PLANNING_MEMBERSHIP_SOURCE=graph` replaces only `teamMemberships` with `GraphTeamMembershipProvider`; SharePoint-backed planning repositories are still future work.

The application shell creates the repository composition with the EO-010 logger and passes the `PlanningRepositories` contract to planning views. Timeline and team-capacity components do not import Graph infrastructure, Teams SDK adapters, or authentication code.

Graph membership loading supports repository paging, includes guests, and normalizes Graph users to `TeamMembership` records with user id, display name, e-mail, avatar URL, organization, and guest/member status. Organization is resolved from Graph `companyName` first, with guest/member status used only as a fallback for cross-tenant users whose company attribute is unavailable. No separate employee list is introduced.

EO-104 extends the same infrastructure into a shared Microsoft 365 client foundation:

- `createMicrosoft365ClientFoundation()` creates the central security/client boundary.
- `CachedMicrosoft365AuthProvider` wraps the host auth provider and centralizes token reuse.
- `MsalAuthProvider` is an adapter boundary for future MSAL-backed token acquisition.
- `createGraphClient()` creates Graph clients from the shared auth provider.
- `createSharePointClient()` creates SharePoint REST clients from the shared auth provider when a SharePoint site URL is configured.
- `VITE_SHAREPOINT_SITE_URL` supplies the SharePoint site URL for infrastructure composition.

Graph and SharePoint clients are infrastructure-only. UI components and business services depend on repository/application-service contracts, not on Microsoft 365 clients. Repository loading failures are logged through EO-010 and surfaced through the existing localized error banner.

## Data Loading & Bootstrap

EO-105 introduces a planning bootstrap step before operational planning views render their timeline or capacity surfaces.

```text
Planning View
  -> bootstrapPlanningState
  -> loadPlanningDataSnapshot
  -> PlanningRepositories
  -> Graph / SharePoint / Mock implementations
```

`src/services/planningBootstrapService.ts` owns the view-level bootstrap state:

- `loading`
- `ready`
- `empty`
- `error`

`src/components/PlanningBootstrapStatus.tsx` renders localized loading, empty, error, and retry states. The timeline and team capacity dashboard only render their operational surfaces after a `ready` snapshot exists.

EO-301 extends `bootstrapPlanningState()` with per-repository caching and in-flight request deduplication. Timeline and Team Capacity can reuse the same planning snapshot after navigation instead of triggering duplicate repository reads. Manual retry passes `forceRefresh` and bypasses the cache.

`planningDataSource = sharepoint` activates SharePoint-backed read repositories in `src/repositories/sharePointPlanningRepositories.ts`. These repositories map SharePoint lists into EO-102 contracts:

- `Absences` -> `IAbsenceRepository`
- `VacationBalances` -> `IVacationBalanceRepository`
- `PublicHolidays` -> `IHolidayRepository`
- `PlanningSettings` -> `IPlanningSettingsRepository`
- `TeamPlanningConfiguration` -> `ITeamPlanningConfigurationRepository`
- `PlanningEvents` -> `IPlanningEventRepository`

These repositories are **read-only** and remain so (EO-430 FR-430.9). They are an evaluation and demo path covering six of the sixteen provisioned lists; a second write pipeline against the same lists would need its own compound-key enforcement, soft-delete filtering and throttling behaviour, and any divergence between the two would surface as inconsistent data rather than a build error. Writing to SharePoint is the API's job (see *Store selection in the API* below).

Person-valued facts are SharePoint `User` columns, which hold a site-collection lookup id rather than a Microsoft Graph user id. `src/repositories/sharePointSiteUserDirectory.ts` makes that hop once per site with a single `/_api/web/siteusers` request, serving both directions: lookup id to Graph id for projections, Graph id to lookup id for filters — OData cannot filter a person column by the Graph id. Only `NameIdIssuer = urn:federation:microsoftonline` is trusted as a Graph object id. A person-scoped query whose employee is unknown to the site returns nothing rather than dropping the filter; an unresolvable person leaves the employee id empty but keeps the row.

## Store Selection in the API (EO-430, ADR-002)

ADR-002 supersedes ADR-001's "SQL is the source of truth". The API supports two persistence profiles, chosen by `Planning:Provider` (`sql` | `sharepoint` | `mock`) and resolved at startup in `Program.cs`:

- `sql` — Microsoft SQL Server via `EfPlanningRepository`. The scaling tier.
- `sharepoint` — SharePoint Online lists in the customer's tenant. The entry tier, for installations without a database and for installations that want the lists as an editing surface.
- `mock` — in-memory data for demonstration and development.

**This is a different switch from `planningDataSource`.** The frontend's runtime configuration decides where the *browser* reads from; `Planning:Provider` decides which store the *API* uses behind `planningDataSource = api`. The browser never reaches a store directly in that mode, and cannot tell which store answers.

The value has no code default: an unknown or missing one fails startup with a named error rather than binding a store the operator did not choose. `AddDbContext` and the startup migration are gated on the `sql` branch, so the other profiles open no SQL connection. `/health` reports the active store as `planningStore`.

In the SharePoint profile the lists are also a second editing surface — administrators and HR maintain data in them directly — so the application is not the only writer. Guarantees the SQL profile provides for free (transactions, joins, referential integrity, compound keys) become application obligations there; ADR-002 tabulates the difference.

## SharePoint Information Architecture

EO-101 defined SharePoint Online lists for planning-specific facts only:

- `Absences`
- `VacationBalances`
- `PlanningSettings`
- `PublicHolidays`
- `TeamPlanningConfiguration`

EO-430 extends the provisioned set to sixteen lists, covering the vacation request lifecycle, team administration, organisations, locations, display settings and mailbox sync configuration. It also establishes **one column per fact**: where the SharePoint read-model and the EF entities had diverged, both columns were provisioned side by side; the EF name is now the system of record and the other is retired. Person-valued facts collapse into a single `User` column with no UID text twin, and `CreatedBy` / `ModifiedBy` give way to the built-in `Author` / `Editor`. Two exceptions are forced by the platform: application timestamps use `CreatedAt` / `ModifiedAt` because `Created` / `Modified` are built-ins, and `Type` stays a text column because SharePoint cannot retype an existing one.

The typed list and field definitions live in `src/models/sharePointInformationArchitecture.ts`; the detailed documentation lives in `docs/sharepoint-information-architecture.md`.

SharePoint references users through Microsoft Graph user ids and teams through Microsoft Teams / M365 Group ids. It does not store display names, e-mail addresses, avatars, job titles, departments, or team membership. `UserDisplayName` on `VacationRequests` was the one breach of that rule and is retired: a `User` column renders the current name from the directory-backed User Information List, so people read names in a list without the application storing one.

Calculated values remain calculated. Booked vacation days, remaining vacation days, available capacity, and capacity status are not stored in SharePoint.

EO-101-A adds the technical list constraints required before repository implementation:

- Unique keys protect facts that must be singular, such as `UserId + Year` in `VacationBalances`.
- Indexes are defined for user, date, year, key, scope, region, and team lookups before CRUD code exists.
- Searchable fields are technical lookup fields only and do not duplicate Graph identity attributes.
- User references use Microsoft Graph user ids; team references use Microsoft Teams team / M365 Group ids.

## Frontend Structure

- `src/components/`: reusable UI components.
- `src/pages/`: page-level compositions for future routing.
- `src/webparts/`: SPFx integration entry points (thin mount; same SPA artefact).
- `src/infrastructure/host/`: **Host adapter** (EO-455 / ADR-004) — session-scoped `teams` | `browser` | `sharepoint` façade for auth, context, theme, chrome and deep links. One build; host is not the data provider.
- `src/data/`: Sprint 1 mock data.
- `src/models/`: typed planning model.
- `src/localization/`: German and English resources.
- `src/styles/`: global and shared styles.

## Host adapter (EO-455 / ADR-004)

Host concerns (Teams SSO handshake, browser demo chrome, SharePoint mount bootstrap, deep-link wire format) are resolved once per session via `resolveHostAdapter()`. The **data** axis remains runtime-config / server `Planning:Provider` (mock | api | sharepoint store). UI features and repositories must not import `@microsoft/teams-js` outside the Teams host adapter module. Context used for `X-RPP-Active-TeamId` / current user is memoized on the adapter for the session.

## SharePoint Web Part (future — ADR-006 / EO-457)

**Not shipped.** When SharePoint should surface RPP, v1 is an **iframe** Web Part that embeds the already deployed SPA HTTPS origin (App Catalog `.sppkg` + frame-ancestors), not an in-page SPFx React mount. Direction: `ARCHITECTURE-POLICY/ADR-006.md`; backlog order: `ENGINEERING-ORDERS/EO-457.md`. Unrelated to EO-430 (SharePoint as planning **store**).

## Default planning team seed (EO-456 / ADR-005)

When a scoped API read targets an M365 host (`OwningTeamId` / `X-RPP-Active-TeamId`) that has **zero** internal `TeamAdminTeam` rows, `EfPlanningRepository` creates one team named `Alle - {M365 display name}` and assigns every Graph member and guest (primary only when the user has no global primary yet). Graph outages skip structure creation so a later successful request can still seed. This is not continuous membership sync and does not invent a fallback host team (EO-428).

## Relational engines (EO-458 / ADR-007)

`Planning:Provider` selects the persistence profile. Relational values:

| Value | EF provider | Schema at startup |
| --- | --- | --- |
| `sql` | SQL Server | `Database.Migrate()` (existing migrations) |
| `postgres` | Npgsql | `CreateTables` when empty (v1; dual migrations later) |

Same `EfPlanningRepository` / `RppDbContext`. Frontend unchanged. Local Postgres: `docker compose -f docker-compose.postgres.yml up -d`.

## Deployment

EO-302 introduces a deployment baseline for repeatable Version 1.0 releases.

```text
Source control
  -> npm run build
  -> dist artefact
  -> runtime-config.js
  -> release.json
  -> deployment validation
```

Runtime configuration is loaded from `config/runtime-config.js` before the React bundle starts. The application reads this through `src/infrastructure/deployment/runtimeConfig.ts`; build-time `VITE_` variables remain fallbacks for local development and SPFx packaging scenarios.

Optional `standaloneBrowserUsesMock: true` keeps deployment providers (`api` / `m365`) for Teams while forcing mock planning/membership/approval when `detectHostKind()` is `browser` (public demo hosts such as Host Europe). Local overrides still win. This does not select a second build artefact and does not change the host adapter contract (ADR-004: host axis vs data axis).

Deployment artefacts contain `dist/release.json`, generated by `scripts/write-release-metadata.mjs`, so every release can be traced to an application version, source revision, build time, and environment name.

`scripts/validate-deployment.mjs` validates the generated `dist` folder before deployment is considered successful. Rollback should restore a previous immutable `dist` artefact including its matching runtime configuration and release metadata.

EO-302 does not provision infrastructure, choose a hosting platform, implement blue/green deployments, or add container orchestration.

## Team Context Resolution (EO-428)

Team-scoped requests need to know which team they are about. The answer is resolved in exactly two
steps, and there is deliberately no third:

```text
1. explicit teamId query parameter
2. X-RPP-Active-TeamId header (Teams host context, or the user's stored choice)
-> otherwise: unresolved
```

Until EO-428 a third step fell back to the configured `Graph:TeamGroupId`. Because the personal app
scope carries no `groupId`, that fallback applied to every request made outside a team tab: the API
silently treated the caller as working in one specific team, and a caller who was not a member of it
received a permission error for a team they never asked about. The configured value is also gone
from committed configuration — organisations and teams are deployment configuration (BR-200.x).

An unresolved context is reported, not substituted: HTTP 428 with `{ "code": "noTeamContext" }`, its
own `RepositoryErrorCode`, and its own planning bootstrap state. It is neither `forbidden` (a
permission problem, fixed by an administrator) nor `empty` (a plan with nobody in it) — it is a
missing selection, which the user can make. Every resolution logs the team id together with its
origin (`Query`, `Header`, `Unresolved`) so field diagnosis does not depend on inferring the branch.

`GET /api/planning/my-teams` answers the selection question from Microsoft Graph
(`/users/{id}/memberOf`, restricted to groups actually provisioned as Teams) and flags the caller's
primary team from the planning assignments. A single team or a marked primary team is applied
without asking; only a real ambiguity produces a question. The choice is stored per user in
`localStorage` as a convenience — it is never an authorization fact, because the server re-checks
real membership on every request.

Guests are never team administrators (FR-428.4). Microsoft 365 already prevents a guest from owning
a team, so this changes no outcome; it is stated in `AccessInfoDto.IsGuest` and enforced explicitly
so the rule can be read and tested rather than rediscovered from Graph behaviour, and so the UI can
leave those surfaces out instead of offering and refusing them.

## Team-scoped planning reads (EO-459)

`GET /api/planning/memberships` was already strict (team context + Graph membership). EO-459 applies
the same gate to person-bearing planning lists:

- `GET /api/planning/absences`
- `GET /api/planning/vacationbalances`
- `GET /api/planning/events`

Each call resolves team context, loads Graph members with `throwOnFailure`, requires the caller to
be a member, and returns only rows whose `EmployeeId` is in that set. Missing context is still
`428 noTeamContext`; Graph failure is `502 membershipLookupFailed` — never an unfiltered dump.

Writes stay person-scoped (self or M365 owner of the active team) with EO-459 constraints: self
without team context remains allowed (personal scope); self with team context must be a member;
owner writes require team context and the **target** user must be a member of that team. The UI
still filters by membership as defense in depth; the API is the authority.

## Release Versioning (EO-427)

The version a user sees was previously produced by four independent, hand-maintained strings that no build step reconciled. They drifted, and on 2026-07-26 an artefact staged for a tenant carried `planningDataSource: "mock"` while `/health` reported `1.0.0`. EO-427 replaces the hand-maintenance with derivation:

```text
release.json (repository root, the only hand-edited version)
  -> RppWebApi.csproj <Version>        (MSBuild reads the file during evaluation)
  -> dist/config/runtime-config.js     (stamped by scripts/stamp-runtime-config.mjs)
  -> dist/release.json                 (scripts/write-release-metadata.mjs)
  -> teams-app-package/manifest.json   (hand-edited, verified by the gate)
```

`scripts/package-api.mjs` is the only supported path to a deployable API artefact. It requires the target environment to be named explicitly (`--env prod`), stamps release label and commit into the runtime configuration, mirrors `dist/` into `RppWebApi/wwwroot/` and refuses to continue unless both trees are byte-identical. `scripts/validate-release-consistency.mjs` fails the run when any surface disagrees.

Two values are deliberately outside this chain: `package.json` `version` identifies the npm package, not the release; and the Info page badge is an end-user communication label, localized and chosen for recognisability rather than derived from the version number.

## Monitoring

EO-303 introduces `src/infrastructure/monitoring/` as the operational monitoring boundary:

```text
Application events
  -> EO-010 Logger
  -> Monitoring event buffer
  -> Health snapshot / diagnostics
```

The existing logger remains the single application logging surface. EO-303 forwards structured, sanitized log entries into a bounded in-memory monitoring buffer. Sensitive keys such as tokens, secrets, passwords, cookies, authorization headers, and API keys are redacted before diagnostic state is stored.

`getMonitoringHealthSnapshot()` returns runtime health, release version, source revision, environment name, configuration checks, recent events, and recent metrics. Startup duration is recorded as a lightweight metric. Static deployments also include `health.json`, which is validated as part of EO-302 deployment validation.

EO-303 does not implement external monitoring platform integration, alerting, distributed tracing, automated incident response, infrastructure monitoring, or SLO reporting.

## Security

EO-304 introduces `src/core/security/` as the shared security helper boundary for diagnostic redaction, safe exception details, and trusted outbound URL creation.

```text
UI / Services
  -> Repository Contracts
  -> Microsoft 365 Infrastructure
  -> Trusted Graph / SharePoint URL Guards
  -> Microsoft Graph / SharePoint Online
```

Security remains layered:

- Microsoft Teams / Microsoft Entra ID own authentication.
- Repository and service contracts keep UI components away from tokens and clients.
- Runtime configuration validates SharePoint site URLs before infrastructure composition.
- Graph client calls are restricted to `https://graph.microsoft.com`.
- SharePoint client calls are restricted to the configured SharePoint site origin.
- Logger, monitoring, repository errors, and application errors avoid persisting raw sensitive values or exception objects.

The static CSP/referrer baseline in `index.html` supports local/static hosting, but production Teams/SPFx hosting must enforce equivalent or stricter security headers at the hosting layer. The detailed baseline lives in `docs/security.md`.

EO-304 does not implement infrastructure hardening, tenant Conditional Access, WAF rules, SOC processes, penetration testing, or compliance certification.

## Routing

EO-001 does not introduce React Router. The application shell uses lightweight hash-based routing in `src/components/AppShell.tsx` for workspace pages. Routes are defined as typed `AppRoute` entries and navigation updates `window.location.hash`.

This keeps the shell dependency-light for the first Engineering Order. Introduce React Router only when later orders require nested routes, route loaders, guarded routes, or deeper browser navigation behavior.

EO-301 adds route-level code splitting without changing the hash routing model. `PlaceholderPage` lazy-loads heavy route components such as Timeline, Team Capacity, My Absences, Team Admin Center, and My Settings through React `lazy` and `Suspense`. `TopNavigation` preloads those lazy chunks on hover and keyboard focus so navigation remains responsive while initial shell JavaScript stays smaller.

## Workspace Navigation

EO-009-A/B replaces the permanent left in-app navigation with horizontal workspace tabs in `src/components/TopNavigation.tsx`. The navigation sits directly below the app header so the timeline can use the full horizontal content width.

The active tab is derived from the same typed hash route state used by the shell. Small displays use horizontal overflow rather than restoring a permanent left navigation.

## Design System

EO-002 establishes the product design foundation. Shared visual tokens are defined in `src/styles/designTokens.css` and map to Fluent UI theme variables for surfaces, text, borders, status tones, spacing, radius, and shadows.

Reusable layout primitives live in `src/components/`:

- `PageScaffold`: consistent page header, section rhythm, and content spacing.
- `DesignCard`: reusable card pattern with icon, description, and status tone.
- `AppLayout`, `AppHeader`, and `TopNavigation`: shell-level structure and navigation polish.

Prefer Fluent UI components and Fluent token-backed CSS variables. Avoid hardcoded colors in new UI work. Use CSS modules for component-specific styles and global CSS only for shell-level layout or shared design tokens.

## Timeline Foundation

EO-003 introduces the reusable timeline framework in `src/components/timeline/`. The timeline is presentation infrastructure only: it renders a three-month horizontal grid, month/week/day headers, sticky employee placeholder column, weekend backgrounds, current-day indicator, and an empty event layer.

Timeline-related structural types live in `src/models/timeline.ts`. The current implementation uses placeholder employee rows only and must not be treated as a business data model. Future Engineering Orders should populate the event layer through typed inputs without coupling the timeline components to SharePoint, Graph, or domain-specific planning logic.

## Resource Summary Panel

EO-004 adds a compact sticky resource summary panel for each timeline row. The implementation lives in `src/components/resourceSummary/` and is consumed by the timeline row renderer.

Typed mock resource data lives in `src/data/mockResources.ts` and uses `src/models/resource.ts`. As of EO-100, planning views consume this data through mock repositories and `planningDataService`; the file remains a mock seed only and must not be treated as a backend contract.

The summary panel intentionally exposes only high-value row information: avatar, display name, partner-organization badge when needed, compact competencies, and prominent vacation figures. EO-009-C removes repeated team labels from the card because the team group already provides that context. Organisation-A is the default organization and is not shown as a badge; Organisation-B remains visibly marked.

Timeline week headers use calendar weeks as the primary orientation and keep the date interval as secondary information. This is presentation-only and does not change planning calculations.

EO-009-D further refines presentation density without changing data flow or business behavior. Resource rows use a stable 68px height, vacation values render as a single horizontal summary, and the first three timeline grid rows are explicit compact header rows for month, calendar week, and day labels.

## Team Grouping Framework

EO-006 groups resources by Primary Team / Capability inside the timeline. Grouping is implemented in `src/components/teamGrouping/` and the pure grouping helper `groupResourcesByPrimaryTeam`.

Each resource belongs to exactly one visible group via `primaryTeam`. Secondary team memberships remain on the resource model and in the details panel, but EO-009-C no longer repeats team labels inside the Resource Summary Panel. Organisation is not used for grouping; only partner organisations such as Organisation-B receive a visible badge in the row card.

Team groups are expanded by default, can be collapsed independently, display compact resource counts, and keep group headers visually distinct inside the timeline.

## Operational Planning View

EO-007 integrates timeline infrastructure, resource summaries, primary-team grouping, and presence event rendering into one operational planning view. Mock resources live in `src/data/mockResources.ts`; mock presence events live in `src/data/mockPresenceEvents.ts`.

Presence event rendering is isolated in `src/components/events/`. Events are typed by `src/models/planningEvent.ts`, rendered against timeline day keys, and aligned to the grid by `eventPlacement.ts`. Event rendering remains frontend-only and does not introduce editing, drag and drop, capacity calculation, risk highlighting, SharePoint, Outlook, or workflow integration.

Future Engineering Orders should extend the event data source through service boundaries rather than coupling event rendering to backend APIs.

## Universal Details Side Panel

EO-008 introduces a reusable right-side details panel in `src/components/detailsPanel/`. It is opened from resource summaries and presence events, uses typed `DetailsPanelState`, and displays either `ResourceDetails` or `PresenceDetails`.

The panel is read-only in Sprint 1. It provides overlay behavior, close button, ESC key support, and responsive sizing. It must remain the standard interaction pattern for future detailed views, including approvals, editing, Outlook integration, or SharePoint-backed records when those Engineering Orders are approved.

## Observability Foundation

EO-010 introduces `src/core/logging/` as the central diagnostics layer. Application code should use `useLogger()` or an injected `Logger` instead of direct `console` calls. The only permitted direct console usage is inside `Logger.ts`, which keeps browser logging replaceable by Azure Monitor, Application Insights, or backend telemetry in later sprints.

`ApplicationError` is the shared technical error model. It includes severity, source, component, operation, timestamp, inner error, and a generated correlation ID. User-facing error UI must show a friendly localized message and the correlation ID only; stack traces and technical objects stay in logs.

The global `ErrorBoundary` is mounted inside the Fluent provider and wraps the app layout. It logs React render failures, prevents full UI crashes, and displays a localized error banner. `ErrorDialog` is available as a reusable pattern for future blocking error flows.

## Absence Management

EO-011 introduces editable absence entities in `src/models/absence.ts`. Absences are separate from general `PlanningEvent` records and are converted into timeline events for rendering. This keeps the Sprint 1 UI responsive while preserving a future path to SharePoint List persistence.

Absence types are centrally configured in `src/data/absenceTypes.ts`. UI components must not hardcode supported absence categories. Half-day and working-day calculations live in `src/services/absenceCalculations.ts`; weekend days and configured public holidays are excluded from duration and vacation-balance calculations.

The existing universal side panel hosts the absence form for create and edit flows. Timeline cells open a create flow, absence bars open an edit flow, and delete actions are confirmed inside the panel. All changes are in-memory only and update the timeline and resource summaries immediately. EO-011 does not introduce Outlook, Graph, approvals, notifications, or backend persistence.

## Interactive Timeline Editing

EO-012 adds direct manipulation to absence-backed timeline bars only. Read-only operational events still open the details panel and cannot be dragged or resized.

Interactive editing is implemented in `src/components/events/TimelineEvent.tsx` and committed through `editAbsenceOnTimeline` in `src/services/absenceCalculations.ts`. The timeline uses half-day slots derived from visible day columns, so pointer and keyboard interactions share the same validation path. Moving an absence preserves duration; left and right resize operations update the corresponding date and day-half fields.

Invalid edits, including negative duration, moving outside the visible timeline range, or changing duration during a move, are rejected and logged through EO-010. EO-012 does not change the `Absence` data model and does not introduce conflict resolution, undo/redo, approvals, Outlook, Graph, or backend persistence.

## Capacity Calculation Engine

EO-013 introduces `src/services/capacityEngine.ts` as the single source of truth for calculated capacity. The engine accepts resources, absences, visible date keys, and public holidays, then returns deterministic `CapacityResult` records grouped by employee id.

Capacity calculation is independent of rendering. For each resource and date, the engine determines the nominal capacity from employment rate and working-day model, subtracts absence capacity using the EO-011/EO-012 half-day model, and returns available capacity. Public holidays always produce zero nominal and available capacity.

The Timeline consumes capacity results for accessible day context but EO-013 does not add a visible dashboard or report. Future dashboards, approvals, planning rules, and reports must consume this engine instead of recalculating capacity locally. Unexpected calculation failures are logged through EO-010.

## Team Capacity Dashboard

EO-014 implements the `Team-Kapazität` workspace tab in `src/components/teamCapacity/`. The dashboard consumes EO-013 capacity results and aggregates them by primary team and calendar week through `src/services/teamCapacityAggregation.ts`.

Dashboard UI components do not calculate daily capacity. They receive weekly `TeamCapacitySummary` data containing nominal capacity, available capacity, absence capacity, availability percentage, status, and affected resources. Status thresholds are centrally configured in `src/data/capacityThresholds.ts`.

The dashboard supports team selection, week/status selection, affected-resource inspection, and opens the existing universal details side panel for employee details. EO-014 does not introduce approvals, Outlook, Graph, Power BI, forecasting, conflict resolution, or persisted reports.

## Microsoft 365 Localization

EO-016 makes Microsoft 365 the source of truth for UI language. The application no longer exposes a language switcher and does not persist a user language preference.

Locale resolution lives in `src/localization/localizationService.ts` and follows this priority: Microsoft Teams context, SharePoint/Microsoft 365 context, browser language, English fallback. Components continue to receive all UI text through `createTranslator`; missing resources fall back to English and invalid language codes are logged through EO-010.

Future SPFx or Teams SDK integration should feed host language into this service boundary rather than adding component-level language logic.

EO-452 changes delivery, not resolution: English remains statically bundled so translation lookup and
missing-key fallback stay synchronous, while every other locale is a dynamic import loaded only for the
session that resolved it. `scripts/validate-deployment.mjs` rejects a build that restores eager locale
preloads. The same order enables Brotli and gzip before ASP.NET Core static-file middleware.

Graph approval reconciliation remains in the authenticated request context because it uses delegated
OBO tokens. EO-452 performs the independent status reads with a concurrency limit of four, then applies
repository and Outlook lifecycle writes sequentially so a scoped EF Core context is never used in
parallel.

## Runtime configuration and HTTP resilience (EO-453)

The browser treats `config/runtime-config.js` as required deployment input. `tryGetRuntimeConfiguration`
validates that the script loaded, that a provider was explicitly selected, and that API/SharePoint
providers carry a trusted endpoint. Failure renders a localized unavailable state before repositories
are composed; mock repositories are created only when `planningDataSource: "mock"` was explicitly
configured.

`resilientFetch` is the shared browser transport for RPP API, Microsoft Graph, SharePoint, health,
metadata, photo, and calendar reads. `ResilientHttpMessageHandler` applies the same policy to typed
backend `HttpClient` registrations. Only idempotent `GET`, `HEAD`, and `OPTIONS` requests retry
429/502/503/504. Both tiers honor `Retry-After`; otherwise they use capped exponential backoff with
jitter. The default is three attempts with a ten-second maximum delay. Writes are never replayed
automatically because the server may have committed a request whose response was lost.

## Link Preview Metadata (EO-429)

`index.html` carries static Open Graph and Twitter Card tags plus favicon and touch icon. They are
static by necessity: link crawlers execute no JavaScript, so the tags can be neither rendered by
React nor read from `public/config/runtime-config.js`, and `og:image` must be an absolute URL.

That absolute URL is deployment-specific, which is a **documented exception to ADR-003's
one-artefact rule**. The metadata names `https://rpp.example.com` as the canonical public origin
because it is the only deployment ever shared as a link; the Teams-hosted installations sit behind
authentication and are opened through Teams, so their preview would never be rendered by anyone.
The exception is confined to presentation metadata — no runtime behaviour depends on it.

## Help Assistant

EO-450 replaces the static help with a retrieval-grounded chat assistant. The knowledge source is deliberately **not** the source code but curated, user-language documentation maintained in this repository under `docs/user`, `docs/faq`, `docs/glossary` and `docs/release-notes`.

```text
Help panel (Fluent UI OverlayDrawer, opens over the active page)
  -> HelpRepository            mock | api, selected at runtime
  -> POST /api/help/chat       ASP.NET Core, [Authorize]
  -> IHelpAssistantService     Foundry | Fallback, selected by configuration
  -> Managed Identity token    IDENTITY_ENDPOINT, audience https://ai.azure.com
  -> Foundry Responses API     {project}/openai/v1/responses
  -> Agent + File Search       vector store rpp-kb-user
```

**Provider selection follows ADR-003.** `createDefaultHelpRepository` uses the API repository only when `planningDataSource` is `api` and an `apiBaseUrl` exists; every other mode gets `mockHelpRepository`, a keyword lookup over a small curated table, so the panel stays browsable in demo mode without a backend or an Azure subscription. On the server, `HelpAssistantSettings.IsConfigured` decides between `FoundryHelpAssistantService` and `FallbackHelpAssistantService`; an unconfigured deployment degrades to an honest "cannot answer yet" rather than an error.

**The surface is a side panel, not a route.** The assistant opens as a Fluent UI `OverlayDrawer` over the active page, mounted at shell level and code-split so the chat bundle stays out of the initial load. A tab would replace the page the question is about, which is precisely wrong for "why is this red?" — and because the drawer never changes the route, the page context is simply the active route, with no "last visited page" bookkeeping.

**No key exists anywhere.** The browser holds no credentials and talks only to its own backend. The backend authenticates with the App Service managed identity, read from the platform-injected `IDENTITY_ENDPOINT`, so no key can be configured by mistake and none can reach a deploy artefact.

**The agent is authoritative, the request is not.** The agent carries the model, the system instruction (grounding, source citation, answer language, and the rule not to reveal that internal documentation exists) and the File Search tool. The request references it by name and cannot widen it: the Responses API rejects an `instructions` field whenever an agent is referenced. The page context (`language`, `currentPage`, `userRole`) therefore travels as a leading `system` input item — enough to answer "why is this red?", but with no ability to act (FR-450.5, FR-450.7).

**Request shape, verified against the live resource 2026-07-30.** Input items carry an explicit `type: "message"`; user and system parts use `input_text`, replayed assistant turns use `output_text` and must include an `annotations` array. File citations return as `annotations[].filename`, and only the bare document title is surfaced to the user — never a storage path or internal URL.

**Roles.** The web app identity holds *Foundry Agent Consumer* on the project, which permits calling agent endpoints and nothing else; it cannot create, modify or delete an agent or a vector store. Note that roles beginning with *Cognitive Services* and the *Azure AI Developer* role do not apply to Foundry projects.

Knowledge ingest is manual in v1, and the store holds user documentation exclusively — which is why v1 needs no security trimming and no role logic in retrieval. Role-based knowledge areas, an automated ingest pipeline and read-only tools are EO-451.
