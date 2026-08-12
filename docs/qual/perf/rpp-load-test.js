/*
 * k6 load test for M365 RPP (Ressourcen & Präsenzplanung).
 *
 * Covers the two paths that decide whether a Teams tab feels fast:
 *   1. Cold tab load  - the SPA shell + every chunk index.html preloads.
 *   2. Planning bootstrap - the seven API calls loadPlanningDataSnapshot()
 *      fires in parallel, plus the team-admin warm-up and /access.
 *
 * Run:
 *   k6 run perf/rpp-load-test.js \
 *     -e BASE_URL=https://<host> \
 *     -e TOKEN=<Entra access token for the API audience> \
 *     -e TEAM_ID=<M365 group id>
 *
 * Without TOKEN the script still runs; authenticated endpoints will answer 401
 * and are counted as such, which is a useful smoke test on its own but not a
 * capacity measurement. Get a token via Teams SSO or:
 *   az account get-access-token --resource api://<client-id> --query accessToken -o tsv
 *
 * Scenario sizing assumes an organisation-scale deployment (Organisation-A/Organisation-B order of
 * magnitude): ~1200 licensed users, ~35% touching the tab on a given workday,
 * peak concentrated in the 08:00-09:00 window -> ~120 concurrent sessions.
 * Scale VUS_PEAK for your own tenant.
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

// ── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = (__ENV.BASE_URL || "http://localhost:5004").replace(/\/$/, "");
const TOKEN = __ENV.TOKEN || "";
const TEAM_ID = __ENV.TEAM_ID || "";
const VUS_PEAK = Number(__ENV.VUS_PEAK || 120);
const VUS_SOAK = Number(__ENV.VUS_SOAK || 30);

// ── Custom metrics ───────────────────────────────────────────────────────────

const bootstrapDuration = new Trend("rpp_bootstrap_duration", true);
const coldLoadBytes = new Trend("rpp_cold_load_bytes");
const coldLoadRequests = new Counter("rpp_cold_load_requests");
const authFailures = new Rate("rpp_auth_failures");
const payloadBytes = {
  absences: new Trend("rpp_payload_absences_bytes"),
  memberships: new Trend("rpp_payload_memberships_bytes"),
  teamAdminDetails: new Trend("rpp_payload_teamadmin_details_bytes")
};

// ── Scenarios ────────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Everyone opens the tab within the same few minutes after standup.
    // This is the scenario that exposes the 2.5 MB initial JS payload and the
    // uncached Graph calls behind /access and /memberships.
    morning_rush: {
      executor: "ramping-vus",
      exec: "coldTabLoad",
      startVUs: 0,
      stages: [
        { duration: "2m", target: Math.round(VUS_PEAK * 0.25) },
        { duration: "3m", target: VUS_PEAK },
        { duration: "5m", target: VUS_PEAK },
        { duration: "2m", target: 0 }
      ],
      gracefulRampDown: "30s",
      tags: { scenario: "morning_rush" }
    },

    // Steady background use: people leaving the tab open, switching routes,
    // re-bootstrapping planning data. Exercises the cache paths.
    working_day: {
      executor: "constant-vus",
      exec: "planningBootstrap",
      vus: VUS_SOAK,
      duration: "12m",
      startTime: "1m",
      tags: { scenario: "working_day" }
    },

    // Write path: absences created from the timeline. Low rate, but it is the
    // path that goes through CanWriteForUserAsync -> Graph owner check.
    absence_writes: {
      executor: "constant-arrival-rate",
      exec: "createAbsence",
      rate: 6,
      timeUnit: "1m",
      duration: "10m",
      preAllocatedVUs: 5,
      maxVUs: 20,
      startTime: "3m",
      tags: { scenario: "absence_writes" }
    },

    // Team leads opening the Team Admin Center. Hits the endpoints that load
    // the full Teams + MemberAssignments tables and filter them in memory.
    team_admin: {
      executor: "constant-arrival-rate",
      exec: "teamAdminCenter",
      rate: 10,
      timeUnit: "1m",
      duration: "10m",
      preAllocatedVUs: 5,
      maxVUs: 20,
      startTime: "4m",
      tags: { scenario: "team_admin" }
    }
  },

  // Budgets derived from "a Teams tab must feel native".
  // p95 targets assume the app is already past auth; adjust once a baseline exists.
  thresholds: {
    "http_req_failed": ["rate<0.01"],
    "rpp_auth_failures": ["rate<0.01"],
    "rpp_bootstrap_duration": ["p(95)<2500", "p(99)<5000"],
    "http_req_duration{endpoint:health}": ["p(95)<200"],
    "http_req_duration{endpoint:absences}": ["p(95)<800"],
    "http_req_duration{endpoint:memberships}": ["p(95)<1200"],
    "http_req_duration{endpoint:access}": ["p(95)<1000"],
    "http_req_duration{endpoint:teamadmin_details}": ["p(95)<1500"],
    "http_req_duration{endpoint:spa_shell}": ["p(95)<1000"],
    // The whole point of the bundle findings: if this fails, the locale chunks
    // are still being shipped eagerly or compression is off.
    "rpp_cold_load_bytes": ["p(95)<900000"]
  },

  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"]
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function apiHeaders() {
  const headers = { Accept: "application/json" };

  if (TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }

  if (TEAM_ID) {
    // The frontend sends this on every API request (apiPlanningRepositories.ts).
    headers["X-RPP-Active-TeamId"] = TEAM_ID;
  }

  return headers;
}

function get(path, endpointTag) {
  const response = http.get(`${BASE_URL}${path}`, {
    headers: apiHeaders(),
    tags: { endpoint: endpointTag }
  });

  authFailures.add(response.status === 401 || response.status === 403);

  check(response, {
    [`${endpointTag}: not a server error`]: (r) => r.status < 500,
    [`${endpointTag}: answered`]: (r) => r.status !== 0
  });

  return response;
}

// ── Scenario: cold tab load ──────────────────────────────────────────────────
//
// Fetches index.html, then every asset it preloads. That is the honest
// simulation of what a Teams webview does on first open, and it is where the
// 39 eagerly-loaded locale chunks show up as bytes on the wire.

export function coldTabLoad() {
  group("cold tab load", () => {
    const shell = http.get(`${BASE_URL}/`, {
      headers: { Accept: "text/html" },
      tags: { endpoint: "spa_shell" }
    });

    check(shell, { "shell: 200": (r) => r.status === 200 });

    if (shell.status !== 200 || !shell.body) {
      sleep(1);
      return;
    }

    // Collect the modulepreload/stylesheet/entry-script URLs from index.html.
    const assetPaths = [];
    const linkPattern = /href="(\/assets\/[^"]+)"/g;
    const scriptPattern = /src="(\/(?:assets|config)\/[^"]+)"/g;
    let match;

    while ((match = linkPattern.exec(shell.body)) !== null) {
      assetPaths.push(match[1]);
    }
    while ((match = scriptPattern.exec(shell.body)) !== null) {
      assetPaths.push(match[1]);
    }

    const unique = Array.from(new Set(assetPaths));
    const batch = unique.map((path) => [
      "GET",
      `${BASE_URL}${path}`,
      null,
      { headers: { "Accept-Encoding": "gzip, br" }, tags: { endpoint: "spa_asset" } }
    ]);

    const responses = batch.length > 0 ? http.batch(batch) : [];
    let totalBytes = shell.body.length;

    responses.forEach((response) => {
      totalBytes += response.body ? response.body.length : 0;
      // A hashed asset that is not immutable-cacheable means every tab open
      // re-downloads it (Program.cs sets this - verify it survived deployment).
      check(response, {
        "asset: 200": (r) => r.status === 200,
        "asset: long-lived cache header": (r) =>
          (r.headers["Cache-Control"] || "").includes("immutable")
      });
    });

    coldLoadBytes.add(totalBytes);
    coldLoadRequests.add(responses.length + 1);

    // Then the app immediately bootstraps.
    planningBootstrap();
  });

  sleep(Math.random() * 5 + 3);
}

// ── Scenario: planning bootstrap ─────────────────────────────────────────────
//
// Mirrors loadPlanningDataSnapshot(): seven repository calls in parallel, plus
// the /access call AppShell makes on mount and the release/health probes
// PlaceholderPage fires on every route.

export function planningBootstrap() {
  const started = Date.now();

  group("planning bootstrap", () => {
    const teamQuery = TEAM_ID ? `?teamId=${encodeURIComponent(TEAM_ID)}` : "";

    const responses = http.batch([
      ["GET", `${BASE_URL}/api/planning/memberships${teamQuery}`, null, { headers: apiHeaders(), tags: { endpoint: "memberships" } }],
      ["GET", `${BASE_URL}/api/planning/absences`, null, { headers: apiHeaders(), tags: { endpoint: "absences" } }],
      ["GET", `${BASE_URL}/api/planning/vacationbalances`, null, { headers: apiHeaders(), tags: { endpoint: "vacationbalances" } }],
      ["GET", `${BASE_URL}/api/planning/holidays`, null, { headers: apiHeaders(), tags: { endpoint: "holidays" } }],
      ["GET", `${BASE_URL}/api/planning/settings`, null, { headers: apiHeaders(), tags: { endpoint: "settings" } }],
      ["GET", `${BASE_URL}/api/planning/events`, null, { headers: apiHeaders(), tags: { endpoint: "events" } }],
      ["GET", `${BASE_URL}/api/planning/teamconfigurations`, null, { headers: apiHeaders(), tags: { endpoint: "teamconfigurations" } }],
      ["GET", `${BASE_URL}/api/planning/access`, null, { headers: apiHeaders(), tags: { endpoint: "access" } }],
      ["GET", `${BASE_URL}/health`, null, { headers: apiHeaders(), tags: { endpoint: "health" } }]
    ]);

    responses.forEach((response) => {
      authFailures.add(response.status === 401 || response.status === 403);
      check(response, { "bootstrap: not a server error": (r) => r.status < 500 });
    });

    if (responses[0] && responses[0].body) {
      payloadBytes.memberships.add(responses[0].body.length);
    }
    if (responses[1] && responses[1].body) {
      // Watch this one. /api/planning/absences has no team or date filter, so
      // it grows with the whole organisation's history, not with the team.
      payloadBytes.absences.add(responses[1].body.length);
    }
  });

  bootstrapDuration.add(Date.now() - started);
  sleep(Math.random() * 3 + 2);
}

// ── Scenario: absence write ──────────────────────────────────────────────────

export function createAbsence() {
  const employeeId = __ENV.EMPLOYEE_ID || "";

  if (!employeeId) {
    // Without a real employee id the server correctly refuses the write; still
    // useful to measure the authorization path, which calls Graph.
    get("/api/planning/access", "access");
    sleep(2);
    return;
  }

  const today = new Date();
  const start = new Date(today.getTime() + 86400000 * (7 + (__ITER % 30)));
  const iso = (d) => d.toISOString().slice(0, 10);

  const body = JSON.stringify({
    id: `abs-loadtest-${__VU}-${__ITER}`,
    employeeId,
    type: "vacation",
    startDate: iso(start),
    startHalf: "fullDay",
    endDate: iso(start),
    endHalf: "fullDay",
    status: "planned",
    comment: "k6 load test - safe to delete"
  });

  const response = http.post(`${BASE_URL}/api/planning/absences`, body, {
    headers: { ...apiHeaders(), "Content-Type": "application/json" },
    tags: { endpoint: "absences_write" }
  });

  check(response, { "absence write: not a server error": (r) => r.status < 500 });

  // Clean up so repeat runs do not inflate the absence table (which is exactly
  // the table the read path returns in full).
  if (response.status === 200) {
    http.del(`${BASE_URL}/api/planning/absences/abs-loadtest-${__VU}-${__ITER}`, null, {
      headers: apiHeaders(),
      tags: { endpoint: "absences_delete" }
    });
  }

  sleep(3);
}

// ── Scenario: team admin center ──────────────────────────────────────────────

export function teamAdminCenter() {
  group("team admin center", () => {
    get("/api/planning/teamadmin/teams", "teamadmin_teams");

    // "__all-teams" is the id the frontend warm-up uses at module load.
    const details = get("/api/planning/teamadmin/details/__all-teams", "teamadmin_details");

    if (details.body) {
      payloadBytes.teamAdminDetails.add(details.body.length);
    }

    get("/api/planning/teamadmin/displayconfig", "teamadmin_displayconfig");
    get("/api/planning/my-teams", "my_teams");
  });

  sleep(5);
}

// ── Reporting ────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  return {
    "perf/rpp-load-test-report.html": htmlReport(data),
    stdout: JSON.stringify(
      {
        bootstrap_p95_ms: data.metrics.rpp_bootstrap_duration?.values?.["p(95)"],
        cold_load_p95_bytes: data.metrics.rpp_cold_load_bytes?.values?.["p(95)"],
        absences_payload_p95_bytes: data.metrics.rpp_payload_absences_bytes?.values?.["p(95)"],
        http_req_failed_rate: data.metrics.http_req_failed?.values?.rate,
        auth_failure_rate: data.metrics.rpp_auth_failures?.values?.rate
      },
      null,
      2
    )
  };
}
