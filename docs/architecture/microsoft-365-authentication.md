# Microsoft 365 Authentication & Graph Integration

EO-108 introduces centralized Microsoft 365 authentication and Microsoft Graph client infrastructure. EO-103 wires Teams membership loading into the planning repository composition. EO-104 introduces the shared Microsoft 365 client foundation for Graph and SharePoint.

Authentication and tokens are infrastructure concerns. UI components must not request, store, or pass access tokens.

## Infrastructure Components

Source location: `src/infrastructure/microsoft365/`

- `authContracts.ts`: auth provider, Teams context provider, access token result, and permission scope contracts.
- `teamsSsoAuthProvider.ts`: Microsoft Teams SSO and Teams context adapter.
- `graphClient.ts`: encapsulated Microsoft Graph HTTP client using a token provider.
- `graphTeamMembershipProvider.ts`: authenticated team membership provider implementing the domain `ITeamMembershipProvider` contract.
- `cachedAuthProvider.ts`: central token cache and token lifecycle wrapper.
- `msalAuthProvider.ts`: MSAL adapter contract and provider boundary.
- `sharePointClient.ts`: SharePoint REST client foundation.
- `clientFoundation.ts`: shared Microsoft 365 client factory.
- `index.ts`: public exports for the Microsoft 365 infrastructure package.

## Permissions

### Browser / Teams SSO (delegated)

Used by the SPA host provider when talking to Graph or SharePoint from the client (non-api membership path) and for user-delegated flows:

- `User.Read`
- `GroupMember.Read.All`
- `Team.ReadBasic.All`
- `Sites.Read.All`
- (plus feature-specific delegated scopes such as `ApprovalSolution.ReadWrite` via OBO)

### RPP Web API → Graph (application / client credentials)

The API acquires an **app-only** token (`GetAccessTokenForAppAsync` / `.default`) for membership,
team lookup, photos, and related server paths. Required **application** roles:

| Permission | Purpose |
| --- | --- |
| `GroupMember.Read.All` | Group members/owners; `GET /users/{id}/memberOf` for `GET /api/planning/my-teams` (EO-428 personal team picker) |
| `Group.Read.All` | Group display names (EO-456 seed label, header badge) |
| `User.Read.All` | Member `displayName` / UPN / photos (`GET /api/planning/photos/{userId}`, EO-421) and `companyName` / `officeLocation` (Firma & Standort, EO-415). Missing this surfaces as **Unknown User** and empty organisation/location |

Provision with `scripts/configure-graph-planning.ps1` (`-Profile azure` \| `example`).  
Verify grants on the **service principal** `appRoleAssignments` — `list-grants` only shows delegated scopes.

**Secrets:** `AzureAd:ClientSecret` must be the Entra client secret **Value**, never the Secret **ID**.

Final admin consent and least-privilege validation must be reviewed during tenant deployment and productive Graph integration.

## Token Handling

Access tokens are obtained through `Microsoft365AuthProvider`.

The current provider is `TeamsSsoAuthProvider`, which uses Microsoft Teams SSO when available in the host.

EO-405 requires a dedicated API token for the RPP Web API audience, not a Microsoft Graph token. The frontend therefore reads `apiAccessTokenScopes` from `public/config/runtime-config.js` or `VITE_API_ACCESS_TOKEN_SCOPES` and requests `api://.../access_as_user` for planning and Team Admin API calls.

`CachedMicrosoft365AuthProvider` wraps the host provider and centralizes token reuse. Tokens are cached by scope set and refreshed before known expiry. Host tokens without an explicit expiry receive a short default cache lifetime.

`MsalAuthProvider` keeps MSAL behind the same provider boundary. A future MSAL token client can implement `MsalTokenClient` without changing UI components, planning services, or repository contracts.

## Client Foundation

`createMicrosoft365ClientFoundation()` provides:

- shared auth provider
- Teams context provider
- Graph client factory
- SharePoint client factory

The SharePoint client is created only when a SharePoint site URL is configured. EO-302 prefers runtime configuration in `config/runtime-config.js`; `VITE_SHAREPOINT_SITE_URL` remains a local-development and packaging fallback.

EO-304 hardens this boundary. Runtime SharePoint configuration is accepted only for HTTPS `*.sharepoint.com` URLs. Graph client requests are restricted to `https://graph.microsoft.com`; SharePoint client requests are restricted to the configured SharePoint site origin. Failed URL validation returns a typed repository validation error instead of issuing a network request.

```text
VITE_SHAREPOINT_SITE_URL=https://contoso.sharepoint.com/sites/planning
```

EO-105 activates SharePoint-backed planning reads with runtime configuration or this build-time fallback:

```text
VITE_PLANNING_DATA_SOURCE=sharepoint
```

EO-405 API token scopes can be configured at runtime or build time:

```text
apiAccessTokenScopes: ["api://00000000-0000-0000-0000-000000000002/access_as_user"]
VITE_API_ACCESS_TOKEN_SCOPES=api://00000000-0000-0000-0000-000000000002/access_as_user
```

The Teams manifest must include matching `webApplicationInfo.id` and `webApplicationInfo.resource` values so `microsoftTeams.authentication.getAuthToken()` can mint a token for the API resource.

## EO-405 Deployment Checklist

The following items must be complete before any public or shared deployment that exposes the API-backed planning experience.

### Entra App Registration

1. Confirm that the RPP API app registration uses the same client id and audience as the repository configuration:
	- `AzureAd:ClientId`
	- `AzureAd:Audience`
	- `teams-app-package/manifest.json -> webApplicationInfo.id`
	- `teams-app-package/manifest.json -> webApplicationInfo.resource`
2. Under `Expose an API`, publish the delegated scope `access_as_user` for the API audience.
3. Under `Authentication`, ensure the frontend host URLs and Teams tab origin are registered where required by the chosen hosting model.
4. Keep confidential values such as `ClientSecret` outside source control, for example in user secrets, Key Vault, or deployment secrets.

### API Authorization

1. Keep `ApiSettings:RequireAuthentication=true` in every shared, test, staging, and production deployment.
2. Keep `AzureAd:Scopes` set to `access_as_user` so `[RequiredScope]` on the planning API accepts only the intended delegated user token.
3. Verify that anonymous calls to `/api/planning/*` return `401` and that valid user tokens return `200`.
4. Verify that Graph application permissions for the server-side member sync are granted separately from delegated user access to the RPP API.

### Frontend Runtime Configuration

1. Set `planningDataSource: "api"` only when `apiBaseUrl` points to the protected RPP Web API.
2. Set `apiAccessTokenScopes` to the deployed API scope, for example `api://<api-client-id>/access_as_user`.
3. Keep the runtime configuration and the Teams manifest aligned with the same Entra application ids.
4. Validate that the browser requests the API token, not a Graph token, before calling the planning or Team Admin endpoints.

### Teams Package

1. Keep `webApplicationInfo.id` equal to the Entra application client id.
2. Keep `webApplicationInfo.resource` equal to the API audience, for example `api://<api-client-id>`.
3. Rebuild and repackage the Teams app after manifest changes.
4. Reinstall or update the Teams package in the tenant used for end-to-end verification.

### Tenant Verification

1. Grant tenant admin consent for all required Graph application permissions and delegated API permissions.
2. Open the app inside Microsoft Teams, not only in a standalone browser.
3. Confirm that `microsoftTeams.authentication.getAuthToken()` succeeds for the deployed tab.
4. Confirm that planning bootstrap, timeline reads, and Team Admin requests succeed with the authenticated user context.
5. Confirm that missing permission or invalid audience cases surface as `401` or `403` instead of silently falling back in shared environments.

### Public Deployment Gate

Do not publicly deploy the API-backed application until all checklist items above are verified in the target tenant. EO-405 is not complete for public exposure if local browser bypass works but Teams SSO, manifest wiring, delegated scope consent, or API audience validation are still unverified.

## EO-405 Entra Setup Walkthrough

Use this sequence when setting up or repairing the tenant configuration for the RPP API and Teams tab.

### 1. Register or Identify the API App

1. Open Microsoft Entra admin center.
2. Navigate to `App registrations`.
3. Open the existing RPP API registration or create a new registration for the protected API.
4. Record the `Application (client) ID`.
5. Keep the repository values aligned with that id:
	- `RppWebApi/appsettings.json -> AzureAd:ClientId`
	- `teams-app-package/manifest.json -> webApplicationInfo.id`

### 2. Expose the API Audience and Scope

1. In the API app registration, open `Expose an API`.
2. Set the Application ID URI to the audience used by the API, for example `api://<api-client-id>`.
3. Add the delegated scope `access_as_user`.
4. Keep the scope name aligned with `RppWebApi/appsettings.json -> AzureAd:Scopes`.
5. Keep the audience aligned with:
	- `RppWebApi/appsettings.json -> AzureAd:Audience`
	- `teams-app-package/manifest.json -> webApplicationInfo.resource`
	- `public/config/runtime-config.js -> apiAccessTokenScopes`

### 3. Configure API Secrets and Hosting Identity

1. Decide whether the API uses a client secret, certificate, or managed identity for downstream Graph calls.
2. If a client secret is required, create it under `Certificates & secrets`.
3. Do not store the secret in source control.
4. Store the secret in a secure configuration source such as:
	- .NET user secrets for local development
	- deployment environment variables
	- Azure Key Vault or equivalent secret storage
5. Keep `RppWebApi/appsettings.json` as a placeholder-only file for `ClientSecret`.

### 4. Grant Graph Permissions for Server-Side API Work

1. In the same API app registration, open `API permissions`.
2. Add the Microsoft Graph application permissions required by the backend services.
3. Keep these permissions separate from the delegated `access_as_user` permission used by the frontend.
4. Grant admin consent for the Graph application permissions.
5. Recheck backend features that depend on Graph, especially team membership loading.

### 5. Wire the Teams App to the Same API Resource

1. Open `teams-app-package/manifest.json`.
2. Set `webApplicationInfo.id` to the Entra application client id.
3. Set `webApplicationInfo.resource` to the exposed API audience, for example `api://<api-client-id>`.
4. Repackage the Teams app after any manifest change.
5. Upload or update the package in the target Teams tenant.

### 6. Configure the Frontend Runtime Token Scope

1. Open `public/config/runtime-config.js` for local/default runtime configuration, or the deployed `dist/config/runtime-config.js` for the target environment.
2. Set `apiBaseUrl` to the protected RPP Web API.
3. Set `apiAccessTokenScopes` to the delegated API scope, for example `api://<api-client-id>/access_as_user`.
4. Keep `planningDataSource` on `api` only when the API environment is reachable and authentication is correctly configured.
5. If build-time fallback is needed, set `VITE_API_ACCESS_TOKEN_SCOPES` to the same scope value.

### 7. Lock the API to Authenticated User Tokens

1. Keep `ApiSettings:RequireAuthentication=true` in every non-local deployment.
2. Keep `AzureAd:Scopes` set to `access_as_user`.
3. Start the API and verify that anonymous requests to `/api/planning/absences` receive `401`.
4. Verify that a valid Teams-issued bearer token for the same audience receives `200`.
5. Treat any success without authentication in shared environments as a deployment blocker.

### 8. Perform End-to-End Verification in Teams

1. Open the deployed app inside Microsoft Teams.
2. Sign in with a user who has access to the tenant and consented application.
3. Confirm that Teams SSO returns a token for the API audience.
4. Confirm that planning bootstrap loads successfully.
5. Confirm that Timeline, Team Capacity, and Team Admin API requests succeed without local-development bypass.
6. Confirm that permission or audience mismatches fail as `401` or `403` and are visible during testing.

### 9. Promote Only After Tenant Verification

1. Finish the full verification in the target tenant first.
2. Promote the same aligned values for app id, audience, scope, manifest, and runtime configuration to the next environment.
3. Re-run one Teams-hosted smoke test after every tenant or manifest change.
4. Do not treat a standalone browser success with disabled auth as EO-405 completion.

## Graph Client

`FetchMicrosoftGraphClient` encapsulates:

- token acquisition
- authorization header creation
- request execution
- Graph response parsing
- Graph/network error mapping
- EO-010 logging for failed requests

Consumers receive `GraphResult<T>` rather than raw `fetch` responses.

EO-203 extends the client beyond reads. The supported operations are now `get`, `post`, `patch`, and `delete`. Outlook synchronization uses these methods only through `GraphCalendarAdapter`, which targets the authenticated user's `/me/events` collection and requires `Calendars.ReadWrite`.

## SharePoint Client

`FetchSharePointClient` encapsulates SharePoint REST reads through the same Microsoft 365 auth foundation.

The client maps failed HTTP responses and network errors to typed `RepositoryError` results. EO-105 read repositories use this client for SharePoint list reads. SharePoint write/delete operations are not implemented yet.

## Team Membership Provider

`GraphTeamMembershipProvider` reads team members through Microsoft Graph and maps them to the existing domain `TeamMembership` contract.

Behavior:

- Resolves the current Microsoft Teams / M365 group id through `TeamsContextProvider`.
- Calls `/groups/{id}/members` with selected user identity fields, including `companyName` and `officeLocation`.
- Includes guests.
- Maps Graph users to normalized `TeamMembership` records.
- Exposes user id, display name, e-mail, guest/member status, protected avatar URL, organisation (`companyName` → Firma) and location (`officeLocation` → Standort). On the API path the server re-reads those two fields from `/users/{id}` when the members collection omits them, then applies Team Admin profile-value mappings (EO-415). Unmapped raw values are shown as-is; there is no Organisation-A/Organisation-B hardcode.
- Maps Graph `@odata.nextLink` to the repository `nextPageToken`.
- Logs failed membership reads through EO-010 when a logger is provided by the application shell.

## Activation

Mock membership remains the default.

Use runtime configuration from EO-302 or this Vite environment fallback to activate Graph-backed team membership:

```text
VITE_PLANNING_MEMBERSHIP_SOURCE=graph
```

Team membership is switched by EO-103. Planning data reads are switched by EO-105 with `planningDataSource: "sharepoint"` or `VITE_PLANNING_DATA_SOURCE=sharepoint`.

## Boundaries

EO-108 does not implement:

- Outlook sync
- Presence
- Calendar
- Mail
- Approval
- UI
- SharePoint repositories
- data synchronization strategy

EO-103 additionally does not implement employee master-data administration, a SharePoint employee list, Outlook sync, presence, approvals, or new UI.

EO-104 additionally does not implement Team Membership behavior changes, SharePoint repository CRUD, Outlook, Presence, Calendar, or business logic.

EO-105 additionally does not implement SharePoint save/delete, approvals, Outlook sync, presence, calendar, or new planning business rules.

EO-203 implements the Outlook calendar integration boundary but does not implement shared calendars, delegated calendars, Teams Presence, Adaptive Cards, public folder calendars, or conflict resolution for manually edited calendar entries.

EO-304 implements client-side security guardrails and deployment validation. It does not replace Microsoft Entra ID, tenant conditional access, admin consent review, SharePoint permission design, or production hosting security headers.
