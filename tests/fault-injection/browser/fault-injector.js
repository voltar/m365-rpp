/*
 * Browser-side fault injector for paths the proxy cannot reach.
 *
 * The SPA talks to Microsoft Graph through a hardcoded base URL with an origin allowlist
 * (src/infrastructure/microsoft365/graphClient.ts:22 and src/core/security/urlSecurity.ts), so Graph
 * traffic cannot be redirected to the fault proxy without changing production code. The same is true
 * for the Teams host SDK, which lives on window.microsoftTeams. This file patches both at runtime,
 * from the outside.
 *
 * Test artifact - never imported by the application, never bundled.
 *
 * Usage: paste this file into the DevTools console of the running app (or inject it with
 * page.addInitScript() when driving the app from Playwright), then:
 *
 *   __fi.graph({ status: 429, retryAfter: 5, skipFirst: 1 })  // FI-02 on the Graph path
 *   __fi.graph({ status: 429 })                               // FI-08
 *   __fi.graph({ stall: true })                               // FI-03
 *   __fi.graph({ body: {} })                                  // FI-13 - 200 with the wrong shape
 *   __fi.graph({ status: 401, skipFirst: 2 })                 // FI-10 - token goes stale mid-session
 *   __fi.stallTeamsContext(30000)                             // FI-07
 *   __fi.stallGetAuthToken(30000)                             // FI-12
 *   __fi.report()                                             // what was injected so far
 *   __fi.off()                                                // restore everything
 *
 * Reload the tab between scenarios: the planning bootstrap caches its snapshot per repositories
 * instance (src/services/planningBootstrapService.ts:32).
 */
(() => {
  const originalFetch = window.fetch.bind(window);
  const teamsSdk = window.microsoftTeams;
  const originalGetContext = teamsSdk?.app?.getContext;
  const originalGetAuthToken = teamsSdk?.authentication?.getAuthToken;

  let graphRule;
  let matchCount = 0;
  const journal = [];

  const never = () => new Promise(() => {});

  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    const isGraph = url.startsWith("https://graph.microsoft.com");

    if (!graphRule || !isGraph) {
      return originalFetch(input, init);
    }

    matchCount += 1;

    if (graphRule.skipFirst && matchCount <= graphRule.skipFirst) {
      journal.push({ url, action: "passthrough (skipFirst)", at: new Date().toISOString() });
      return originalFetch(input, init);
    }

    if (graphRule.stall) {
      journal.push({ url, action: "stall (no answer)", at: new Date().toISOString() });
      return never();
    }

    if (graphRule.networkError) {
      journal.push({ url, action: "TypeError (connection reset)", at: new Date().toISOString() });
      throw new TypeError("Failed to fetch (injected)");
    }

    const headers = new Headers({ "content-type": "application/json" });

    if (graphRule.retryAfter !== undefined) {
      headers.set("Retry-After", String(graphRule.retryAfter));
    }

    const status = graphRule.status ?? 200;
    const body = graphRule.body !== undefined
      ? JSON.stringify(graphRule.body)
      : JSON.stringify({ error: { code: "injectedFault", message: `Injected HTTP ${status}.` } });

    journal.push({ url, action: `HTTP ${status}${graphRule.retryAfter !== undefined ? ` Retry-After:${graphRule.retryAfter}` : ""}`, at: new Date().toISOString() });

    return new Response(graphRule.truncate ? body.slice(0, Math.floor(body.length / 2)) : body, { status, headers });
  };

  window.__fi = {
    graph(rule) {
      graphRule = rule;
      matchCount = 0;
      console.info("[fault-injector] Graph rule active:", rule);
    },

    stallTeamsContext(ms = 30000) {
      if (!teamsSdk?.app) {
        console.warn("[fault-injector] window.microsoftTeams.app is not present - are you running inside Teams?");
        return;
      }

      teamsSdk.app.getContext = () => {
        journal.push({ url: "teams:getContext", action: `stall ${ms}ms`, at: new Date().toISOString() });
        return new Promise((resolve) => setTimeout(() => resolve(originalGetContext?.call(teamsSdk.app)), ms));
      };
      console.info(`[fault-injector] getContext stalls for ${ms}ms. Watch how many times it is called per bootstrap.`);
    },

    stallGetAuthToken(ms = 30000) {
      if (!teamsSdk?.authentication) {
        console.warn("[fault-injector] window.microsoftTeams.authentication is not present.");
        return;
      }

      teamsSdk.authentication.getAuthToken = () => {
        journal.push({ url: "teams:getAuthToken", action: `stall ${ms}ms`, at: new Date().toISOString() });
        return new Promise(() => {});
      };
      console.info("[fault-injector] getAuthToken never settles. Expect the 10s guard in teamsSsoAuthProvider.ts:71 to fire.");
    },

    report() {
      console.table(journal);
      return journal;
    },

    off() {
      window.fetch = originalFetch;
      graphRule = undefined;

      if (teamsSdk?.app && originalGetContext) {
        teamsSdk.app.getContext = originalGetContext;
      }

      if (teamsSdk?.authentication && originalGetAuthToken) {
        teamsSdk.authentication.getAuthToken = originalGetAuthToken;
      }

      console.info("[fault-injector] restored.");
    }
  };

  console.info("[fault-injector] ready. See __fi.graph / __fi.stallTeamsContext / __fi.stallGetAuthToken / __fi.report / __fi.off");
})();
