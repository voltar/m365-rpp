# Sprints

This document defines the implementation roadmap for the **Resource Presence Planner**.

The roadmap is intentionally organized into a small number of focused sprints. Each sprint has a clearly defined objective and delivers a usable increment of the application.

The project follows a **Domain First** approach:

- Microsoft Teams manages people.
- Microsoft Graph provides identities and memberships.
- SharePoint stores planning-specific data.
- The application contains the business logic.

---

# Sprint 1 — Application Foundation

## Goal

Deliver a professional, interactive Microsoft Teams application that demonstrates the complete planning experience using typed mock data.

At the end of Sprint 1 the application behaves like a real product although no persistent backend exists yet.

## Scope

- Microsoft Teams look & feel
- Fluent UI
- Responsive layout
- Horizontal navigation
- Timeline / Gantt planning
- Resource summary cards
- Universal Details Side Panel
- Half-day vacation model
- Interactive absence management
- Drag & Drop timeline editing
- Capacity Calculation Engine
- Team Capacity Dashboard
- Observability Foundation
- Localization
- Typed mock data

## Engineering Orders

| EO | Description |
|----|-------------|
| EO-001 | Project Foundation |
| EO-002 | Domain Model |
| EO-003 | Main Layout |
| EO-004 | Timeline |
| EO-005 | Resource Summary |
| EO-006 | Planning Foundation |
| EO-007 | UX Review |
| EO-008 | Universal Details Side Panel |
| EO-009-A | Horizontal Navigation |
| EO-009-B | Half-Day Absence Rule |
| EO-009-C | Information Density Optimisation |
| EO-009-D | Timeline Density Refinement |
| EO-010 | Observability Foundation |
| EO-011 | Create & Manage Absences |
| EO-012 | Interactive Timeline Editing |
| EO-013 | Capacity Calculation Engine |
| EO-014 | Team Capacity Dashboard |
| EO-015 | Skipped |
| EO-016 | Microsoft 365 Localization Integration |

## Deliverable

A fully interactive planning application suitable for demonstrations, user validation and UX feedback.

Persistence is intentionally not yet implemented.

---

# Sprint 2 — Persistence & Microsoft 365 Foundation

## Goal

Replace mock data with persistent planning data while integrating seamlessly into the Microsoft 365 ecosystem.

The application continues to own the business logic while Microsoft 365 becomes the authoritative source for identities and team membership.

## Architecture

```text
Microsoft Teams
        │
        ▼
Microsoft Graph
(Team Membership)
        │
        ▼
Repository Layer
        │
        ▼
SharePoint Online Lists
        │
        ▼
Planning Engine
```

## Architectural Principles

### Microsoft Teams

System of Record for team membership.

Adding or removing a team member automatically affects the planning application.

No separate employee administration exists.

### Microsoft Graph

Provides

- User identities
- Display names
- Photos
- Email addresses
- Team membership

No employee master data is duplicated.

### SharePoint Online

Stores only planning-specific information.

Examples:

- Absences
- Vacation balances
- Planning settings
- Team configuration
- Public holidays

### Application

Owns all business logic.

Examples:

- Half-day calculations
- Capacity calculations
- Timeline rendering
- Team capacity aggregation

---

## Engineering Orders

| EO | Description |
|----|-------------|
| EO-100 | Persistence Architecture |
| EO-101 | SharePoint Information Architecture |
| EO-101-A | SharePoint Information Architecture Refinement |
| EO-102 | Repository Foundation & Domain Contracts |
| EO-108 | Authentication & Microsoft Graph Integration |
| EO-103 | Microsoft Teams Membership Provider |
| EO-104 | Microsoft 365 Authentication & Client Foundation |
| EO-105 | Data Loading & Application Bootstrap |

Additional Engineering Orders may be added as implementation progresses.

### EO-100 Status

EO-100 establishes the repository and application-service boundary. It defines interfaces for Teams membership, absences, vacation balances, holidays, planning events, and planning settings, and keeps mock repositories usable until EO-101 and EO-102 introduce real SharePoint and Microsoft Graph implementations.

No SharePoint Lists, Graph calls, authentication, migration, Outlook sync, or new UI are implemented in EO-100.

### EO-101 Status

EO-101 defines the SharePoint information architecture for planning-specific data. The required lists, fields, identity references, and forbidden duplicated Graph fields are documented and represented in typed schema metadata.

No repositories, CRUD operations, Graph calls, UI, migration, or Outlook sync are implemented in EO-101.

### EO-101-A Status

EO-101-A completes the technical SharePoint information architecture by defining unique keys, minimum indexes, searchable fields, and stable reference strategy for the planning lists.

No repositories, CRUD operations, Graph calls, SharePoint API calls, UI, migration, or business logic are implemented in EO-101-A.

### EO-102 Status

EO-102 defines the repository and provider contracts used by future persistence implementations. Contracts now include query inputs, paging, typed result/error handling, and separate interfaces for team membership, planning settings, planning events, absences, vacation balances, holidays, and team planning configuration.

No SharePoint, Graph, authentication, MSAL, REST calls, CRUD infrastructure, or UI are implemented in EO-102.

### EO-108 Status

EO-108 introduces centralized Microsoft 365 authentication and Graph infrastructure before EO-103 wires team membership into the active data source.

Implemented:

- Teams SSO auth provider contract and implementation.
- Teams context provider contract and implementation.
- Encapsulated Microsoft Graph client.
- Authenticated Graph team membership provider implementing `ITeamMembershipProvider`.
- Initial permission documentation for `User.Read`, `GroupMember.Read.All`, and `Team.ReadBasic.All`.

No Outlook sync, presence, calendar, mail, approval workflow, SharePoint repositories, UI, or data synchronization strategy is implemented in EO-108.

### EO-103 Status

EO-103 wires authenticated Microsoft Teams membership into the repository composition while keeping Microsoft Teams / Graph as the source of truth for plannable people.

Implemented:

- Default repository factory composes planning repositories at the application boundary.
- Mock membership remains the default for local development and demos.
- `VITE_PLANNING_MEMBERSHIP_SOURCE=graph` activates Graph-backed team membership.
- Current Teams/M365 group id is resolved through Teams context.
- Team members are loaded through Microsoft Graph `/groups/{id}/members`.
- Graph paging is mapped to the EO-102 repository paging contract.
- Guests are included and normalized as plannable people.
- User id, display name, e-mail, guest/member status, and protected avatar URL are available in normalized `TeamMembership` objects.
- Timeline and team capacity views consume only the repository contract and do not handle Graph, Teams SDK, or tokens.

No SharePoint employee list, employee master-data administration, Outlook sync, presence, approval workflow, or new UI is implemented in EO-103.

### EO-104 Status

EO-104 introduces the shared Microsoft 365 client foundation used by future Graph and SharePoint infrastructure.

Implemented:

- Central Microsoft 365 client foundation factory.
- Shared Teams SSO authentication basis.
- Cached auth provider for central token lifecycle handling.
- MSAL auth adapter contract for future host scenarios.
- Graph client creation through the shared foundation.
- SharePoint REST client creation through the shared foundation.
- `VITE_SHAREPOINT_SITE_URL` configuration hook for SharePoint client creation.
- EO-010 logging for auth, Graph, and SharePoint client failures.
- Localized EO-010 error banner in planning views when repository/client loading fails.
- EO-103 Graph membership now uses the shared client foundation.

No Team Membership feature change, SharePoint repository CRUD, Outlook, Presence, Calendar, or business logic is implemented in EO-104.

### EO-105 Status

EO-105 loads the initial planning state through the repository layer before operational planning views render.

Implemented:

- Planning bootstrap service with loading, ready, empty, and error states.
- Retry flow for failed or empty planning bootstrap.
- SharePoint read repositories for `Absences`, `VacationBalances`, `PublicHolidays`, `PlanningSettings`, and `TeamPlanningConfiguration`.
- `VITE_PLANNING_DATA_SOURCE=sharepoint` activates SharePoint-backed planning reads.
- `VITE_SHAREPOINT_SITE_URL` supplies the SharePoint site for persistent planning data.
- Team configuration is loaded into the planning snapshot.
- Timeline and team capacity views wait for a consistent planning snapshot before rendering their operational surfaces.
- Capacity Engine receives resources, absences, public holidays, and settings from the same bootstrap snapshot.
- Loading, error, and empty states are localized and logged through EO-010.

EO-105 does not implement SharePoint save/delete, approval workflow, Outlook sync, presence, calendar, or new planning business rules. SharePoint writes remain intentionally reserved for EO-106.

---

## Business Rules

### Team Membership

Every Microsoft Teams member is considered a plannable person.

No separate employee administration exists.

### Guests

Guest users participate in planning like every other team member.

Guests

- appear in the planning
- can have absences
- contribute to capacity calculations

Guest absences do not require an approval workflow.

### Employee Lifecycle

Joining a Team

→ Add member to Microsoft Teams

Leaving a Team

→ Remove member from Microsoft Teams

No additional maintenance is required inside the application.

---

## Deliverable

Persistent planning application backed by SharePoint Online Lists with Microsoft Teams acting as the authoritative source for team membership.

---

# Sprint 3 — Operational Planning

## Goal

Complete the operational planning experience by integrating personal planning with Microsoft 365 approval services and later Microsoft Outlook integration.

## Scope

- My Absences
- Microsoft 365 Approval Integration Architecture
- Outlook Calendar Synchronization
- Vacation balances
- Synchronization conflict handling
- Improved planning workflow

## Deliverable

A practical day-to-day planning solution for team members and team leaders.

## Engineering Orders

| EO | Description |
|----|-------------|
| EO-200 | Microsoft 365 Approval Integration Architecture |
| EO-201 | Approval Policies & Approval Routing Configuration |
| EO-202 | Vacation Request Lifecycle & Microsoft 365 Approval Submission |
| EO-203 | Outlook Calendar Synchronization |
| EO-204 | Vacation Balances |
| EO-205 | Team Admin Center |
| EO-206 | My Settings |
| EO-301 | Performance Baseline |
| EO-302 | Deployment |
| EO-303 | Monitoring |

### EO-200 Status

EO-200 introduces the Microsoft 365 approval integration architecture for absence requests without adding a custom approval UI.

Implemented:

- Approval domain model for vacation requests, policies, request status, providers, planning roles, and Power Automate contracts.
- Approval repository contracts for policies, vacation requests, and Microsoft 365 approval integration.
- Mock approval repositories for local development and later service wiring.
- Approval integration service that evaluates enabled team- and role-specific policies.
- Power Automate is represented as the workflow orchestrator for Microsoft Approvals.
- Vacation requests store approval status, provider, approval reference id, and flow run context.
- Guest requests are directly released by the workflow.
- Department-head or similar exemptions are represented by policy configuration instead of organizational hardcoding.
- Planning repositories, capacity calculation, and UI components remain separate from Power Automate implementation details.

EO-200 does not implement a custom Approval Inbox, custom Approval Cards, reminders, notifications, audit trail, Outlook sync, multi-step approvals, delegations, escalations, or UI changes.

### EO-201 Status

EO-201 introduces explicit approval policy and routing configuration.

Implemented:

- Planning roles remain application-domain roles, independent from Entra ID, Teams permissions, job titles, or Graph manager data.
- Approval policies decide whether approval is required for a team and planning role.
- Default policies keep new teams usable when no team-specific policy exists.
- Approval routing rules explicitly map one requester to one approver within one planning team.
- Policy and routing repositories expose get, save, update, and delete operations.
- Missing, duplicate, or invalid routing rules are configuration errors and are logged through EO-010.
- The approval evaluation returns `approvalRequired`, `approverId`, `policyId`, and `routingRuleId` for EO-202.

EO-201 does not implement Power Automate flows, Microsoft Approvals UI, Adaptive Cards, Outlook notifications, delegations, escalations, multi-step approvals, substitutes, or the Team Settings administration UI planned for EO-205.

### EO-202 Status

EO-202 implements the vacation request lifecycle up to the Microsoft 365 approval submission boundary.

Implemented:

- Vacation requests can be saved as drafts.
- Drafts can be updated or deleted before submission.
- Rejected and failed requests can be edited back into drafts and resubmitted.
- `submitVacationRequest()` is the only operation that starts Microsoft Approvals through the Power Automate contract.
- The default approver comes from EO-201 approval routing.
- User-selected alternate approvers are accepted only when allowed by routing configuration.
- A localized `VacationRequestForm` component exposes Save Draft and Submit for Approval actions for future page integration.
- Requests store `approverUserId`, `approvalReferenceId`, and independent `syncToOutlook`.
- Approval callbacks update pending requests to approved or rejected.
- Only approved requests are eligible for planning consumption.

EO-202 does not implement Outlook synchronization, Adaptive Cards, Teams chat, reminders, escalations, multi-step approvals, or a custom Approval Inbox.

### EO-203 Status

EO-203 introduces Outlook calendar synchronization for vacation requests.

Implemented:

- `VacationRequest` contains `outlookSync`.
- Microsoft Graph client supports POST, PATCH, and DELETE.
- `Calendars.ReadWrite` scope is defined.
- Graph calendar adapter maps vacation requests to `/me/events`.
- Outlook sync service creates events for submitted/pending requests.
- Approved requests update the linked Outlook event.
- Rejected and cancelled requests delete the linked Outlook event.
- One Graph event id is stored per vacation request.
- Sync failures mark status as failed and support retry.
- Sync queue consumes vacation lifecycle events and can persist sync results.
- Status badge and retry button UI components are available.

EO-203 does not implement shared calendars, delegated calendars, Teams Presence, Adaptive Cards, Exchange public folder calendars, Google/Apple calendar sync, or conflict resolution for manually edited Outlook events.

### EO-204 Status

EO-204 introduces centralized vacation balance handling for the My Absences surface.

Implemented:

- `VacationBalance`, `VacationBalancePreview`, and `VacationBalanceAdjustment` are typed in the vacation-balances feature.
- A mock vacation balance API exposes my balance, employee balance, update, history, and request preview operations.
- Remaining balance includes annual entitlement, carry forward, manual adjustments, pending vacation, and approved vacation.
- Submitted and pending approval requests count as pending vacation.
- Approved requests count as approved vacation.
- Draft, rejected, cancelled, and failed requests do not reduce the current balance.
- My Absences renders the balance card, request preview, warning for negative projected balance, manual adjustment entry, and adjustment history.
- Team administrator adjustments require a reason and are stored with audit metadata.
- German and English localization resources cover the new UI.

EO-204 does not implement public-holiday legislation, automatic accrual, employment-percentage proration, payroll/SAP integration, carry-forward rules, expiration rules, or production backend persistence.

### EO-205 Status

EO-205 implements the Team Admin Center for team-level approval and vacation planning administration.

Implemented:

- Administration navigation opens Team Admin Center at `/administration/team-admin`.
- `src/features/team-admin/` contains the page, team selector, settings card, approval policy card, member table, mock API service, and typed settings model.
- Authorized teams are listed for the current team administrator.
- Team lead, member count, default approver, backup approver, and approval policy are visible.
- Default approver, backup approver, user approver override, and Outlook synchronization policy can be changed through the mock API.
- Team members are displayed read-only with e-mail, optional position, employment percentage, vacation balance, active request count, and effective approver.
- The mock API validates team-management permission before loading or saving details.
- EO-206 My Settings consumes the same mock team policy so policy-managed controls reflect Team Admin Center changes.

EO-205 does not implement automatic backup approver activation, multi-level approval workflows, department hierarchy management, organization management, HR master-data administration, Microsoft Entra ID synchronization, vacation balance editing, or production backend persistence.

### EO-206 Status

EO-206 implements the personal My Settings page required by upcoming approval and Outlook steps.

Implemented:

- Settings navigation opens My Settings at `/settings/my`.
- `UserSettings` and `EffectiveUserSettings` are typed in the settings feature.
- A mock settings API exposes get, patch, and reset operations.
- Profile, Approval, Notifications, Outlook Calendar, and Regional settings are separate reusable components.
- Default approver, fallback approver, and approver source are visible.
- Policy-managed settings remain visible and disabled.
- Notification preferences can be updated.
- Outlook sync preference is visible and disabled when team policy manages it.
- Language and time zone are read-only.
- Reset to defaults restores team defaults and removes personal overrides.

EO-206 does not implement Teams Adaptive Cards, real Teams notifications, manual language/time-zone editing, delegation rules, multi-step approvers, substitutes, or Graph mailbox-settings writeback.

### EO-301 Status

EO-301 establishes the Sprint 3 performance baseline without changing functional behavior.

Implemented:

- Heavy route components are lazy-loaded through React `lazy` and `Suspense`.
- Timeline, Team Capacity, My Absences, Team Admin Center, and My Settings build into separate production chunks.
- Navigation preloads lazy route chunks on hover and keyboard focus.
- Planning bootstrap snapshots are cached per repository composition.
- Concurrent planning bootstrap calls are deduplicated.
- Manual retry bypasses the cache with `forceRefresh`.
- Navigation between Timeline and Team Capacity can reuse the same planning snapshot.

EO-301 does not implement functional enhancements, UI redesign, infrastructure scaling, load balancing, offline support, PWA support, or telemetry-based performance automation.

### EO-302 Status

EO-302 establishes the deployment baseline for reproducible releases.

Implemented:

- Runtime configuration is externalized through `public/config/runtime-config.js`.
- The application reads runtime configuration through `src/infrastructure/deployment/runtimeConfig.ts`.
- Build-time `VITE_` values remain supported as local-development fallbacks.
- `index.html` loads runtime configuration before the React bundle.
- `npm run build` writes `dist/release.json`.
- `npm run build:deployment` builds and validates deployable artefacts.
- Deployment validation checks index, assets, runtime configuration, and release metadata.
- `docs/deployment.md` documents build, runtime configuration, validation, and rollback.

EO-302 does not implement infrastructure provisioning, cloud-platform selection, high availability, disaster recovery, auto-scaling, blue/green deployment, or container orchestration.

### EO-303 Status

EO-303 establishes the operational monitoring baseline.

Implemented:

- Monitoring infrastructure is isolated under `src/infrastructure/monitoring/`.
- The EO-010 logger forwards structured events into a bounded monitoring buffer.
- Monitoring events sanitize sensitive keys before storage.
- Application errors are recorded with correlation ids and diagnostic context.
- Application startup time is recorded as a lightweight metric.
- `getMonitoringHealthSnapshot()` reports health, release, source revision, environment, configuration status, recent events, and metrics.
- Static `health.json` is included in deployment artefacts.
- Deployment validation verifies the health artefact.
- `docs/monitoring.md` documents health, logging, metrics, diagnostics, and boundaries.

EO-303 does not implement external monitoring platform integration, 24/7 support, automated incident response, distributed tracing, alerting, SLO reporting, infrastructure monitoring, or business intelligence reporting.

---

# Sprint 4 — Planning Intelligence

## Goal

Provide operational insights that help team leaders make planning decisions.

## Scope

- Critical understaffing analysis
- Capacity warnings
- Coverage indicators
- Capacity heatmaps
- Drill-down analysis
- Planning filters

The focus remains on explainable planning rather than automation.

## Deliverable

Decision support for operational workforce planning.

---

# Sprint 5 — Enterprise Readiness

## Goal

Prepare the application for productive enterprise deployment.

## Scope

- Performance optimisation
- Security review
- Monitoring
- Audit logging
- Accessibility
- Documentation
- Deployment automation
- Operational readiness

## Deliverable

Production-ready Microsoft Teams application suitable for enterprise deployment.

---

# Roadmap Summary

| Sprint | Focus |
|----------|-----------------------------------------------|
| Sprint 1 | Interactive Planning Prototype |
| Sprint 2 | Persistence & Microsoft 365 Integration |
| Sprint 3 | Operational Planning |
| Sprint 4 | Planning Intelligence |
| Sprint 5 | Enterprise Readiness |

---

# Guiding Principles

The application follows a **Domain First Architecture**.

- Microsoft Teams manages people.
- Microsoft Graph provides identity information.
- SharePoint stores planning data.
- The application owns all business logic.

This separation keeps the solution maintainable, testable and allows future migration of the persistence layer without changing the planning engine.
