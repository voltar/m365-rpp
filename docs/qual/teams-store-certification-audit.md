# M365 Ressourcen & Präsenzplanung (RPP)
## Teams Store & Commercial Marketplace Certification Audit

Review of the repository against the [Teams Store validation guidelines](https://learn.microsoft.com/microsoftteams/platform/concepts/deploy-and-publish/appsource/prepare/teams-store-validation-guidelines)
and the commercial marketplace certification policies (section 1140). The audit covers the app
packages in `teams-app-package/`, the React frontend in `src/`, the ASP.NET Core API in
`RppWebApi/`, and the deployment and security documentation.

**Audit type:** static analysis. The application was neither built nor executed, and no code was
modified. The manifest could not be validated against the live v1.27 JSON schema because
`developer.microsoft.com` is unreachable from the audit environment — the two manifest properties
that depend on it are marked "verify" rather than "fail".

---

## 1. Summary

| # | Finding | Severity | Area |
|---|---|---|---|
| 1 | Planning, absence and vacation reads are authenticated but not scoped — any tenant user can read all HR data | **High** | Authorization |
| 2 | `DELETE /api/planning/vacationrequests/{id}` has no authorization check | **High** | Authorization |
| 3 | `start-approval` has no ownership check; the approver is supplied by the caller | **High** | Authorization |
| 4 | The manifest points at the development environment; the app name carries a release-candidate label | **High** | Store blocker |
| 5 | Demo package: privacy and terms URLs are not policy pages; publisher identity differs from the main package | **High** | Policy 1140.4 |
| 6 | "No user id implies full access" fail-open in the authorization helpers | Medium-High | Authorization |
| 7 | Team-owner authority is keyed on a caller-controlled header; owners can write tenant-wide | Medium-High | Authorization |
| 8 | Anonymous `/health` discloses the database server and database name | Medium | Information disclosure |
| 9 | The host serving the SPA sets no security headers | Medium | Hardening |
| 10 | `Sites.ReadWrite.All` and delegated `Calendars.ReadWrite` are declared but never reachable | Medium | Least privilege |
| 11 | The production CSP still contains `localhost` and `ws://` development origins | Low-Medium | Hardening |
| 12 | CORS always allows localhost origins with `AllowCredentials` | Low | Hardening |
| 13 | `isFullScreen` and `supportsChannelFeatures` need validator confirmation | Low-Medium | Manifest |
| 14 | Tenant GUIDs and a named administrator's object id are hardcoded in committed configuration | Low-Medium | Multi-tenancy |
| 15 | Hardcoded German approval text; 8 manifest locales against 41 application locales | Low | Localization |

Clean on the content and secret-hygiene policies: no secrets in the repository or in the
`appsettings.json` history, no advertising, no analytics or tracking scripts, no executable
downloads, no promotion of third-party applications, no tokens in `localStorage`, no wildcard
`validDomains`, and fully compliant package icons.

---

## 2. Authorization findings

### 2.1 Unscoped reads of planning and absence data (High)

`PlanningController` carries `[Authorize]`, but authorization stops at authentication for most of
the data surface. The read endpoints

- `GET /api/planning/absences` — `RppWebApi/Controllers/PlanningController.cs:58`
- `GET /api/planning/vacationbalances` — `RppWebApi/Controllers/PlanningController.cs:105`
- `GET /api/planning/events` — `RppWebApi/Controllers/PlanningController.cs:118`
- `GET /api/planning/settings` — `RppWebApi/Controllers/PlanningController.cs:126`
- `GET /api/planning/teamconfigurations` — `RppWebApi/Controllers/PlanningController.cs:135`
- `GET /api/planning/vacationrequests` — `RppWebApi/Controllers/PlanningController.cs:344`

pass their query parameters straight into `EfPlanningRepository`
(`RppWebApi/Data/EfPlanningRepository.cs:28`, `:86`, `:162`), where `employeeId`, `year`, `status`
and `teamId` are applied as *optional filters*. Omitting them returns every absence, every vacation
balance and every vacation request stored for the tenant, including absence types and the
`CommentToApprover` free-text field.

`GET /api/planning/memberships` is the exception: it verifies real Microsoft 365 team membership
through Graph before answering (`RppWebApi/Controllers/PlanningController.cs:420-437`). The
membership list is protected; the personal data behind it is not.

The frontend restricts what a user sees, but the API is reachable directly with any Teams SSO token
issued for this audience, so the UI is not a control.

**Recommendation:** derive the caller's permitted scope server-side (own records plus the teams the
caller is verified to belong to) and intersect it with the requested filter, rather than trusting the
filter.

### 2.2 Vacation request deletion is unauthorized (High)

`DELETE /api/planning/vacationrequests/{id}` (`RppWebApi/Controllers/PlanningController.cs:224`)
loads the request, deletes it, and cancels the linked Outlook event — without any authorization
check. The absence delete directly above it does call `CanWriteForUserAsync`
(`RppWebApi/Controllers/PlanningController.cs:88`), so the omission looks accidental rather than
intended.

Any authenticated user can delete any other user's vacation request.

### 2.3 Approval start is unauthorized and caller-parameterized (High)

`POST /api/planning/vacationrequests/{id}/start-approval`
(`RppWebApi/Controllers/PlanningController.cs:252`) never verifies that the caller owns the request.
`ApproverId`, `UserDisplayName`, the comment and the date strings all come from the request body and
are written onto the stored request. An arbitrary user can therefore start a Microsoft 365 approval
for another person's request and route it to an approver of their own choosing.

### 2.4 Fail-open authorization helpers (Medium-High)

`CanWriteForUserAsync` (`RppWebApi/Controllers/PlanningController.cs:906`),
`IsAppAdminOrDevBypass` (`:885`), `GetAccess` (`:817`) and
`AppAdminAuthorization.IsAppAdminOrDevBypass` (`RppWebApi/Services/AppAdminAuthorization.cs:29`)
all treat the *absence of a user object id* as the local-development bypass and grant full access,
including app-admin rights.

The deployment side of this is handled well — `ApiSettings:RequireAuthentication=false` lives only in
`appsettings.Development.json`, which is excluded from the publish output
(`RppWebApi/RppWebApi.csproj:20`), and the Dockerfile pins `ASPNETCORE_ENVIRONMENT=Production`. The
concern is the direction of the default: the bypass is keyed on the shape of the token rather than on
an environment flag, so any accepted token without `oid`, `objectidentifier`, `nameidentifier` or
`sub` is treated as a tenant administrator.

**Recommendation:** gate the bypass on the same `requireAuthentication` value that registers
`DevelopmentAllowAnonymousHandler` (`RppWebApi/Program.cs:101-106`), and deny by default when no
identity is present.

### 2.5 Team ownership is derived from a caller-controlled header (Medium-High)

`ResolveTeamContext` (`RppWebApi/Controllers/PlanningController.cs:947`) resolves the active team
from the `teamId` query parameter, then from the `X-RPP-Active-TeamId` request header — both under
the caller's control. Two consequences:

- `CanWriteForUserAsync` allows a caller who owns *any* team to write or delete absences and vacation
  requests for *any* employee; it never checks that the target employee belongs to that team. Since
  self-service team creation is enabled by default in Microsoft 365, most users can manufacture the
  ownership this check looks for.
- The tenant-global writes `PATCH /api/planning/teamadmin/holidays`
  (`RppWebApi/Controllers/PlanningController.cs:340`) and
  `PATCH /api/planning/teamadmin/displayconfig` (`:383`) are guarded by ownership of the
  caller-selected team — a team-scoped role with a tenant-scoped effect.

### 2.6 Test coverage

`RppWebApi.Tests/PlanningControllerAuthorizationTests.cs` and
`MailboxSyncControllerAuthorizationTests.cs` cover team-admin ownership, guest handling, app-admin
directory roles and the no-team-context path. None of the paths in 2.1 to 2.3 are covered, which is
consistent with the gaps being unnoticed rather than accepted.

---

## 3. Store and marketplace policy findings

### 3.1 The submitted manifest targets the development environment (High)

`teams-app-package/manifest.json` (byte-identical to the manifest inside
`rpp-teams-app-v4.0.6.zip`):

- `name.short` is `RPP RC5`. A release-candidate label in the store-facing name will not pass
  listing review, and `de-de.json` inside the package repeats `RPP RC5` while the other seven locale
  files use `RPP` — so the displayed name changes with the user's language.
- `staticTabs[0].contentUrl`, `websiteUrl`, `validDomains[0]` and `webApplicationInfo.resource` all
  point at `rpp-api.example.com`. `index.html:44`
  documents `https://rpp.example.com/` as the canonical production origin, and that host appears
  nowhere in `validDomains`.
- `developer.websiteUrl` is the Azure development host rather than a company website.

### 3.2 The demo package fails the privacy and terms policy (High)

`rpp-teams-app-v1.0.0-demo.zip` contains a second application (id `8d21a8db-1c49-4f45-8e8d-5a3c30bbf877`,
manifest version 1.19) in which `privacyUrl` and `termsOfUseUrl` are both `https://rpp.example.com`
— the application root, not a privacy policy and not a terms document. Certification section 1140.4
requires both to resolve to the corresponding policy documents.

Its `developer.name` is `Organisation-A IT Platform Services` while the main package uses `Voltar`.
Inconsistent publisher identity is a review flag in its own right, and the hardcoded organisation
also contradicts the repository's own no-organizational-hardcoding rule (BR-200.x, `CLAUDE.md`).

Three packages are tracked in `teams-app-package/` (v1.0.0-demo, v4.0.5, v4.0.6), which makes
submitting the wrong artefact easy. Consider keeping only the current package under version control.

### 3.3 Manifest properties to verify (Low-Medium)

- `isFullScreen: true` is scoped to applications distributed through an organisation's app catalog;
  store-distributed apps are expected to render with the tab header bar.
- `supportsChannelFeatures: "tier1"` could not be confirmed against the v1.27 schema from this
  environment. The documented v1.27 property for channel behaviour is `supportedChannelTypes`.

Run the package through the Teams App Validator or Developer Portal validation before submission to
settle both.

`version` 4.0.6 in the manifest against `0.1.0` in `package.json` is cosmetic, but it makes release
provenance harder to follow.

### 3.4 Content policies — no findings

No advertising, no analytics or tracking scripts, no executable downloads, and no promotion of
third-party applications. The only outbound application link is the deep link to Microsoft Approvals
(`src/features/approvals/MyApprovalsPage.tsx:16`), which is first-party and integral to the feature.

---

## 4. Least privilege — permission trace

Every scope declared in `src/infrastructure/microsoft365/authContracts.ts:46-56` was traced to its
call sites, and the backend services were traced back to the permissions they require.

| Permission | Declared | Used at | Verdict |
|---|---|---|---|
| `User.Read` (delegated) | yes | `src/infrastructure/microsoft365/graphTeamMembershipProvider.ts:76,107` | used |
| `GroupMember.Read.All` (delegated + application) | yes | same; `RppWebApi/Services/GraphTeamMembershipService.cs:223` | used |
| `Team.ReadBasic.All` (delegated) | yes | `src/infrastructure/microsoft365/graphTeamMembershipProvider.ts:76,107` | used |
| `Sites.Read.All` (delegated) | yes | `src/infrastructure/microsoft365/clientFoundation.ts:47` | used |
| `Sites.ReadWrite.All` (delegated) | yes | never requested | **unused** |
| `Calendars.ReadWrite` (delegated) | yes | `src/features/outlook-sync/GraphCalendarAdapter.ts:45,70,81` | **unreachable** |
| `ApprovalSolution.ReadWrite` (delegated) | not in the frontend contract | `RppWebApi/Services/GraphApprovalService.cs:19` | used, undeclared |
| `Calendars.ReadWrite` (application) | not in the frontend contract | `RppWebApi/Services/OutlookCalendarSyncService.cs:110,161` | server-side, documented |
| `Mail.ReadWrite` (application) | not in the frontend contract | `RppWebApi/Services/MailboxSyncService.cs:113` | server-side, documented |
| `User.Read.All` (application) | not in the frontend contract | `RppWebApi/Services/UserPhotoService.cs:43` | server-side, documented |

Two concrete problems:

- **`Sites.ReadWrite.All` is declared but never requested.** `FetchSharePointClient.post`, `.merge`
  and `.delete` never pass scopes, so every SharePoint write falls through to
  `defaultScopes = [Sites.Read.All]` (`src/infrastructure/microsoft365/sharePointClient.ts:67`).
  Either the write path fails at runtime, or the broader permission is reaching the token through
  consent without ever being asked for. Remove it from `Microsoft365PermissionScope`, or wire it to
  the write methods deliberately.
- **Delegated `Calendars.ReadWrite` is unreachable.** `GraphCalendarAdapter` is referenced only as a
  type by `OutlookSyncService` and is never instantiated anywhere in `src/`. The Outlook
  synchronisation that actually ships is the server-side application-only one, so the delegated scope
  should come off the app registration.

Positives on this axis: no RSC permissions are declared and none are used, which is consistent; the
manifest correctly omits `authorization`, `permissions` and `devicePermissions` for a static tab; and
the application-only permissions are documented as constrained by Exchange Application Access
Policies (`docs/deployment.md:253-254`), which is the right mitigation for `.default` app tokens.

---

## 5. Authentication and token handling

Assessed as sound, with one logging nit.

- Teams SSO runs through `app.authentication.getAuthToken` with timeouts on both initialization and
  token acquisition (`src/infrastructure/microsoft365/teamsSsoAuthProvider.ts:56-87`). No MSAL popup
  flow is used inside the tab.
- Tokens live only in an in-memory map with a five-minute default TTL and a one-minute expiry skew
  (`src/infrastructure/microsoft365/cachedAuthProvider.ts`). Nothing writes a token to
  `localStorage`, `sessionStorage` or cookies — the only browser-persisted values are the active team
  selection, mock-mode data and UI preferences.
- Server-side validation uses `Microsoft.Identity.Web` with an explicit `ValidAudiences` list
  (`RppWebApi/Program.cs:20-43`).
- Diagnostics redact `authorization`, `token`, `secret`, `password`, `cookie`, `session`,
  `credential` and `apikey` keys (`src/core/security/securityDiagnostics.ts:6`), and exceptions are
  reduced to name and message before being attached to an `ApplicationError`
  (`src/core/logging/ApplicationError.ts:27-37`). No token value is logged anywhere.
- The approval callback endpoint compares its shared secret in constant time and refuses every
  callback while no secret is configured (`RppWebApi/Controllers/ApprovalCallbackController.cs:77-94`).

Nit: the caller's `wids` directory-role claims are logged in full at Information level
(`RppWebApi/Controllers/PlanningController.cs:838`).

**Sign-out (policy 1140.4.6):** the application offers no sign-out, because it never performs an
interactive sign-in — identity comes from the Teams host through SSO. That is normally accepted for
SSO-only tabs, but it is worth stating explicitly in the submission notes.

---

## 6. Secrets

No findings. This area is handled well and the guards are real:

- `RppWebApi/appsettings.json` ships `ClientSecret`, `ConnectionStrings:DefaultConnection` and
  `ApprovalFlow:CallbackSecret` as empty placeholders.
- `git log -p` over `RppWebApi/appsettings.json` across all branches shows no non-empty secret value
  in the file's history.
- `scripts/validate-repo-hygiene.mjs` fails the build and the pre-commit hook on non-empty
  `ClientSecret` or `DefaultConnection` values, on committed secret-like local files, and on
  credential material in the browser runtime configuration; `scripts/validate-security.mjs` checks
  the built artefact.
- `.env.example` is placeholder-only and carries an explicit secret-free instruction;
  `.gitignore` excludes `.env*`, `secrets*.json` and `runtime-config.local.js`.

**Related but separate (finding 14):** `RppWebApi/appsettings.json:66-80` pins a specific
`TenantId`, the dev-host `Audience`, and one named administrator's object id in
`AppAdmin:AllowedAdminUserIds`; `RppWebApi/Program.cs:36` hardcodes the development host audience a
second time in code. None of these are secrets — `docs/secret-management.md:7` correctly classifies
them as public identifiers — but a marketplace application needs a multi-tenant registration and no
tenant-specific administrator allowlist in the shipped defaults.

---

## 7. Domains, CSP and hosting headers

`validDomains` lists a single exact host with no wildcards and no third-party domains, which is what
the guidelines ask for. Three issues sit around it:

- **Development origins in the shipped CSP.** `index.html:7-21` keeps `http://localhost:5004`,
  `http://127.0.0.1:5004`, `https://localhost:5005`, `https://127.0.0.1:5005` and `ws://localhost:*`
  in `connect-src`. These belong in a development-only variant of the document.
- **Undeclared third-party data flow.** The frontend calls two non-Microsoft hosts directly from the
  browser for holiday calendars — `daten.stadt.sg.ch` and `data.stadt-zuerich.ch`
  (`src/features/team-admin/services/schoolHolidayCalendarApi.ts:84,107`,
  `src/features/team-admin/services/federalHolidayCalendarApi.ts:72`). They are permitted by the CSP
  but are not covered by `createTrustedServiceUrl`, the guard applied to Graph and SharePoint calls,
  and the privacy policy must disclose the flow.
- **No security headers on the host (finding 9).** `RppWebApi/Program.cs` registers no header
  middleware: no `Content-Security-Policy` response header, no `frame-ancestors` (a `<meta>` CSP
  cannot express it), no `X-Content-Type-Options`, no HSTS, no HTTPS redirection.
  `docs/security.md:36` states that the hosting layer must enforce these headers — but the API *is*
  the hosting layer for the SPA (`app.UseStaticFiles`, `app.MapFallbackToFile`), so the control is
  documented and unimplemented. Without `frame-ancestors`, the tab can be framed by any origin.

**CORS (finding 12).** `RppWebApi/Program.cs:110-131` unconditionally appends four localhost origins
to the production policy and enables `AllowCredentials()`. The practical risk is limited — the API
authenticates with bearer tokens rather than cookies, so a hostile page cannot obtain credentials —
but it is production surface with no production purpose.

**Health endpoint (finding 8).** `HealthController` is `[AllowAnonymous]`
(`RppWebApi/Controllers/HealthController.cs:14`) and returns `DatabaseServerName`, `DatabaseName`,
`WebServerName`, the environment name and the build revision to any unauthenticated caller
(`:36-56`). Keep the anonymous response to a liveness status and move the infrastructure fields
behind authentication.

---

## 8. Localization and layering

- The approval title and description sent to Microsoft Approvals are hardcoded German strings
  (`RppWebApi/Controllers/PlanningController.cs:274-279`). This reaches non-German users and
  contradicts the project's own mandatory-localization rule.
- The manifest declares 8 additional languages while `src/localization/` ships 41 locale files.
  Not a defect, but the store listing will only present the languages the manifest declares.
- `src/pages/PlaceholderPage.tsx:149,162` calls `fetch` directly from a page component, contrary to
  the layering rule that `docs/security.md:7` asserts is enforced. The health fetch also surfaces the
  anonymous `/health` payload — see finding 8.
- `src/services/planningDataService.ts:149,170` and
  `src/infrastructure/microsoft365/teamsApp.ts:24` call `console.warn` directly, which the project
  rule reserves for `Logger.ts`.

---

## 9. Compliant by inspection

- Package icons: 192×192 colour icon and a 32×32 outline icon whose only visible pixels are white on
  a fully transparent background — exactly the outline requirement.
- `app.notifyAppLoaded()` and `app.notifySuccess()` are called after initialization
  (`src/infrastructure/microsoft365/teamsApp.ts:19-20`), which `showLoadingIndicator: true` requires;
  without them the tab would hang on the Teams spinner.
- Host theme is followed through `registerOnThemeChangeHandler` with a browser fallback outside
  Teams (`src/infrastructure/microsoft365/teamsApp.ts:45-75`).
- `localizationInfo` files are present in the package for all eight declared languages.
- Graph calls are restricted to `https://graph.microsoft.com` and SharePoint calls to the configured
  site origin, with protocol-relative and non-HTTPS URLs rejected
  (`src/core/security/urlSecurity.ts`).

---

## 10. Recommended order of work

1. Findings 1 to 3 — exploitable with an ordinary user token; fix before any further distribution.
2. Findings 4 and 5 — a submission cannot pass listing review with a release-candidate name, a
   development host, or a privacy link that resolves to the application root.
3. Findings 6 to 9 — authorization hardening and the two hosting-layer gaps.
4. Finding 10 — remove or wire up the two unreachable permissions before the permission review.
5. Finding 13 — run the package through the Teams App Validator to settle `isFullScreen` and
   `supportsChannelFeatures`.
6. Findings 11, 12, 14, 15 — cleanup ahead of the multi-tenant listing.
