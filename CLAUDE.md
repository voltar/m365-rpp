# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

M365 Ressourcen & Präsenzplanung (RPP) — an enterprise resource, presence, and capacity planning application for Organisations that runs as a Microsoft Teams tab app. It must look and feel like a native Microsoft product (Fluent UI, Microsoft Design Language), not a SharePoint customization. It was developed originally for Organisation-A and Organisation-B.

Two deliverables live in this repo:

- **Frontend** (repo root): React 18 + TypeScript + Vite + Fluent UI v9 (`@fluentui/react-components`), Teams SDK (`@microsoft/teams-js`).
- **Backend** (`RppWebApi/`): ASP.NET Core Web API with Entra ID / Teams SSO auth, EF Core + SQL Server, Microsoft Graph integration. Tests in `RppWebApi.Tests/` (xUnit + Moq).

## Governance Documents (read before non-trivial work)

- `AGENTS.md` — engineering rules, code quality, and design principles.
- `docs/projectmanagement/ADMIN Scale.md` — product vision and design principles.
- `ARCHITECTURE-POLICY/` — architecture decision records (persistence profiles, host model, …).
- `docs/architecture/architecture.md` — the authoritative architecture reference.
- Keep `README.md`, `CHANGELOG.md`, and architecture docs updated with meaningful changes.

## Commands

Frontend (repo root, Node version in `.nvmrc`):

```bash
npm run dev                  # Vite dev server (localhost:5173)
npm run build                # tsc --noEmit + vite build + release metadata
npm run lint                 # eslint "src/**/*.{ts,tsx}"
npm run build:deployment     # build + validate:deployment + validate:security
npm run validate:repo-hygiene  # what the pre-commit hook runs
npm run install:git-hooks    # wires .githooks/pre-commit into git
```

There is no frontend test runner; type checking (`tsc --noEmit` via `npm run build`) and ESLint are the frontend gates.

Backend:

```bash
cd RppWebApi && dotnet run          # HTTP :5004, HTTPS :5005, Swagger at /swagger
dotnet test RppWebApi.Tests         # run all API tests
dotnet test RppWebApi.Tests --filter "FullyQualifiedName~GetTeamAdminDetails"   # single test
```

Local API secrets (connection string, `AzureAd:ClientSecret`) go into .NET User Secrets — never into committed `appsettings*.json`. Vite env files must stay secret-free (see `.env.example`).

## Architecture

### Layering (strictly enforced)

```
React UI components
  -> Application services (src/services/, feature-local services)
  -> Repository interfaces (src/repositories/planningRepositories.ts, approvalRepositories.ts)
  -> Repository implementations (mock / SharePoint / API / Graph)
  -> Microsoft Graph / SharePoint / RPP Web API
```

- UI components must never call Graph, SharePoint, or fetch APIs directly, and never handle tokens. Microsoft 365 auth/clients live only in `src/infrastructure/microsoft365/`.
- Repository operations return `RepositoryResult<T>` (ok/error with typed error codes) and page via `RepositoryPage<T>` — see `docs/architecture/repository-contracts.md`.
- `src/services/planningDataService.ts` composes repositories into a `PlanningDataSnapshot`; `planningBootstrapService.ts` owns view bootstrap state (loading/ready/empty/error) with snapshot caching and request deduplication.
- `src/services/capacityEngine.ts` is the single source of truth for capacity calculation — dashboards and future features must consume it, never recalculate locally.

### Runtime provider selection (ADR-003)

Provider selection is a **runtime concern, never a build concern** — one build artifact serves all deployments. `public/config/runtime-config.js` (loaded before the React bundle, read via `src/infrastructure/deployment/runtimeConfig.ts`) selects:

- `planningDataSource`: `mock` (demo mode, no backend) | `sharepoint` | `api` (RPP Web API; SQL Server is never a client-side provider — the browser only talks to the API)
- `planningMembershipSource`: `mock` | `graph` (with `api` data source, memberships already come from the API server-side and the browser Graph provider must not override them)
- `approvalMode`: `mock` | `m365`

`VITE_*` env variables are local-dev fallbacks only. Composition happens in `src/repositories/defaultPlanningRepositories.ts` and `defaultApprovalRepositories.ts`.

### Frontend structure

- `src/components/` — reusable UI: app shell, timeline (`timeline/`, `events/`), `resourceSummary/`, `teamGrouping/`, `teamCapacity/`, `detailsPanel/`, `approval/`. The universal right-side details panel (`detailsPanel/`) is the standard interaction pattern for all detail views.
- `src/features/` — feature boundaries with feature-local mock service APIs: `approvals`, `outlook-sync`, `vacation-balances`, `settings`, `team-admin`, `app-admin`, `reports`.
- `src/models/` — typed domain model. Employees have many teams/skills/roles (primary + secondary team); never assume employee → one team.
- `src/data/` — mock seed data and central configuration (absence types, capacity thresholds). UI must not hardcode absence categories or thresholds.
- `src/core/logging/` — use `useLogger()` / injected `Logger`, never direct `console` calls (only `Logger.ts` may touch console). `ApplicationError` carries severity/correlation ID; user-facing errors show a localized message + correlation ID only.
- `src/core/security/` — redaction, safe exception details, trusted outbound URL guards (Graph calls restricted to `https://graph.microsoft.com`; SharePoint calls to the configured site origin).
- Routing is lightweight hash-based routing in `src/components/AppShell.tsx` (typed `AppRoute` entries) with horizontal workspace tabs in `TopNavigation.tsx` — no React Router. Heavy route components are code-split via `React.lazy`.

### Backend structure (`RppWebApi/`)

- `Controllers/PlanningController.cs` serves `/api/planning/*` matching the frontend repository contracts; `ApprovalCallbackController` receives approval flow callbacks; `HealthController` for health checks.
- `Services/IPlanningRepository.cs` with `EfPlanningRepository` (EF Core/SQL) and `MockPlanningRepository`; `GraphTeamMembershipService` supplies memberships server-side; approval runs via `ApprovalFlowService` (Power Automate) or `GraphApprovalService` (Microsoft Approvals via Graph beta, no premium license).
- Authorization is enforced in controllers (e.g., team-admin endpoints verify team ownership) — `RppWebApi.Tests/` covers these paths.

## Key Conventions

- **TypeScript strict mode; `any` is an ESLint error.** Prefer interfaces, `readonly`, utility types. Functional components + hooks only; no class components.
- **Localization is mandatory — never hardcode UI strings.** All text goes through `createTranslator` / `src/localization/`. ~40 locale files exist, generated/maintained via `scripts/generate-locales.mjs` and the `apply-phase*-translations.mjs` scripts; English is the fallback. UI language comes from the Microsoft 365/Teams context (`localizationService.ts`) — there is no language switcher.
- **Styling:** Fluent UI components plus token-backed CSS variables from `src/styles/designTokens.css`. No hardcoded colors. CSS modules for component-specific styles; global CSS only for shell layout and shared tokens. Everything must work in light and dark Teams themes.
- **No organizational hardcoding** for Organisation-A/Organisation-B, titles, or Entra roles — organisations, teams, approvers, and policies are configuration (approval policies + routing rules), per BR-200.x.
- **Approval stays a Microsoft 365 integration boundary**, not a custom workflow engine: no custom approval inbox, reminders, delegation, or escalation — those belong to Power Automate / Microsoft Approvals.
- **Calculated values are never persisted** (booked/remaining vacation days, capacity) — they are computed by the app/engine.
- Commits use conventional prefixes (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `style:`). The pre-commit hook runs `npm run validate:repo-hygiene`.
- Definition of Done (AGENTS.md): polished, responsive, localized, typed, documented, no duplicated logic, works inside Microsoft Teams.
