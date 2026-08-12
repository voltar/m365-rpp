# M365 Ressourcen & Präsenzplanung (RPP)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Public source** for operational resource, presence and capacity planning as a native Microsoft
Teams tab app. Maintained by [Voltar](https://github.com/voltar).

RPP answers one question well: **who is available, when, and with which skills.** It brings the
timeline, team capacity, absences, approvals, reporting and team administration into a single
surface inside Teams, across organisations and across teams that share people.

It is deliberately **not** a holiday calendar, not a SharePoint list, not a Planner clone and not a
Microsoft Project replacement. Teams owns the people, Microsoft Graph supplies identities and
memberships, and RPP owns the planning logic — nothing more, and nothing less.

> Tenant IDs, client secrets, connection strings and real host names are **not** in this repository.
> Use placeholders in config, then inject real values via User Secrets, environment variables or your
> platform secret store. See [SECURITY.md](SECURITY.md) and
> [docs/projectmanagement/secret-management.md](docs/projectmanagement/secret-management.md).

---

## Live-Demo

Eine öffentliche Browser-Demo läuft unter:

**https://rpp.swisskmu.org**

Im normalen Browser startet die Demo mit **Mock-Daten** (kein Login nötig). Dieselbe Installation
kann in Microsoft Teams mit API/Graph laufen; ausserhalb von Teams bleibt der Standalone-Browser
bewusst im Demo-Modus.

**Sprache:** Es gibt **keinen** URL-Parameter (z. B. `?lang=de`). Die UI-Sprache folgt dem
Microsoft-365-/Teams-Kontext, sonst der Browsersprache (`navigator.languages`), mit
HTML-Fallback `lang="de"` und Englisch als letzter Fallback. Es gibt keinen Sprachumschalter in der App.
Wer Deutsch sehen will: Browser/OS auf Deutsch stellen (oder Teams mit deutscher UI öffnen).

---

## Quick start (mock demo)

Node version is pinned in [.nvmrc](.nvmrc) (currently 22). Machine setup for macOS, Linux and
Windows: [scripts/dev-setup/README.md](scripts/dev-setup/README.md).

```bash
npm install && npm run dev          # frontend on localhost:5173 (mock data by default)
```

For the API path (SQL/Postgres + Entra), configure secrets locally, then:

```bash
cd RppWebApi && dotnet run          # API on :5004, Swagger at /swagger
```

| Command | Purpose |
|---|---|
| `npm run build` | `tsc --noEmit` + Vite build + release metadata |
| `npm run lint` | ESLint over `src/**/*.{ts,tsx}` |
| `npm run build:deployment` | build + deployment and security validation |
| `npm run package:api -- --env prod` | the deployable API artefact: build, stamp, validate, mirror, publish, ZIP |
| `npm run validate:repo-hygiene` | what the pre-commit hook runs |
| `npm run install:git-hooks` | wire up `.githooks/pre-commit` after cloning |
| `dotnet test RppWebApi.Tests` | API tests (xUnit) |

**Local Teams without Azure each time:** [docs/deploy/local-teams-loop.md](docs/deploy/local-teams-loop.md) (Dev Tunnel + sideload “RPP Local”).

There is no frontend test runner. Type checking and ESLint are the frontend gates.

The release label is written by hand in exactly one place, [release.json](release.json); the
assembly version, the stamped runtime configuration and the release metadata all derive from it, and
a gate fails packaging when the Teams manifest disagrees (keep `teams-app-package/manifest.json`
`version` in sync; leave `id` unchanged). `npm run build` alone produces a frontend bundle that is
still on the mock configuration — only `npm run package:api` yields something deployable
(`publish/RppWebApi.zip`; it does not build the Teams catalog ZIP). Release order checklist:
[docs/deploy/complete-release-build.md](docs/deploy/complete-release-build.md). Details:
[docs/deploy/deployment.md](docs/deploy/deployment.md).

Team-scoped requests resolve their team from an explicit parameter or the Teams host context, and
from nothing else. When neither applies — the personal app scope, a plain browser — the API says so
(`noTeamContext`) and the user picks a team, defaulting to their primary one. There is no fallback
team: substituting one is what once showed a permission error to a user who had every right to the
data. See [docs/architecture/architecture.md](docs/architecture/architecture.md).

## Architecture at a glance

| Layer | Technology | Owns |
|---|---|---|
| Presentation | React 18, TypeScript, Vite, Fluent UI v9 | timeline, dashboards, forms, side panels |
| API | ASP.NET Core 8, EF Core | business logic, persistence, authorization |
| Data | SQL Server | planning data, configuration, history |
| Identity | Entra ID, Microsoft Graph | users, memberships, calendars |

UI never talks to Graph, SharePoint or tokens directly — everything goes through repositories
that return typed results. Which provider answers (`mock`, `sharepoint`, `api`) is a **runtime**
decision read from `public/config/runtime-config.js`, so one build artefact serves every
deployment, including the mock-mode demo that needs no backend at all.

The **help assistant** follows the same rule. It opens as a right side panel over whatever page
you are on — never as a tab, because "why is this red?" is only answerable while the red thing is
still on screen. It answers only from the curated documentation in `docs/user`, `docs/faq`,
`docs/glossary` and `docs/release-notes` — never from source code — and cites the document it
used. The browser holds no key; the backend reaches Microsoft Foundry with its managed identity.
In mock mode it answers from a small local lookup instead, so the demo needs no Azure subscription.

## Where things are written down

**Read before changing anything:**

| | |
|---|---|
| [docs/projectmanagement/ADMIN Scale.md](docs/projectmanagement/ADMIN%20Scale.md) | Product constitution — aim, purpose, design principles. |
| [AGENTS.md](AGENTS.md) | Engineering rules and definition of done. |
| [docs/architecture/architecture.md](docs/architecture/architecture.md) | Authoritative architecture reference. |
| [ARCHITECTURE-POLICY/](ARCHITECTURE-POLICY/) | Architecture decision records (persistence profiles, host model, …). |
| [LICENSE](LICENSE) / [SECURITY.md](SECURITY.md) | MIT license and vulnerability reporting. |

**Reference material, by audience:**

| Folder | For whom |
|---|---|
| [docs/user/](docs/user/), [docs/faq/](docs/faq/), [docs/glossary/](docs/glossary/), [docs/release-notes/](docs/release-notes/) | End users. Written in user language, DE and EN. Also the curated knowledge base behind the in-app help assistant — see [docs/architecture/help-assistant-knowledge-base.md](docs/architecture/help-assistant-knowledge-base.md) before editing. |
| [docs/architecture/](docs/architecture/) | Design concepts behind individual EOs, ahead of implementation. |
| [docs/deploy/](docs/deploy/), [docs/deploy/complete-release-build.md](docs/deploy/complete-release-build.md), [docs/distribution/](docs/distribution/) | Whoever runs or ships it. Deployment, release order checklist, Kestrel setup, managed package build, approval flow, Docker, customer onboarding. |
| [docs/architecture/repository-contracts.md](docs/architecture/repository-contracts.md), [docs/architecture/microsoft-365-authentication.md](docs/architecture/microsoft-365-authentication.md), [docs/architecture/monitoring.md](docs/architecture/monitoring.md) | Whoever extends or operates it. |
| [docs/projectmanagement/data-model.md](docs/projectmanagement/data-model.md), [docs/projectmanagement/secret-management.md](docs/projectmanagement/secret-management.md), [docs/projectmanagement/security.md](docs/projectmanagement/security.md) | Whoever extends or secures it. |
| [docs/projectmanagement/factsheet.md](docs/projectmanagement/factsheet.md), [docs/projectmanagement/product-vision.md](docs/projectmanagement/product-vision.md), [docs/distribution/customer-onboarding-playbook.md](docs/distribution/customer-onboarding-playbook.md) | Whoever has to explain it to someone else. |
| [docs/Qual/](docs/Qual/) | Quality reviews, performance analysis, resilience, Teams Store certification. |

Project history lives in [CHANGELOG.md](CHANGELOG.md) and what comes next in
[ROADMAP.md](ROADMAP.md). Both are updated every sprint — that is a rule, not a habit.

## Repository layout

```
src/components/      shell, timeline, capacity, details panel, approval UI
src/features/        feature boundaries with their own service APIs
src/models/          typed domain model (people have many teams, always)
src/services/        capacity engine, planning snapshot, bootstrap state
src/repositories/    repository contracts and mock/SharePoint/API implementations
src/infrastructure/  the only place Microsoft 365 auth and clients live
src/core/            logging, error model, correlation IDs, security helpers
src/localization/    ~40 on-demand locales; English is the static fallback, DE and EN are maintained
RppWebApi/           ASP.NET Core API, EF Core, Graph integration
RppWebApi.Tests/     API tests
scripts/             dev setup, validation, release metadata, locale tooling
```

Two rules that save the most time later: **never hardcode a UI string** — everything goes through
`src/localization/`, and the UI language follows the Teams context, so there is no language
switcher to test against. And **never recalculate capacity locally** — `capacityEngine.ts` is the
single source of truth, so a second opinion is always a bug.

EO-452 keeps only English in the initial localization graph and loads the resolved Teams locale on
demand. The API host serves the SPA with Brotli/gzip response compression.

EO-453 makes runtime configuration fail closed: a missing or invalid deployment configuration renders
an explicit unavailable state instead of plausible mock data. Idempotent frontend and backend HTTP
reads retry bounded 429/502/503/504 responses with `Retry-After`, exponential backoff, and jitter.

## Local secrets

Backend secrets — SQL connection string, `AzureAd:ClientSecret` — belong in .NET User Secrets,
never in a committed `appsettings*.json`. Anything in `public/config/runtime-config.js` or a
`VITE_*` variable is visible in the browser; treat it as public. Keep real `.env` files untracked
and use [.env.example](.env.example) as the reference. `npm run validate:repo-hygiene` checks this
before every commit, and it is worth running before a push as well.

## License

This project is licensed under the [MIT License](LICENSE).

---

*For everyone who ships, keeps things running, and still takes their holidays.*
*Both halves matter. This tool exists so the second one does not cost the first.*
