# M365 Ressourcen & Präsenzplanung (RPP)
## Performance Review — Summary

This document summarises a read-only performance analysis of the **M365 Ressourcen & Präsenzplanung (RPP)** application, covering tab startup, Microsoft Graph and backend calls, database access, and frontend runtime behaviour. No application code was changed.

It is a companion to [`code_and_architecture_review.md`](./code_and_architecture_review.md). The full finding table (21 findings with per-item remediation and effort estimates) lives in [`perf/PERFORMANCE-ANALYSIS.md`](./perf/PERFORMANCE-ANALYSIS.md); the load test is [`perf/rpp-load-test.js`](./perf/rpp-load-test.js).

---

## 1. What Was Measured

Unlike a purely static review, the headline numbers below were produced by running the production build and loading it in a real browser.

| Method | Result |
| :--- | :--- |
| `npx vite build` on this checkout | 14.1 s, 2 500 modules, 76 emitted chunks |
| `dist/index.html` `modulepreload` list, sized with `stat` and `gzip -c` | Initial JS **2 458 KB raw / 723 KB gzip across 47 files** |
| Chromium 1194 (Playwright 1.56.1) against `vite preview` of the production build, mock provider, 1440×900 | 53 JS requests, 2 610 680 B decoded, **34 790 DOM nodes / 32 145 `<button>` elements**, 31 MB JS heap |
| Same, throttled to 400 ms RTT / 1.6 Mbit ("Teams mobile on a poor connection") | DOMContentLoaded 5 473 ms, **FCP 5 560 ms**, painted timeline **13 854 ms** |
| Same, unthrottled localhost | DOMContentLoaded 248 ms, FCP 320 ms, painted timeline 7 945 ms |
| `npx tsc --noEmit` / `npx eslint "src/**/*.{ts,tsx}"` | 9.0 s / 8.1 s |

> [!NOTE]
> **Scope limits.** The browser runs used the **mock** provider (31 seeded people), so the DOM and network figures are a *floor* for a real `api` deployment, not a ceiling. `dotnet` is not available in the analysis environment, so **no backend timing, SQL execution plan, or endpoint payload size was measured** — every backend finding below is read from source and is marked as such.

---

## 2. Key Findings

### 2.1. All 39 UI Locales Ship on Every Tab Load
`translations.ts` statically imports every locale file into a single object. The Vite `manualChunks` rule splits them into 39 separate files, but because they remain *static* imports of the entry graph, Vite emits a `modulepreload` for each one — so the browser fetches all 39 on every cold start. Exactly one is ever read.

* **Code Reference**: [`src/localization/translations.ts:3-41`](../../src/localization/translations.ts), [`vite.config.ts:12-18`](../../vite.config.ts)

> [!WARNING]
> **Impact (measured)**: The locale chunks account for **1 619 KB raw / 488 KB gzip — 67 % of the entire initial JS payload** — and 39 of the 53 JS requests on a cold load. This cost is paid on every route, by every user, on every tab open.

**Proposal**: Make the translator async and `import()` only the resolved locale plus `en` as fallback. `resolveInitialLocale` already determines the locale before React renders; `isSupportedLocale` needs a static key list instead of `Object.keys(translations)`.

### 2.2. The Timeline Renders 15 Months of DOM Without Virtualization
Every timeline period adds a fixed 12-month lookback, so the default "next three months" view is **456 day-columns**. `TimelineRow` emits one `<button>` per person per day, plus an `EventLayer`. There is no virtualization primitive anywhere in `src/`.

* **Code Reference**: [`src/components/timeline/Timeline.tsx:696,702-716`](../../src/components/timeline/Timeline.tsx), [`src/components/timeline/TimelineRow.tsx:51-62`](../../src/components/timeline/TimelineRow.tsx)

```typescript
const timelinePastMonths = 12;
// ...
return createTimelineDays(pastStart, timelinePastMonths + 3);   // default view = 15 months
```

> [!WARNING]
> **Impact (measured)**: **32 145 interactive buttons and 34 790 DOM nodes with only 31 people**. On an unthrottled desktop, first contentful paint is 320 ms but the grid is not painted until 7 945 ms — roughly 7.6 s of pure DOM construction and layout. The `fullYear` period is 24 months (~730 columns), about 1.6× that again.

**Proposal**: Two independent wins. (a) Make the lookback period-relative rather than a fixed year — one constant, and it cuts the default view from 456 to ~120 columns. (b) Window the day columns to the visible viewport; [`TimelineViewport.tsx`](../../src/components/timeline/TimelineViewport.tsx) already owns the scroll container and a `ResizeObserver`. Whether a full year of history belongs in the *default* view is a product decision worth confirming before (a).

### 2.3. The API Returns Whole Tables; the Browser Filters Them
`GetAbsencesAsync` supports `employeeId`/`year`/`status` filters and has no `Skip`/`Take`. The frontend passes none of them, so `/api/planning/absences` returns every non-deleted absence row in the database — and `planningDataService` then discards the rows that do not belong to the team, client-side.

* **Code Reference**: [`RppWebApi/Data/EfPlanningRepository.cs:27-46`](../../RppWebApi/Data/EfPlanningRepository.cs), [`src/repositories/apiPlanningRepositories.ts:170-181`](../../src/repositories/apiPlanningRepositories.ts), [`src/services/planningDataService.ts:80-81`](../../src/services/planningDataService.ts)

```typescript
const scopedUserIds = new Set(memberships.map((membership) => membership.member.id));
const scopedAbsences = absences.filter((absence) => scopedUserIds.has(absence.employeeId));
```

> [!WARNING]
> **Impact (static analysis)**: The payload grows with the organisation's entire absence history rather than with the visible period or team. The `pageToken` the client sends is never read server-side, so the `do/while` loop in `listAllPages` always terminates after one page — **the paging is decorative**.

**Proposal**: Send `teamId` and the visible date range; add `Skip`/`Take` and a real continuation token server-side. [`AbsenceConfiguration.cs:31`](../../RppWebApi/Data/Configurations/AbsenceConfiguration.cs) already indexes `(EmployeeId, StartDate)`, so a range filter is index-covered today.

### 2.4. Team-Admin Reads Materialise Full Tables and Filter in Memory
`ScopeTeams(await _context.Teams.ToListAsync(), …)` and `(await _context.MemberAssignments.ToListAsync()).Where(…)` load every row before the predicate is applied — the filtering happens on the client side of EF Core, after the data has crossed the wire.

* **Code Reference**: [`RppWebApi/Data/EfPlanningRepository.cs:598-609,621-634,713,837,876,919`](../../RppWebApi/Data/EfPlanningRepository.cs)

```csharp
var assignments = (await _context.MemberAssignments.ToListAsync())
    .Where(row => scopedTeamIds.Contains(row.TeamId))
    .ToList();
```

> [!WARNING]
> **Impact (static analysis)**: These queries scale with the tenant instead of with the team. Compounding it, **only 3 of the 23 `ToListAsync()` calls in the file use `AsNoTracking()`**, so EF Core builds change-tracking entries for every row of a read-only request.

**Proposal**: Move the predicates inside the `IQueryable` and add `AsNoTracking()` to every read path. Mechanical and low-risk — the best effort-to-benefit ratio on the backend.

### 2.5. A Teams `getContext()` Round Trip on Every API Request
`fetchJson` calls `resolveActiveTeamId()`, which constructs a fresh `TeamsSsoAuthProvider` and awaits `app.getContext()` — a `postMessage` handshake with the Teams host — once per request, with no caching.

* **Code Reference**: [`src/infrastructure/microsoft365/currentUser.ts:47-64`](../../src/infrastructure/microsoft365/currentUser.ts), [`src/repositories/apiPlanningRepositories.ts:39,153`](../../src/repositories/apiPlanningRepositories.ts), [`src/features/team-admin/services/teamAdminApi.ts:140,179`](../../src/features/team-admin/services/teamAdminApi.ts)

> [!WARNING]
> **Impact (static analysis)**: One bootstrap issues 7 parallel repository calls, each doing this once, plus `listMemberships` doing it twice, plus `/access`, plus the team-admin warm-up — **at least 11 host round trips before the first pixel of data**. `initializeTeamsApp()` memoises its promise; `getContext()` does not.

**Proposal**: Memoise the resolved context for the session, following the pattern `initializeTeamsApp` already uses.

### 2.6. No Throttling Handling Anywhere
Neither [`FetchMicrosoftGraphClient`](../../src/infrastructure/microsoft365/graphClient.ts) nor any backend Graph or HTTP path inspects HTTP 429 or the `Retry-After` header. There is no backoff, no jitter, and no circuit breaker; a 429 is mapped to `code: "unknown", recoverable: false`.

* **Code Reference**: [`src/infrastructure/microsoft365/graphClient.ts:76-92`](../../src/infrastructure/microsoft365/graphClient.ts), [`RppWebApi/Program.cs:74-93`](../../RppWebApi/Program.cs) (no resilience handler on any `AddHttpClient`)

> [!WARNING]
> **Impact (static analysis)**: Under a morning-rush load pattern, Graph throttling is the most likely first failure mode — and the app currently has no graceful path out of it. A search for `429`, `Retry-After`, `Polly`, or `CircuitBreaker` across both projects returns nothing.

**Proposal**: Add `Microsoft.Extensions.Http.Resilience` (or Polly) handlers to every `AddHttpClient` registration; in `graphClient.ts`, map 429 to `recoverable: true` and honour `Retry-After` with capped exponential backoff.

### 2.7. Telemetry Is Collected but Never Exported
`monitoringService` keeps the last 100 events and 100 metrics in module-level arrays and ships them nowhere. `main.tsx` records an `applicationStartup` metric on the first animation frame, which is then discarded. Neither project references Application Insights or OpenTelemetry — [`appsettings.json:9`](../../RppWebApi/appsettings.json) configures only a *log level* for an Application Insights provider that is not installed.

* **Code Reference**: [`src/infrastructure/monitoring/monitoringService.ts:11-37`](../../src/infrastructure/monitoring/monitoringService.ts), [`src/main.tsx:19-25`](../../src/main.tsx), [`RppWebApi/RppWebApi.csproj:38-47`](../../RppWebApi/RppWebApi.csproj)

> [!WARNING]
> **Impact**: There is currently **no way to observe any of the above in production**. Every finding in this document would otherwise be a dashboard query rather than a code review.

**Proposal**: Add `Microsoft.ApplicationInsights.AspNetCore` server-side and the JS SDK (or a `/api/telemetry` sink) client-side; export `applicationStartup`, bootstrap duration, and Graph call latency and error rate.

### 2.8. Open Item Carried Over from the Architecture Review
The N+1 query in the member-assignment save loop identified in [`code_and_architecture_review.md`](./code_and_architecture_review.md) §2.2 **is still present**, now at [`EfPlanningRepository.cs:753-757`](../../RppWebApi/Data/EfPlanningRepository.cs). Saving a 30-member team still executes 30 sequential `SELECT` round trips.

### 2.9. Further Findings
Additional items of medium and low impact — module-level API calls fired at import time in `teamAdminApi.ts`, `/info`-only health probes running on every route, a new `GraphServiceClient` constructed per Graph call, an uncached and unpaged `/my-teams`, a single global lock serialising all Graph cache misses, unbatched profile photo requests with unrevoked object URLs, a missing response-compression middleware, and a circular `vendor -> react -> vendor` build chunk — are documented with file references, remediation, and effort in [`perf/PERFORMANCE-ANALYSIS.md`](./perf/PERFORMANCE-ANALYSIS.md).

---

## 3. Areas Confirmed Healthy

Several areas were examined specifically and found to be in good shape:

* **React memoisation**: `Timeline.tsx` wraps essentially every derived value in `useMemo` and every handler in `useCallback`; `TimelineGrid`, `TimelineRow`, and `EventLayer` are all `memo`-wrapped with stable props. The render cost is DOM *volume*, not re-render churn.
* **Route code splitting**: All eight routes plus the help drawer are `React.lazy`, with hover and focus preloading. Route chunks measure 5–47 KB.
* **Event-listener hygiene**: Every `addEventListener`, `ResizeObserver`, and `hashchange` subscription found has a matching cleanup. There are no `setInterval` calls in `src/` and no leaked timers.
* **SharePoint provider query shaping**: `sharePointPlanningRepositories.ts` uses `$select`, `$filter`, and `$top` on every list and follows `@odata.nextLink` — noticeably better discipline than the API provider.
* **Token caching**: `CachedMicrosoft365AuthProvider` caches per scope set with a 60 s expiry skew. Tokens are not re-acquired per render.
* **Static asset caching**: Hashed `/assets` receive `public,max-age=31536000,immutable`; `index.html` and the runtime config receive `no-cache` — correct, and it resolved a real stale-bundle incident (EO-420).
* **Build gates**: `tsc --noEmit` 9.0 s, `eslint` 8.1 s, `vite build` 14.1 s. Not a bottleneck.
* **Bot / message extension**: None exists. `teams-app-package/manifest.json` declares `staticTabs` only, so activity-acknowledgement and adaptive-card concerns do not apply.

---

## 4. Recommended Priority

Ranked by benefit-to-effort ratio:

1. **Lazy-load the locale bundles** ([§2.1](#21-all-39-ui-locales-ship-on-every-tab-load)) — roughly half a day removes **488 KB gzip and 38 HTTP requests** from every tab open, on every route, for every user. Measured, not estimated. Nothing else in this review comes close on that ratio.
2. **Reduce the timeline's fixed 12-month lookback** ([§2.2](#22-the-timeline-renders-15-months-of-dom-without-virtualization)) — one constant, and it cuts roughly 74 % of the 32 145 measured DOM nodes. Full virtualization is the better long-term answer; this captures most of the benefit immediately.
3. **Cache the Teams context and gate the `/info`-only probes** ([§2.5](#25-a-teams-getcontext-round-trip-on-every-api-request)) — half a day removes ~11 host round trips and 2 uncacheable requests from the pre-first-paint path. This matters most exactly where the app is slowest: high-latency mobile, where FCP measured 5 560 ms.
4. **`AsNoTracking()` plus predicates pushed into the `IQueryable`** ([§2.4](#24-team-admin-reads-materialise-full-tables-and-filter-in-memory)) — mechanical and low-risk, and it is the difference between queries that scale with a team and queries that scale with the tenant.

> [!IMPORTANT]
> **One item needs verification before it can be sized.** The missing response-compression middleware in [`Program.cs`](../../RppWebApi/Program.cs) is rated high impact, but the browser measurements ran through `vite preview`, which gzips. Check the `Content-Encoding` header on `/assets/*.js` in the deployed environment before planning that fix — if the host already compresses, the finding is moot; if not, cold load is ~2.6 MB rather than ~790 KB.

---

## 5. Load Testing

[`perf/rpp-load-test.js`](./perf/rpp-load-test.js) is a ready-to-run k6 script covering four scenarios — `morning_rush` (ramp to 120 concurrent sessions), `working_day` (steady-state re-bootstrap), `absence_writes` (the only write path with a Graph call inside its authorization check), and `team_admin` (the full-table-scan endpoints) — with thresholds and an HTML report.

> [!CAUTION]
> Run it against a **non-production** deployment. `absence_writes` creates and deletes real rows, and a 120-VU run against a live tenant can trip Microsoft Graph throttling for other applications in the same tenant. Given that the app has no `Retry-After` handling today ([§2.6](#26-no-throttling-handling-anywhere)), coordinate with the tenant owner before the first peak run.
