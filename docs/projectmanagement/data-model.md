# Data Model

EO-004 introduces typed mock resource summary data for the Sprint 1 prototype. Active models include shell routing in `src/models/navigation.ts`, timeline presentation infrastructure in `src/models/timeline.ts`, and compact row context in `src/models/resource.ts`.

The timeline model describes visual structure only: days, months, weeks, and placeholder employee rows. It does not represent vacation, projects, capacity, SharePoint items, Graph data, or approval workflows.

`ResourceSummary` contains only the fields required by the sticky row summary and Sprint 1 capacity prototype: display name, initials, organization, primary team, additional teams, optional employment rate, optional working days, and vacation balance. It does not include employee details, contacts, delegations, projects, or backend persistence fields.

EO-006 adds `TeamResourceGroup` as a view model for grouping resources by `primaryTeam`. This is presentation structure, not storage structure. Secondary teams remain memberships on the resource and do not create duplicate timeline rows.

EO-007 adds `PlanningEvent` as mock presentation data for the integrated planning view. Events include resource id, type, title, start date, and end date. EO-011 allows absence-backed planning events to reference an `absenceId`; non-absence events remain read-only prototype data.

EO-008 adds `DetailsPanelState` as UI state for the universal side panel. It can reference a `ResourceSummary`, a `PlanningEvent`, an absence create/edit state, or a closed state. It is not persistent data and must not be stored as a backend entity.

EO-011 adds `Absence` as an editable Sprint 1 entity. Required fields are id, employee id, type, start date, start half, end date, end half, duration, created, and modified. Substitute and comment are optional. As of EO-100 the current implementation persists through mock repositories; future SharePoint integration must map this interface through repository implementations.

EO-013 adds `CapacityResult` as a calculated result, not persistent data. Each result includes employee id, date, nominal capacity, absence capacity, available capacity, working-day flag, and public-holiday flag. Capacity results are deterministic and must be regenerated from resource, absence, working model, and public-holiday inputs.

EO-014 adds `TeamCapacitySummary` and `TeamCapacityWeek` as dashboard view models. They aggregate EO-013 results by team and calendar week. These objects are not persistent entities and must not replace the capacity engine as the source of truth.

EO-200 adds the Microsoft 365 approval integration model without changing the planning model. `VacationRequest`, `ApprovalPolicy`, `VacationRequestStatus`, `ApprovalProvider`, `PlanningRole`, `PowerAutomateApprovalInput`, and `PowerAutomateApprovalOutput` live in `src/models/approval.ts`. These types describe the boundary around absence-request approval. They do not replace `Absence`, do not change capacity calculation inputs, and do not introduce an approval inbox.

Vacation request statuses are `draft`, `submitted`, `pendingApproval`, `approved`, `rejected`, `cancelled`, and `failed`. Only `approved` requests may enter the active planning state. `rejected`, `cancelled`, and `failed` requests do not affect timeline or capacity.

Approval policies are configuration records keyed by team and planning role. Guest users are directly released by the application with provider `none`, while role-based exemptions such as department heads are configured through policies with `approvalRequired: false`. Requests that require approval use provider `microsoftApprovals` and store an `approvalReferenceId` returned by Power Automate.

EO-201 adds `ApprovalRoutingRule` as the explicit approver assignment model. A routing rule is scoped to one team and one requester user id, may disable approval for that requester, and otherwise supplies exactly one approver user id. Approvers are not inferred from Microsoft Graph, Entra ID, Teams permissions, job titles, or manager metadata.

`ApprovalPolicyEvaluation` now carries the `policyId`, optional `routingRuleId`, and explicit `approverId` required by EO-202 to start the Microsoft 365 workflow. Missing policies fall back to the default policy set. Missing, duplicate, or invalid routing rules produce configuration errors instead of starting an approval flow.

EO-202 promotes `VacationRequest` into the lifecycle entity for absence approval. It stores request data, approval status, `approverUserId`, optional Microsoft `approvalReferenceId`, and an independent `syncToOutlook` flag. `VacationRequestDraft` represents editable draft input before submission.

Editable lifecycle states are `draft`, `rejected`, and `failed`. `pendingApproval` is owned by Microsoft Approvals, and `approved` is the only state eligible for active planning consumption. Rejected requests remain stored and can be edited back into a new draft before resubmission.

EO-206 adds the personal settings model under `src/features/settings/types/settingsTypes.ts`. `UserSettings` stores personal overrides such as preferred approver, notification preferences, Outlook sync mode, and read-only locale values. `EffectiveUserSettings` combines the user profile, team context, resolved default/fallback approvers, permissions, allowed approvers, and the stored user settings into one page-ready view model.

Permissions control editability. The UI must not hide policy-managed settings; it shows them disabled with a policy-managed hint.

EO-203 adds `OutlookSync` to `VacationRequest`. The sync state includes whether synchronization is enabled, the linked Microsoft Graph event id, sync status (`notRequired`, `pending`, `synced`, `failed`), optional last sync timestamp, and optional last error.

Draft requests are not synchronized. Submitted and pending requests can create Outlook events. Approved requests update the existing event. Rejected and cancelled requests delete the linked event. The approval status remains authoritative; Outlook is a personal planning projection.

EO-204 adds the feature-local vacation balance model under `src/features/vacation-balances/types/vacationBalance.ts`. `VacationBalance` represents one user's annual entitlement, carry forward, manual adjustments, pending vacation, approved vacation, and remaining balance for one vacation year.

The remaining balance is calculated as annual entitlement plus carry forward plus manual adjustments minus approved vacation minus pending vacation. Submitted and `pendingApproval` vacation requests count as pending vacation. Approved requests count as approved vacation. Draft, rejected, cancelled, and failed requests do not reduce the displayed current balance.

`VacationBalancePreview` represents the request-creation projection: current balance, requested vacation, remaining balance after submission, and whether the request exceeds the available balance. This is a warning signal in Sprint 3, not a hard validation block.

`VacationBalanceAdjustment` represents manual administrator corrections with adjustment value, reason, administrator, timestamp, previous manual-adjustment value, and new manual-adjustment value. Adjustment history is an audit record for manual changes only; it is not a complete vacation-request lifecycle log.

## EO-100 Persistence Contracts

EO-100 adds persistence-facing contracts without introducing real storage implementations:

- `GraphUserIdentity` in `src/models/identity.ts` represents identity data supplied by Microsoft Graph.
- `TeamMembership` in `src/models/identity.ts` represents Microsoft Teams membership and is the source for plannable people.
- `VacationBalanceRecord` in `src/models/planningSettings.ts` stores planning-specific vacation allowance facts by employee id.
- `ResourcePlanningProfile` in `src/models/planningSettings.ts` stores planning-only capacity configuration such as employment rate and working days.
- `PlanningSettings` groups planning configuration returned by the settings repository.

There is still no persistent `Employee` master-data model. Current `ResourceSummary` objects are composed by `src/services/planningDataService.ts` from Teams membership, vacation balances, and planning settings. This keeps identity and membership data in Microsoft 365 while allowing the UI to continue using compact view models.

Repository interfaces in `src/repositories/planningRepositories.ts` are the anti-corruption layer between the application and future Graph/SharePoint implementations.

EO-102 expands these interfaces into complete domain contracts:

- query inputs
- paged return values
- typed repository errors
- mutation results
- team membership provider contract
- team planning configuration repository contract

These are still domain contracts, not SharePoint or Graph implementations.

## EO-101 SharePoint Information Architecture

EO-101 adds `src/models/sharePointInformationArchitecture.ts` as the typed definition of planning-only SharePoint lists and fields.

SharePoint lists:

- `Absences`
- `VacationBalances`
- `PlanningSettings`
- `PublicHolidays`
- `TeamPlanningConfiguration`

SharePoint does not store an `Employees` list and does not persist Graph-owned identity data such as display name, e-mail, avatar, job title, department, or team membership.

`VacationBalanceRecord` deliberately stores only `year`, `allowanceDays`, `carriedOverDays`, `manualAdjustmentDays`, and optional comment. Booked and remaining days are derived from absences by the application.

EO-101-A extends the same schema with technical metadata:

- unique keys
- indexes
- searchable fields
- reference definitions

These metadata objects describe SharePoint list behavior for future repository mapping but are not repository code and do not call SharePoint APIs.

## Future Planning Model

Later Engineering Orders should introduce planning entities only when required:

- Employee
- Team
- Skill
- Organization
- Capacity risk
- School holiday

Employees must support multiple teams, multiple skills, and multiple roles. Do not model the product as `employee -> one team`.

SharePoint List integration must map to TypeScript interfaces through service classes. UI components must not call SharePoint APIs directly.
