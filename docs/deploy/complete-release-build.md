# Complete Release Build Checklist

What to do for a new RPP release, **in order**.  
Details and rationale: [deployment.md](./deployment.md).

**Merksatz**

> Erst **Version + Code/Schema + alle Texte/Docs**,  
> dann **einmal `package:api`**,  
> dann **Deploy**,  
> dann **Help re-index + Smoke**.

`npm run build` allein ist **nicht** deploybar (Runtime-Config bleibt mock).  
Deployables API+SPA-Artefakt: `npm run package:api -- --env <env>` → `publish/RppWebApi.zip`.

`--env` is mandatory. Templates live under `public/config/runtime-config-<ENV>.js`:

| `--env` | Template | Typical use |
| --- | --- | --- |
| `prod` | `runtime-config-PROD.js` | Azure / generic production |
| `hosteurope` | `runtime-config-HOSTEUROPE.js` | Host Europe / Voltar — see [kestrel-hosteurope.md](./kestrel-hosteurope.md) |
| `mock` | `runtime-config-MOCK.js` | Whole-host demo (no real backend data) |

`package:api` produces **only** `publish/RppWebApi.zip` (API + SPA).  
It does **not** build the Teams sideload/catalog ZIP under `teams-app-package/` — that is a separate step (D2).

---

## A — Pflicht vor dem Inhalt

### A1. Version setzen

The release label is authored in **`release.json`** (single source of truth).  
Operators must keep the Teams manifest **in sync** (hand-edited, packaging gate fails on mismatch):

| File | Field | Rule |
| --- | --- | --- |
| `release.json` | `"version"` | Single source of truth (e.g. `4.0.8`) |
| `teams-app-package/manifest.json` | `"version"` | Same value; keep `"id"` **unchanged** |

Do **not** bump as part of a normal version raise:

- `package.json` `"version"` (stays `0.1.0` on purpose)
- Demo Teams package version / app id
- Info-tab badge (that is step B2 — only when the phase *name* changes)

| Done | Step |
| --- | --- |
| [ ] | `release.json` updated |
| [ ] | Teams manifest `version` matches; `id` unchanged |

---

### A2. Code / schema fertig (if this release needs it)

Skip if only docs, copy, or frontend-only behaviour with no API/model change.  
You still run `package:api` later — it always publishes API + SPA together.

#### API code (no schema change)

| Done | Step |
| --- | --- |
| [ ] | API changes complete and committed |
| [ ] | `dotnet test RppWebApi.Tests` |
| [ ] | Local smoke if needed (`cd RppWebApi && dotnet run`) |

#### Database — SQL Server (`Planning:Provider=sql`)

| Done | Step |
| --- | --- |
| [ ] | `cd RppWebApi` → `dotnet ef migrations add <MeaningfulName>` |
| [ ] | Migration files committed under `RppWebApi/Migrations/` |
| [ ] | Tested locally (`dotnet ef database update` or `dotnet run`) |
| [ ] | Target env has DDL rights (`db_ddladmin` or equivalent) |

After deploy, startup runs `Database.Migrate()` when a connection string is set.  
No separate `dotnet ef database update` on the server for normal production deploys.

#### Database — PostgreSQL (`Planning:Provider=postgres`)

| Done | Step |
| --- | --- |
| [ ] | Empty DB: tables created at startup (`CreateTables`) |
| [ ] | Existing DB: **no** EF `Migrate()` upgrade path yet (ADR-007) |
| [ ] | Upgrade planned explicitly (recreate non-prod, or manual process) |

---

## B — Inhalt und Texte (alles vor dem Package)

Order inside B is flexible; finish B before C.  
If the UI changed, **B1 is not optional**.

### B1. UI strings DE + EN

| Done | Step |
| --- | --- |
| [ ] | No hardcoded UI strings — localization keys only |
| [ ] | `src/localization/de.ts` and `en.ts` updated together |
| [ ] | Smoke DE/EN if labels or behaviour changed |

---

### B2. Optional — Info-Tab / friendly release name

Communication label only — **not** the technical version.

| Done | Step |
| --- | --- |
| [ ] | Needed only if the program phase name changes |
| [ ] | Update `infoPageBadge` in at least `de.ts` and `en.ts` (e.g. `Friends & Family`) |
| [ ] | Leave unchanged when only `4.0.x` increases (as with 4.0.7) |

Technical version on the Info tab (**Frontend Release**) comes from packaging — do not hand-edit it.

---

### B3. Optional — Übersetzungen (prioritized locales + rest)

Do this **after** DE/EN are final.

AGENTS requires **DE and EN**. Other languages are optional and maintained via the locale scripts.  
**Prioritized locales** (first targets in `scripts/generate-locales.mjs`, not a separate product tier):  
`es`, `fr`, `it`, `zh`, `ko`, `fa` → `src/localization/{es,fr,it,zh,ko,fa}.ts`

| Done | Step |
| --- | --- |
| [ ] | `npm run locales:fill` — all locales have every key (gaps = English) |
| [ ] | Translate the prioritized locales (path A or B below) |
| [ ] | Spot-check nav, errors, approvals |
| [ ] | Other ~30 locales: EN fallback OK unless you deliberately regenerate them |

**Path A — machine translation (rewrites whole file)**

```bash
# PowerShell
$env:LOCALE_USE_GOOGLE_API = "1"
node scripts/generate-locales.mjs
```

- Source: `en.ts`
- Checkpoint: `scripts/.locale-translation-checkpoint.json` (skips completed locales)
- Re-translate one language: remove it from the checkpoint first
- Overwrites hand-tuned strings in that file

**Path B — only new keys (preferred for small releases)**

1. `npm run locales:fill`
2. Find keys still equal to English in `es`…`fa`
3. Translate only those lines
4. Keep product names stable: RPP, Teams, Outlook, Team Admin Center, …

---

### B4. Optional — Release Notes & Changelog

| Done | Step |
| --- | --- |
| [ ] | `CHANGELOG.md` — developer-facing entry |
| [ ] | `docs/release-notes/*` — user-facing notes (DE + EN), if you publish any |
| [ ] | Frontmatter `kb_version` / `updated` aligned with this release |

These files are **not** shown as the Info-tab badge.  
User release notes feed the Help Assistant KB (see B5 / D3).

---

### B5. Optional — Help Assistant (docs only here)

Curated MD only — **not** baked into the ZIP as a live index.  
**Foundry re-index is step D3 (after deploy).**

**Ingest folders only:**

```text
docs/user/
docs/faq/
docs/glossary/
docs/release-notes/
```

| Done | Step |
| --- | --- |
| [ ] | Update DE + EN user docs if UI or rules changed |
| [ ] | Frontmatter: `kb_version`, `updated` |
| [ ] | Commit docs with the release |
| [ ] | Optional: `mockHelpRepository.ts` + mock locale answers for demo mode |

Do **not** re-index Foundry yet if more content or packaging may still change.

See [help-assistant-knowledge-base.md](../architecture/help-assistant-knowledge-base.md).

---

## C — Ein Build-Artefakt

Prefer a clean git commit so `sourceRevision` matches what you ship.

```bash
npm run lint                              # recommended
npm run package:api -- --env prod         # Azure / generic production
# npm run package:api -- --env hosteurope # Host Europe — see kestrel-hosteurope.md
# npm run package:api -- --env mock       # whole-host demo
```

Optional stricter gates (not part of `package:api`): `npm run build:deployment` (adds resilience tests and SCA).  
Static release-alignment regressions (no `dist/` required): `npm run validate:release-alignment`.  
API authorization regressions (EO-459 team-scoped reads): `dotnet test RppWebApi.Tests --filter "FullyQualifiedName~PlanningControllerAuthorizationTests"`.

What `package:api` does (stops on first failure):

1. Frontend build (`locales:fill` + `tsc` + Vite + release metadata)
2. Stamp `runtime-config` from `runtime-config-<ENV>.js` (+ `releaseVersion`, `sourceRevision`)
3. Validate deployment, security, release consistency
4. Mirror `dist/` → `RppWebApi/wwwroot/` (exact compare)
5. `dotnet publish -c Release` (version from `release.json`)
6. ZIP → **`publish/RppWebApi.zip`** only

| Done | Step |
| --- | --- |
| [ ] | Lint clean (if you ran it) |
| [ ] | `package:api` finished without errors |
| [ ] | `publish/RppWebApi.zip` present |
| [ ] | No separate hand-rolled `dotnet publish` / FE zip |
| [ ] | Remember: Teams catalog ZIP is **not** in this output (D2) |

There is **no** “frontend release build” then a second “API release build”.  
Schema work was preparation in **A2**; publish is only here.

---

## D — Nach dem Package

### D1. Deploy API + SPA

| Done | Step |
| --- | --- |
| [ ] | Deploy `publish/RppWebApi.zip` to the target host |
| [ ] | Secrets only in environment settings — never in the ZIP |
| [ ] | Production-safe env (`ASPNETCORE_ENVIRONMENT=Production`, auth on, …) |
| [ ] | Connection string set so SQL `Migrate()` can run at startup |

Host-specific: [kestrel-hosteurope.md](./kestrel-hosteurope.md), [deployment.md](./deployment.md).

---

### D2. Optional — Teams app package upload

`package:api` does **not** create this ZIP. Build/maintain it under `teams-app-package/`  
(e.g. `rpp-teams-app-v<version>.zip`) per the Teams Package rules in [deployment.md](./deployment.md).

| Done | Step |
| --- | --- |
| [ ] | Manifest `version` = `release.json`; `id` unchanged |
| [ ] | ZIP: entries at archive root, forward slashes (not `Compress-Archive`) |
| [ ] | Upload Admin Center / Developer Portal |
| [ ] | Keep `teams-app-package/manifest.json` identical to the uploaded package (extract from ZIP after upload if needed — the release gate reads this file) |
| [ ] | If Outlook deep links: `OutlookSync__TeamsAppId` = installed app id |

---

### D3. Optional — Help Assistant re-index (Foundry)

Only after B5 docs are final **and** you are not about to change them again for this release.

| Done | Step |
| --- | --- |
| [ ] | Upload / replace files in the agent Vector Store / File Search |
| [ ] | Ingest only the four folders listed in B5 |
| [ ] | Smoke entry questions + clean “I don’t know” out of scope |

v1: manual. Automation is out of scope here (EO-451).

---

### D4. Smoke

| Done | Step |
| --- | --- |
| [ ] | `GET /health` — version, revision, planning store, DB when relational |
| [ ] | App in Microsoft Teams (SSO, planning load) |
| [ ] | Info tab: phase badge OK; **Frontend Release** = new version |
| [ ] | One critical path for this release (planning / approval / …) |
| [ ] | Help assistant (if enabled) after re-index |

---

## Quick paths

### Frontend / copy only (no schema, skip translations & help)

```text
A1 Version
B1 DE/EN if needed
B2 Badge only if phase name changes
C  package:api -- --env prod   (or hosteurope)
D1 Deploy
D2 Teams upload if needed
D4 Smoke
```

### Full release

```text
A1 Version
A2 API + migration/tests (SQL or Postgres plan)
B1 DE/EN
B2 Info badge (if phase name changes)
B3 Translations es/fr/it/zh/ko/fa (prioritized locales)
B4 Release notes + CHANGELOG
B5 Help MD files
C  package:api -- --env prod   (or hosteurope)
D1 Deploy
D2 Teams upload (separate ZIP; not from package:api)
D3 Foundry re-index
D4 Smoke
```

### Demo / mock host artefact

```text
A1 Version (if you version the demo ship)
B… content as needed
C  npm run package:api -- --env mock
D  deploy mock host; no Foundry required for mock help lookup
```

### Host Europe

```text
… same A/B as needed …
C  npm run package:api -- --env hosteurope
D1 follow kestrel-hosteurope.md (deploy script / Kestrel)
D2–D4 as needed
```

---

## What not to do

| Don’t | Why |
| --- | --- |
| Ship from `npm run build` alone | Still mock runtime config |
| Hand-assemble publish steps | Caused mixed/stale artefacts in the field |
| Expect `package:api` to emit the Teams catalog ZIP | Teams package is separate (D2) |
| Change Teams `manifest.id` for a normal release | Second catalog app, not an in-place update |
| Re-index Foundry before docs/package are final | KB drifts from what you ship |
| Expect `package:api` to refresh Foundry | Re-index is D3 |
| Expect Postgres to auto-migrate like SQL | Different startup path today |
| Bump `infoPageBadge` only because the version number changed | Phase label ≠ version |
| Treat DE/EN as “optional translations” | Required source strings when UI changes |
| Put secrets in the ZIP or git | Environment configuration only |

---

## Related docs

| Doc | Topic |
| --- | --- |
| [deployment.md](./deployment.md) | Packaging, version surfaces, Azure, Teams rules |
| [kestrel-hosteurope.md](./kestrel-hosteurope.md) | Host Europe / Kestrel (`--env hosteurope`) |
| [help-assistant-knowledge-base.md](../architecture/help-assistant-knowledge-base.md) | Curated MD ingest |
| [local-teams-loop.md](./local-teams-loop.md) | Local Teams (not a release path) |
| [customer-onboarding-playbook.md](../distribution/customer-onboarding-playbook.md) | Customer rollout steps |
| Root `release.json` | Hand-written release version |
| `scripts/package-api.mjs` | Deployable API+SPA artefact pipeline |
| `scripts/generate-locales.mjs` | Machine translation for non-EN locales |

---

*Checklist only — gates and behaviour are defined by EO-427 packaging and the deployment docs above.*
