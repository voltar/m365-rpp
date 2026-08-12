# Repository Contracts

EO-102 defines the contracts between the application domain and future infrastructure providers.

No SharePoint, Graph, authentication, REST, or UI code is implemented here.

## Result Model

Repository operations return `RepositoryResult<T>`:

- `ok: true` carries the requested value.
- `ok: false` carries a `RepositoryError`.

Error codes:

- `conflict`
- `forbidden`
- `noTeamContext`
- `notFound`
- `network`
- `timeout`
- `unknown`
- `validation`

Every error declares whether it is recoverable.

### `noTeamContext` (EO-428)

No team could be resolved for the request. Kept apart from `forbidden` because the two have nothing
in common as remedies: `forbidden` means the caller may not see this team and has to talk to an
administrator, `noTeamContext` means nobody has said which team is meant and the caller can fix it
themselves. Reporting the second as the first is what sent a legitimate user to their administrator
on 2026-07-26.

The API answers HTTP 428 with a body of `{ "code": "noTeamContext" }`. Clients should read the body
code and treat the status as a fallback, so the distinction survives a proxy that rewrites an
unusual status. The error is always recoverable; the planning bootstrap maps it to its own
`noTeamContext` state, which offers a team selection instead of an error banner.

## Paging

List operations accept `RepositoryPageRequest`:

- `pageSize`
- `pageToken`

List operations return `RepositoryPage<T>`:

- `items`
- `nextPageToken`

Application services may load all pages when a complete planning snapshot is required.

## Query Contracts

Contracts define explicit query objects:

- `AbsenceQuery`
- `VacationBalanceQuery`
- `HolidayQuery`
- `PlanningSettingsQuery`
- `PlanningEventQuery`
- `TeamMembershipQuery`
- `TeamPlanningConfigurationQuery`

## Interfaces

Repository and provider interfaces:

- `ITeamMembershipProvider`
- `IAbsenceRepository`
- `IVacationBalanceRepository`
- `IHolidayRepository`
- `IPlanningSettingsRepository`
- `IPlanningEventRepository`
- `ITeamPlanningConfigurationRepository`

EO-200 adds Microsoft 365 approval integration contracts in `src/repositories/approvalRepositories.ts`:

- `IApprovalPolicyRepository`
- `IApprovalRoutingRepository`
- `IVacationRequestRepository`
- `IApprovalIntegrationRepository`

Approval repositories use the same `RepositoryResult<T>`, `RepositoryPage<T>`, and `RepositoryPageRequest` contracts as planning repositories. Approval policy queries support team, planning role, and enabled-state filtering so the decision whether approval is required remains configuration-driven.

EO-201 expands policy and routing configuration with CRUD-style operations:

- `getPolicy`, `savePolicy`, `updatePolicy`, `deletePolicy`
- `getRouting`, `saveRouting`, `updateRouting`, `deleteRouting`

Routing queries support team, requester user id, routing-rule id, and enabled-state filtering. A valid routing result is explicit: one requester maps to one approver within one planning team. Duplicate routing matches are configuration errors.

`IApprovalIntegrationRepository` represents the Power Automate contract. It starts a Microsoft Approvals-backed flow with `PowerAutomateApprovalInput` and returns `PowerAutomateApprovalOutput`, including `approvalReferenceId`, `flowRunId`, and provider status.

## Boundary Rules

The domain owns these interfaces. Future SharePoint and Graph implementations must implement the contracts without changing UI components or business services.

Mock providers remain valid implementations of the same contracts.

EO-301 keeps the repository contracts unchanged but improves how planning views consume them. `bootstrapPlanningState()` caches successful snapshots per `PlanningRepositories` composition and deduplicates concurrent loads. Repository implementations should still be idempotent and page-aware; UI navigation should not trigger duplicate reads when an equivalent snapshot is already available.

Approval repositories are separate from planning repositories. `approvalIntegrationService` can evaluate policies, start the Power Automate integration, persist request status, and apply approval callbacks. It does not calculate capacity, render approval UI, save approved absences into the planning repository, or implement a custom Microsoft Teams Approval Inbox.

EO-202 extends `IVacationRequestRepository` with `deleteVacationRequest()` for editable lifecycle records. Draft creation, draft update, deletion, submission, and callback processing remain service responsibilities in `approvalIntegrationService`; repository implementations only persist request state.

EO-206 introduces a feature-local settings API boundary in `src/features/settings/services/settingsApi.ts`:

- `getMySettings()`
- `patchMySettings()`
- `resetMySettings()`

The current implementation is mock-backed. Future persistence may move this boundary to SharePoint, Graph, or an API endpoint while keeping `EffectiveUserSettings` as the page contract.

EO-203 introduces `src/features/outlook-sync/` as a Microsoft 365 integration boundary:

- `GraphCalendarAdapter` maps vacation requests to Microsoft Graph calendar operations.
- `OutlookSyncService` owns create/update/delete/retry decisions.
- `SyncQueue` handles vacation lifecycle events.
- `createPersistingSyncQueue()` writes sync status back through `IVacationRequestRepository`.

The adapter uses Microsoft Graph `/me/events` and requires `Calendars.ReadWrite`. Repository and UI layers must not call Graph directly.

EO-204 introduces a feature-local vacation balance API boundary in `src/features/vacation-balances/services/vacationBalanceApi.ts`:

- `getMyVacationBalance()`
- `getEmployeeVacationBalance()`
- `updateVacationBalance()`
- `getBalanceHistory()`
- `previewVacationRequest()`

The current implementation is mock-backed and calculates the authoritative display balance inside the service boundary. UI components receive calculated values and do not persist or recalculate official balances themselves. Future SharePoint/API implementations should keep the same contract shape while moving official calculation to the backend.
