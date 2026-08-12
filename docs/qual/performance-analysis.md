# M365 Ressourcen & Präsenzplanung (RPP)
## Performance Analysis — Startup, Bundle, Graph and Backend

Performance review of the Teams tab app (React/Vite frontend) and `RppWebApi` backend, focused on
tab load time, bundle composition, Microsoft Graph and API call patterns, and timeline rendering.

This is an **analysis document — no code was changed**. Every finding names the file and line it was
derived from, and states whether the number behind it was measured or estimated.

| | |
|---|---|
| Analysed revision | `ba42131` (branch `claude/m365-teams-perf-analysis-hwl80e`) |
| Release label | 4.0.6 (`release.json`) |
| Date | 2026-07-31 |
| Toolchain | Node v22.22.2, Vite 5.4.21 |

---

## 1. Method — measured vs. estimated

**Measured.** `npm ci` and `npm run build` were executed against the analysed revision (exit 0). The
resulting `dist/` was evaluated byte by byte (`stat`, `gzip -9`), the generated `dist/index.html` was
analysed for its `modulepreload` graph, and the built entry chunk was inspected for its static import
list. All byte counts and the build timing below come from that run.

**Not measured.** No runtime profiling inside the Microsoft Teams client — the analysis environment
has no Teams host and no tenant credentials. `dotnet` is not installed in the analysis environment,
so **the backend test suite was not run and no API latency was measured**. Network timings are
derived from measured payload sizes; rendering costs are computed analytically from loop bounds.
Both are marked *estimated* where they appear.

**Build timing (measured).** 40.7 s total for `npm run build`, of which `vite build` accounts for
22.7 s across 2500 transformed modules.

---

## 2. Executive summary

Three findings dominate, and the first two are disproportionately cheap to fix:

1. **All 41 locale bundles are eagerly loaded on every tab load** — 488 KiB gzip / 1 619 KiB raw of
   translation text for 40 languages the session will never display. This is ~65 % of the startup
   payload.
2. **No HTTP response compression is configured anywhere in the backend that serves the SPA** — the
   client most likely receives 2 474 KiB where 725 KiB would do.
3. **`GET /api/planning/vacationrequests` performs up to 20 strictly sequential Microsoft Graph
   round trips inside the request path**, on every call, uncached.

Alongside these, the codebase gets a number of things notably right, and those are recorded in
section 9 so that a later refactor does not undo them.

---

## 3. Startup path and time to `notifySuccess()`

### 3.1 The critical chain

```
index.html
  → /config/runtime-config.js          (classic script, 637 B, no-cache)
  → entry module + 46 modulepreloads   (2 474 KiB) fully downloaded, parsed, evaluated
  → React mounts <AppShell>
  → useEffect → initializeTeamsApp()   AppShell.tsx:114
  → app.initialize()
  → app.notifyAppLoaded() / app.notifySuccess()   teamsApp.ts:19-20
```

`initializeTeamsApp()` is called from inside a `useEffect` in
[`AppShell.tsx:114`](../../src/components/AppShell.tsx). The Teams loading indicator — enabled via
`showLoadingIndicator` in the manifest, as documented in the comment at
[`teamsApp.ts:17`](../../src/infrastructure/microsoft365/teamsApp.ts) — therefore stays up until the
*entire* module graph has been downloaded, parsed and evaluated, and React has completed a first
commit. That graph includes the full Fluent UI chunk and all 40 unused locale bundles.

`app.initialize()` is a pure `postMessage` handshake with the host. It has no dependency on React,
Fluent UI, or the localization layer. There is no technical reason for it to sit behind the bundle.

**Nothing else blocks it.** Explicitly checked and cleared: no auth call, no Graph call, and no web
fonts before initialization — `global.css` uses only `var(--fontFamilyBase)`, i.e. the Fluent system
font stack, and `font-src 'self' data:` in the CSP confirms no external font origin. The only
render-blocking stylesheet is the 17 KiB `index-*.css`. The bottleneck before `notifySuccess()` is
bundle size alone.

### 3.2 Script ordering

In the built `dist/index.html`, the entry module sits in `<head>` (line 67) while
`/config/runtime-config.js` sits in `<body>` (line 118). Because module scripts are deferred, the
classic runtime-config script still executes first, so ADR-003's runtime provider selection is not
at risk. It is, however, a parser-blocking classic script carrying `no-cache`, i.e. one guaranteed
round trip on every load. Minor, but it is on the critical path.

### 3.3 A third serial hop before first data

The default route is `/overview`, which renders `Timeline` — a lazy chunk
([`PlaceholderPage.tsx:29`](../../src/pages/PlaceholderPage.tsx)). The load therefore serialises as
entry → Timeline chunk → first data fetch. Preloading the Timeline chunk (instead of 40 locales)
would collapse that hop.

---

## 4. Bundle composition

### 4.1 Localization is split but not lazy

[`src/localization/translations.ts`](../../src/localization/translations.ts) imports all 40 locale
modules **statically**. The `manualChunks` rule in
[`vite.config.ts:14-19`](../../vite.config.ts) does split them into separate files, but splitting
does not change the dependency: the built `localization-translations-*.js` contains a hard
`import{a as s}from"./localization-am-*.js"; …` for every language, and `dist/index.html` emits
**46 `<link rel="modulepreload">` entries, 41 of them locale chunks**.

Code splitting without lazy loading moves bytes into more files; it does not stop them being loaded.

**Initial payload (measured):**

| | raw | gzip |
|---|---|---|
| **Initial total (47 JS + 1 CSS)** | **2 474 KiB** | **725 KiB** |
| of which: 41 locale chunks | 1 619 KiB | 488 KiB |
| remainder (React, Fluent, Teams, app) | 855 KiB | 237 KiB |

**≈ 65 % of the startup payload is 40 languages the user will never see.** Exactly one locale is
relevant per session (~41 KiB raw / ~12 KiB gzip). Per
[`localizationService.ts`](../../src/localization/localizationService.ts) the UI language is resolved
from the Microsoft 365 / Teams host context and there is no language switcher, so nothing functional
depends on the eager load.

### 4.2 Largest dependencies (measured)

| Chunk | raw | gzip |
|---|---|---|
| `fluentui` (`@fluentui/react-components`) | 294 KiB | 78 KiB |
| `teams` (`@microsoft/teams-js`) | 210 KiB | 56 KiB |
| `react` | 143 KiB | 46 KiB |
| `vendor` | 101 KiB | 31 KiB |
| `index` (application entry) | 92 KiB | 25 KiB |
| `data` (mock seed data) | 18 KiB | 4 KiB |

Fluent UI and Teams SDK sizes are in the expected range for the surface actually used; tree shaking
is working (only 19 icon import sites, and the icon set is not pulled in wholesale).

### 4.3 Circular manual chunk

The build log reports:

```
Circular chunk: vendor -> react -> vendor. Please adjust the manual chunk logic for these chunks.
```

The `manualChunks` predicate matches `react` via `normalizedId.includes("react")`, which also
catches `react-is` and transitive `@fluentui/react-*` packages. Rollup must then resolve both chunks
before either executes. Harmless today, but it makes the preload graph less predictable than it
looks.

### 4.4 Route splitting is done well

Per-route lazy chunks (measured, JS + CSS):

| Route | raw | gzip |
|---|---|---|
| Timeline | 70 KiB | 19 KiB |
| TeamAdminPage | 57 KiB | 14 KiB |
| AppAdminPage | 22 KiB | 6 KiB |
| TeamCapacityDashboard | 19 KiB | 5 KiB |
| ApprovalsPrototypePage | 17 KiB | 4 KiB |
| ReportsPage | 16 KiB | 5 KiB |
| HelpPanel | 14 KiB | 5 KiB |
| MySettingsPage | 12 KiB | 3 KiB |
| MyApprovalsPage | 6 KiB | 2 KiB |

All are `React.lazy` behind [`PlaceholderPage.tsx`](../../src/pages/PlaceholderPage.tsx), with intent
preloading on hover and focus (`preloadRoute`, and `preloadHelpPanel` in `AppShell.tsx:41`). This is
well executed and stands in sharp contrast to the localization layer.

---

## 5. Compression, caching and delivery

### 5.1 No response compression (highest impact-to-effort ratio in this document)

The SPA is served by the API process itself — `dist/` is mirrored into `wwwroot` and served from
[`Program.cs:174`](../../RppWebApi/Program.cs), i.e. Kestrel on Linux App Service. A full-text search
across the backend for `Compression|Brotli|Gzip` returns **no matches**, and there is no `web.config`.

Kestrel does not compress static files on its own, and with no IIS or reverse proxy in front of it,
nothing else does either. The client therefore most likely downloads **2 474 KiB instead of
725 KiB** — a factor of 3.4.

On a typical corporate uplink (~10 Mbit/s effective) that is roughly **~2.0 s instead of ~0.6 s** of
transfer time (*estimated*, derived from measured sizes). Combined with section 4.1, ~1.9 MB of
uncompressed, never-used translation text precedes every tab load.

`brotli` was not available in the analysis environment, so the Brotli figure could not be measured;
it typically lands 15–20 % below gzip.

### 5.2 Cache headers are correct

[`Program.cs:163-172`](../../RppWebApi/Program.cs) sets `public,max-age=31536000,immutable` for
hashed `/assets` and `no-cache` for everything else (`index.html`, `config/runtime-config.js`,
`release.json`). This is exactly right, and the EO-420 comment documents why — Teams webviews cache
heuristically without explicit headers, which previously stranded tabs on stale bundles.

### 5.3 No CDN, no service worker

Neither is present. For a Teams tab app both are defensible omissions; a CDN would be the natural
next step *after* compression, not before it. No static-hosting config (`staticwebapp.config.json`,
`_headers`, `web.config`) exists, consistent with the API-serves-SPA model.

---

## 6. Microsoft Graph and backend call patterns

### 6.1 `$select` / `$filter` / `$top` / paging — largely correct

Verified positively:

* [`graphTeamMembershipProvider.ts:136`](../../src/infrastructure/microsoft365/graphTeamMembershipProvider.ts)
  sets a narrow `$select`; `$top` is passed through and `@odata.nextLink` is followed in both paths
  (lines 99 and 128).
* [`sharePointPlanningRepositories.ts`](../../src/repositories/sharePointPlanningRepositories.ts)
  uses `$select`/`$filter`/`$top` consistently (lines 103, 141, 169, 198, 228, 253) and follows
  `nextLink`.
* Backend `GraphTeamMembershipService.FetchTeamMembersAsync` uses `Select` with `Top = 999` and
  fully drains both paged collections. The EO-428 comment there shows the truncation failure mode was
  already learned the hard way.
* Caching exists where it matters: 5-minute team member cache
  ([`GraphTeamMembershipService`](../../RppWebApi/Services/GraphTeamMembershipService.cs), keyed per
  team id, double-checked locking) and a 24-hour photo cache
  ([`UserPhotoService`](../../RppWebApi/Services/UserPhotoService.cs)).

### 6.2 N+1: sequential Graph calls in every vacation-request list

The most severe backend finding.
[`PlanningController.cs:155-167`](../../RppWebApi/Controllers/PlanningController.cs):

```csharp
if (_graphApprovalService.IsEnabled)
    await SyncPendingGraphApprovalsAsync(teamId);   // before every response
…
foreach (var request in pending.Items.Where(…).Take(20))
    var approvalStatus = await _graphApprovalService.GetApprovalStatusAsync(…);
```

Up to **20 strictly sequential Graph beta round trips**, executed synchronously in the request path
of every list call, with no cache. At 200–400 ms per call that is **4–8 s of added response time**
(*estimated*) before the client sees anything. Approved decisions additionally trigger Outlook sync
writes inside the same loop.

Two directions, in increasing order of correctness:

* `Task.WhenAll` with bounded concurrency — fast relief, still in the request path.
* Move the pull-based sync out of the request path entirely, into a hosted service alongside the
  existing `MailboxSyncBackgroundService`. This is the architecturally consistent option: EO scope
  keeps approval a Microsoft 365 integration boundary, and a background reconciler fits that better
  than a synchronous fan-out.

### 6.3 Smaller instances of the same pattern

* [`PlanningController.cs:91`](../../RppWebApi/Controllers/PlanningController.cs) — `DeleteAbsence`
  calls `GetAbsencesAsync()` with no filter, materialising **every absence row in the database**, to
  locate one by id via `FirstOrDefault`.
* [`EfPlanningRepository.cs:744-756`](../../RppWebApi/Data/EfPlanningRepository.cs) —
  `foreach (var patch in saveRequest.MemberAssignments)` with an `await …ToListAsync()` in the body:
  one SQL round trip per team member on every Team Admin save. A single
  `Where(row => userIds.Contains(row.UserId))` before the loop replaces N queries with one.
* `GraphTeamMembershipService.FetchTeamMembersAsync` awaits `members` and then `owners` even though
  the two are independent — `Task.WhenAll` halves that segment.

### 6.4 Over-fetching: server-side filters missing, browser filters afterwards

Only `/memberships` accepts a `pageToken`
([`PlanningController.cs:402-410`](../../RppWebApi/Controllers/PlanningController.cs)). The
`absences`, `vacationbalances`, `events`, `holidays` and `teamconfigurations` endpoints take **no
paging parameter and no team filter**, and `GetAbsencesAsync`
([`EfPlanningRepository.cs:29-41`](../../RppWebApi/Data/EfPlanningRepository.cs)) runs without
`AsNoTracking()` and without `Skip`/`Take` straight into `ToListAsync()` over the full table.

The client does send `pageSize: 100`
([`planningDataService.ts:122`](../../src/services/planningDataService.ts)), but it is ignored and
`nextPageToken` comes back `undefined`. The scoping then happens **in the browser**
([`planningDataService.ts:79-81`](../../src/services/planningDataService.ts)):

```ts
const scopedAbsences = absences.filter((absence) => scopedUserIds.has(absence.employeeId));
```

Absences, vacation balances and planning events for **every team in the tenant** cross the wire so
that the browser can discard most of them. This scales with tenant size rather than team size — the
class of problem that stays invisible in a pilot and fails in a large organisation. The missing
`AsNoTracking()` additionally doubles server heap per request by populating the EF change tracker
for read-only data.

### 6.5 No 429 handling anywhere

A full-text search for `429|Retry-After|TooManyRequests|Polly|exponential` across both `src/` and
`RppWebApi/` returns **no matches**.

* [`graphClient.ts:76-88`](../../src/infrastructure/microsoft365/graphClient.ts) maps 429 to
  `code: "unknown"` with `recoverable: response.status >= 500` — i.e. **`recoverable: false`**. A
  throttling response is treated as a permanent error and surfaced to the user instead of being
  retried after `Retry-After`.
* [`apiPlanningRepositories.ts:63-80`](../../src/repositories/apiPlanningRepositories.ts) has the
  same gap against the app's own backend.
* Backend Graph calls go through `GraphServiceClient` (Kiota), whose default middleware pipeline
  includes a `RetryHandler` that honours `Retry-After` — so that side is covered indirectly. The
  app's own endpoints have no backpressure handling.

`$batch` is not used anywhere, although two call sites are natural candidates: the per-user photo
fetches (6.6) and the members/owners pair in `FetchTeamMembersAsync`.

### 6.6 Profile photos: one request per person

[`ResourceAvatar.tsx:17`](../../src/components/resourceSummary/ResourceAvatar.tsx) calls
`getUserPhotoObjectUrl()` from a `useEffect` per rendered avatar.
[`userPhotoService.ts`](../../src/services/userPhotoService.ts) deduplicates per session via a `Map`,
but the first render of a 50-person team still issues **50 parallel HTTP requests**, saturating the
browser's per-origin connection limit and competing with the actual data fetches. Server-side each is
a Graph call on cache miss.

Mitigating factor: the endpoint sets `private, max-age=86400`
([`PlanningController.cs:369`](../../RppWebApi/Controllers/PlanningController.cs)), so the browser
cache covers subsequent loads. A batch endpoint (or Graph `$batch`, 20 per batch) would reduce the
cold case from 50 requests to 3.

### 6.7 Teams context re-resolved on every HTTP request

[`currentUser.ts:47`](../../src/infrastructure/microsoft365/currentUser.ts) constructs a
`new TeamsSsoAuthProvider(logger)` and calls `getContext()` on **every invocation**, and
[`TeamsSsoAuthProvider`](../../src/infrastructure/microsoft365/teamsSsoAuthProvider.ts) performs
**no caching at all**. It is called from
[`apiPlanningRepositories.ts:39`](../../src/repositories/apiPlanningRepositories.ts) — inside
`fetchJson`, i.e. **once per HTTP request** — plus again at line 153 in `listMemberships` and again
in [`planningDataService.ts:67`](../../src/services/planningDataService.ts).

A single snapshot load therefore triggers roughly 8–10 `postMessage` round trips to the Teams host
where one would suffice.

`fetchJson` also serialises two independent operations:

```ts
const authResult   = await this.getApiToken();          // round trip 1
const activeTeamId = await resolveActiveTeamId(this.logger);  // round trip 2 — independent
```

These belong in a `Promise.all`.

Outside a Teams host this becomes pathological: `getContext()` falls into its 5 s timeout
([`teamsSsoAuthProvider.ts:95`](../../src/infrastructure/microsoft365/teamsSsoAuthProvider.ts)) and
`getAccessToken` into another 5 s (line 58) — per request. This is the likely explanation for
observed stalls in browser demo mode.

Note that the *token* layer already solves this correctly:
[`CachedMicrosoft365AuthProvider`](../../src/infrastructure/microsoft365/cachedAuthProvider.ts)
caches per scope key until `expiresOn` minus a 60 s skew. The *context* layer simply never received
the same treatment.

---

## 7. Timeline rendering

The timeline always renders **12 months of history** in addition to the selected period
([`Timeline.tsx:696-717`](../../src/components/timeline/Timeline.tsx), `timelinePastMonths = 12`):

| Period | Days per row | Cells at 50 people |
|---|---|---|
| `next30Days` | ~395 | ~19 750 |
| `nextThreeMonths` (default) | ~456 | **~22 800** |
| `nextSixMonths` | ~547 | ~27 350 |
| `fullYear` | ~730 | **~36 500** |

*(computed from the loop bounds, not measured in a browser)*

[`TimelineRow.tsx:51-61`](../../src/components/timeline/TimelineRow.tsx) emits one `<button>` per
cell, each with an inline `style`, four concatenated class names, and a template-string `aria-label`.
A search across `src/` for `virtual|windowing|react-window|IntersectionObserver|content-visibility`
returns **no matches** — everything is mounted.

[`capacityEngine.ts:13-23`](../../src/services/capacityEngine.ts) additionally computes
O(resources × days) result objects, each involving a reduction over that person's absences, i.e.
O(R × D × A).

**Memoisation itself is done carefully.** `Timeline.tsx` carries roughly 20 correctly-dependent
`useMemo` hooks, and both `TimelineRow` and `TimelineGrid` are wrapped in `memo()`. Re-renders are
consequently cheap. The cost concentrates in the **initial mount** and in period changes, where
`days` changes identity and every cell is recreated.

The 12-month lookback is the quiet multiplier here: selecting `next30Days` produces 395 columns, not
30. Whether that lookback needs to be unconditional is a product question worth asking — it is the
single largest lever on this number, ahead of any rendering technique.

---

## 8. Observability of startup

[`main.tsx:9,19-25`](../../src/main.tsx) records an `applicationStartup` metric from module
evaluation to the first `requestAnimationFrame`. Two limitations:

* The measurement starts *after* the bundle has downloaded, so it excludes the dominant cost.
* [`monitoringService.ts`](../../src/infrastructure/monitoring/monitoringService.ts) keeps metrics in
  an in-memory ring buffer capped at 100 entries, with no export path.

There is therefore no real-user monitoring in practice, and time-to-`notifySuccess()` — the number
that actually describes the user's wait — is not captured anywhere.

---

## 9. What is already right

Recorded explicitly so a later refactor does not regress it:

* **Route-level code splitting** with intent preloading on hover and focus (section 4.4).
* **Cache headers** for hashed assets vs. revalidated entry points (section 5.2).
* **Graph query hygiene** — `$select`, `$top`, and full `nextLink` paging on both tiers (6.1).
* **Server-side caching** — 5-minute member cache keyed per team, 24-hour photo cache, both with
  double-checked locking.
* **Parallel snapshot loading** — the seven top-level repository calls in `loadPlanningDataSnapshot`
  run under a single `Promise.all`.
* **Request deduplication and snapshot caching** in
  [`planningBootstrapService.ts`](../../src/services/planningBootstrapService.ts) via a `WeakMap`
  keyed on the repositories instance.
* **Token caching** with expiry skew in `CachedMicrosoft365AuthProvider`.
* **Timeline memoisation** — extensive, correct `useMemo` dependencies plus `memo()` on row and grid.
* **No web fonts** — the Fluent system font stack avoids a render-blocking font fetch entirely.

---

## 10. Prioritised recommendations

| # | Measure | Impact | Effort | Location |
|---|---|---|---|---|
| 1 | Load locales via `import()` instead of static imports | −488 KiB gzip / −1 619 KiB raw initial, −40 requests | M | `localization/translations.ts` |
| 2 | Enable response compression (Brotli + gzip) | ~3.4× fewer bytes on the wire | **XS** | `Program.cs` |
| 3 | Hoist `app.initialize()` / `notifySuccess()` ahead of the React mount | Teams spinner clears ~1–2 s earlier | S | `main.tsx` / `AppShell.tsx:114` |
| 4 | Parallelise `SyncPendingGraphApprovalsAsync`, or move it to a background service | −4 to −8 s on `GET /vacationrequests` | M | `PlanningController.cs:163` |
| 5 | Server-side team filter + paging for absences/events/balances; add `AsNoTracking()` | Payload scales with team, not tenant | M | `PlanningController` / `EfPlanningRepository` |
| 6 | Cache the Teams context (mirroring `CachedMicrosoft365AuthProvider`) | −8 to −10 round trips per snapshot | S | `currentUser.ts` |
| 7 | 429 handling with `Retry-After` and backoff in both fetch clients | Robustness under throttling | S | `graphClient.ts`, `apiPlanningRepositories.ts` |
| 8 | `content-visibility: auto` on timeline rows | Faster mount, no refactoring | **XS** | `Timeline.module.css` |
| 9 | Batch photo endpoint (`$batch`, groups of 20) | 50 requests → 3 | M | `userPhotoService.ts` + API |
| 10 | Resolve the `vendor ↔ react` circular manual chunk | Cleaner preload graph | XS | `vite.config.ts` |

**#2 and #8 are one-liners with disproportionate effect** and are the natural starting point. **#1 is
the largest single win** but requires converting `createTranslator` to an asynchronous load path,
which touches the bootstrap sequence and warrants its own Engineering Order.

Per `AGENTS.md`, only one Engineering Order may be active at a time — none of the above should be
implemented until it has been scoped into an EO and that EO is the active one.

---

## 11. Open items this analysis could not cover

* **Backend test suite and API latency** — `dotnet` is unavailable in the analysis environment.
  Section 6 findings are static; a timed run against a seeded database would quantify 6.2 and 6.4.
* **Real Teams-client startup timing** — no Teams host available. Section 3 derives from the module
  graph, not from a trace.
* **Brotli sizes** — `brotli` unavailable; only gzip was measured.
* **SharePoint provider path** — analysed statically only; the `api` provider was the focus.
