# ROADMAP

Engineering Orders are the unit of planning; this file only records the order between them.
Scope and non-goals live in `ENGINEERING-ORDERS/`, delivered work in `CHANGELOG.md`.
Per `AGENTS.md` exactly one Engineering Order is active at a time.

Numbers below 600 are feature Engineering Orders. **The 600 range is reserved for low-level
refinements** — correctness and hygiene work inside a feature that already ships, with no new
capability for the user. They are collected under *Refinement backlog* and scheduled after the
feature they touch is accepted, never in front of it.

## Now

**EO-459 (team-scoped planning reads + write target membership) is implemented and awaiting review.**
EO-458 remains in the review queue. EO-455 and EO-456 were accepted on 2026-08-08 (rpp-dev).

| Order | Outcome |
| --- | --- |
| EO-424 | Accepted, ships **marked beta** — the Microsoft 365 path is verified, the range of sender formats a mailbox receives is not, and the maintenance surface is deliberately under review |
| EO-427 | Accepted — `release.json` is the only hand-written version, `npm run package:api -- --env prod` the only path to a deployable artefact |
| EO-428 | Accepted, verified in the tenant for owner **and** guest |
| EO-429 | Implemented — link preview metadata; WhatsApp verification against `rpp.example.com` remains open |
| EO-450 | Completed — Help Assistant v1 on a curated knowledge base |
| EO-451 | Closed for this sprint without implementation: stage 4 dropped on PoC evidence, stages 1–3 demand-driven. Nothing scheduled |
| EO-452 | Accepted — lazy locale delivery, Brotli/gzip SPA compression, bounded parallel Graph approval reconciliation |
| EO-453 | Implemented, awaiting review — honest runtime-configuration failures and bounded throttling recovery |
| EO-455 | Accepted 2026-08-08 — Host Adapter (ADR-004): teams/browser/sharepoint, one build |
| EO-456 | Accepted 2026-08-08 — default RPP team `Alle - {M365 name}` on first host use (ADR-005); primary unique-index fix verified via HAR |
| EO-458 | Implemented, awaiting review — `Planning:Provider=postgres` (EF Core + Npgsql), ADR-007 |
| EO-459 | Implemented, awaiting review — team-scoped `GET absences|vacationbalances|events` + write target membership |

EO-428's tenant verification was the expensive part of the day and produced three defects that no
amount of reading the repository would have found — each of them the same shape: an incomplete or
failed answer presented as a fact. Graph member lists were read one page deep, so anyone who joined
a large team later did not exist for the membership gate; a Graph outage was returned as HTTP 200
with an empty list; and the typed errors meant to stop exactly this were swallowed by the `catch`
one line below where they were raised. All three are fixed.

## Next, in order

1. **RC6 quality checks** — branch `RC6-Qualitychecks`. Collected during the RC6 sprint and
   deliberately not done under time pressure:
   - **Deployment topology.** EO-427 guarantees what is in the *package*, not **which deployment
     serves which tab**. `rpp.example.com` is maintained by hand and covered by no gate. Teams tabs
     created before the current app package point at it, which cost several hours on 2026-07-31
     before anyone suspected a second installation.
   - **Membership reads at Organisation-A scale.** The paging fix reads every member of a ~3000-account group
     on a cache miss. Correct, but the first request after expiry now costs several Graph calls —
     narrow the query to the people actually needed instead of the whole group.
   - **Guest behaviour beyond the happy path** — verified for one guest in one team; the personal
     app scope with several teams and no primary team still has no tenant evidence.
   - **The remaining swallows.** `IsUserOwnerOfTeamAsync` still denies silently when Graph cannot
     answer, and `apiApprovalRepositories` / `apiHelpRepository` still collapse 401 and 403.
   - **Safe Browsing.** Chrome flags `rpp-dev-…azurewebsites.net` as "Dangerous"; users get an
     interstitial on direct access.
   - **Stale browser state after a deployment.** The last hours of 2026-07-31 were spent on a guest
     whose Chrome served an old bundle and configuration; the same account worked immediately in
     incognito Edge. The server does the right thing — hashed assets immutable, everything else
     `no-cache` (`Program.cs`) — and the app registers no service worker, so nothing here needs
     fixing in code. What is missing is the support path: "does the Info tab show the deployed
     revision?" should be the first question on any "it does not work for me", and there is no
     documented way to tell a user how to clear it.
2. **EO-430 — SharePoint Online as a server-side planning store.** **Parked 2026-07-31 after the
   read path.** An installation must be able to run without SQL Server, keeping planning facts in
   the customer's own tenant. The reason is not cost: the lists are **worked in** — administrators
   and HR maintain data directly in SharePoint — which makes them co-owned by the application and by
   people, and that has no equivalent in the SQL profile.

   **Delivered:** ADR-002 supersedes ADR-001's "SQL is the source of truth"; `Planning:Provider`
   selects the store at startup with no code default and no silent fallback; the schema is on one
   column per fact with person-valued facts collapsed into a single `User` column; and the
   server-side provider serves **every read** from a real site, verified against the development
   tenant with app-only certificate credentials and `Sites.Selected`.

   **Parked, not abandoned.** Stages 2–4 — writes with ETag concurrency, multi-write compensation,
   throttling, the startup schema gate and the test set — are specified in `ENGINEERING-ORDERS/`
   and unbuilt. The decision is to build them only if the SharePoint profile is actually taken into
   use: the read path is what proves the profile viable, and it now does. Nothing is half-finished
   in the deployed sense — `Planning:Provider = sharepoint` refuses startup unless
   `SharePoint:AllowIncompleteProvider` is set, so no installation can come up on it by accident.

   **What the live runs changed.** Four defects surfaced that neither compiling nor parsing could
   have found, all now fixed: `Get-PnPField` matching on display names silently skipped column
   creation (and `-RemoveRetiredFields` would have deleted a live column); the Events template owns
   `Duration` and `EndDate`, which retired a stored day count that turned out to be a calculated
   value; two projections named a timestamp column that does not exist on the configuration lists;
   and **FR-430.12 named the wrong identity field** — `UserId.NameId` is a Microsoft Account PUID,
   not the Entra object id, and `AadObjectId.NameId` is the correct source for members and guests
   alike. The last one is the reason a schema gate (FR-430.8) is worth having.

   **Known gap if the profile is adopted:** `Type` stays a free-text column, so an absence entered
   by hand can carry a value the application does not recognise and is filed as `otherAbsence`
   rather than refused.
3. **EO-451 stage 2 — automated knowledge pipeline.** The assistant's answer quality currently
   rests on a knowledge base that happens to match the shipped build; that alignment decays
   silently with every release, and manual re-index is the only thing preventing a confidently
   wrong answer. This protects what already works rather than adding to it.

## Feature backlog

- **EO-457 — SharePoint Web Part v1 (iframe).** Direction locked in **ADR-006** (2026-08-08): a thin
  SPFx (or equivalent) part embeds the **existing** deployed RPP URL; one SPA artefact, no in-page
  React mount. Needs App Catalog package, frame-ancestors, optional `teamId` property / picker
  (EO-428). Not scheduled. In-page token bridge (Route B) only if iframe auth/UX blocks adoption.
  Not EO-430 (lists as store).

## Refinement backlog (600 range)

- **EO-600 — calendar date / time zone correctness in the inbound sync (remainder).** Originally
  three silent defects from the EO-424 format-gap close-out. **Partially delivered:**
  - **EO-600.1 / Defect 2 (half-day arithmetic) — Done** (`c474b0f`, 2026-08-05): `DetectHalfDay`
    distinguishes start vs end; 09:00–17:00 books as one day.
  - **Defect 3 (identity) — Done in the field** (CHANGELOG 4.0.7): Graph resolve mail/UPN → Entra
    object id → assignments (supersedes the original “UPN on DTO” sketch in FR-600.5).
  - **Defect 1 (open):** timed iCalendar values still use `AssumeUniversal` without
    `AdjustToUniversal`, so calendar dates near midnight depend on the host zone; no
    `MailboxSync:TimeZone` projection yet (FR-600.1–600.3). All-day / date-only values stay correct
    and must not be “unified” into a converting path.

  **Unblocked** for the remaining TZ slice. Eligible to be pulled into *Now* when prioritised.
  Weigh against the beta decision below: refinement on a feature whose maintenance surface is
  itself under review. Details: `ENGINEERING-ORDERS/EO-600.md`, `EO-600.1.md`.

- **EO-601 — load only the session's locale.** *Superseded by EO-452.* Every tab load fetched all 41 locale
  bundles to display one of them: 488 KiB gzip of the 725 KiB initial payload, measured against
  `ba42131`. The per-locale chunking in `vite.config.ts` looks like it solves this and does not —
  `translations.ts` imports every locale statically, so all 41 stay hard dependencies of the entry
  graph and `index.html` preloads them. Because `app.initialize()` runs after the React mount, that
  payload sits in front of the Teams spinner on every open.

  EO-452 absorbed and implemented this scope together with response compression and the approval
  latency correction. The detailed EO-601 document remains as the analysis record.

## Open product decision

- **Does the inbound Outlook sync earn its maintenance?** EO-424 ships beta. It owns raw MIME
  parsing, iCalendar parsing, time zones, identity resolution, deduplication, Graph app-only auth
  and an Exchange access policy — so that someone does not retype an absence they already entered in
  Outlook. All four defects found during acceptance came from the sender-format tail, and that tail
  is unbounded. Revisit after real usage: narrow the supported path, or retire it. Widening it is
  the option that should need justification.

## Demand-driven, not scheduled

- **Holiday calendar sources as configuration.** Lifted out of a checked-off `TODO.md` line under
  EO-416, where the open part was invisible: EO-416 moved the calendars from mock into the database,
  it did not touch how they are obtained. Today a third location is not a configuration entry but a
  code change — `TimelineHolidayTone` in `src/components/timeline/Timeline.tsx` is a union of exactly
  `schoolHolidaySg` and `schoolHolidayDubendorf`, the tone is assigned by a binary
  `holiday.location === "SG" ? … : …` so any third location silently renders as Dübendorf, and there
  are matching CSS classes, legend entries and locale keys. The two sources are fetched in the
  **browser** by `src/features/team-admin/services/schoolHolidayCalendarApi.ts`, one an OpenData REST
  query against `daten.stadt.sg.ch`, the other SQL-over-HTTP against `data.stadt-zuerich.ch` — which
  also sits against the layering rule that UI code does not call foreign APIs, and against the
  trusted-outbound guards in `src/core/security`. `src/features/reports/personProfile.ts` infers the
  location by searching the address for `"dübendorf"` and `"8600"`.

  Two reasons this is worth doing beyond elegance: it is organizational hardcoding of Organisation-A/Organisation-B
  sites, which BR-200.x forbids outright, and every further canton arrives with its own data format,
  so the cost grows linearly without an adapter contract. A future order would define a
  `HolidayCalendarSource` contract with interchangeable adapters (OpenData, iCalendar feed, manual
  upload), move the import server-side, and make locations data rather than a union type. Written up
  as an EO only when it is actually scheduled — `EO-430` is free.

  **Preferred implementation for iCalendar feeds:** use a backend proxy in the Web API rather than
  fetching `.ics` files directly from the Teams tab. Browser fetches still need CORS from the third
  party host, while a server-side proxy can validate, normalize and cache the feed before the UI sees
  it. That keeps the tab free of cross-origin coupling and fits the existing API boundary better.

  Still open from the same TODO line: run both refresh actions once for 2026 after deployment.

- **EO-451 stages 1 and 3** — role-based knowledge areas, and read-only tools that answer
  caller-specific questions ("how many vacation days do I have left?"). Both are demand
  questions, not quality questions. Evaluate the Hilfreich / Nicht hilfreich feedback from
  EO-450 first, so the next stage answers what users actually ask.

## Dropped

- **EO-451 stage 4 — Semantic Kernel.** Dropped 2026-07-30. FR-451.5 requires a demonstrated
  trigger before building it; the PoC showed none. Reopening requires a documented trigger.
