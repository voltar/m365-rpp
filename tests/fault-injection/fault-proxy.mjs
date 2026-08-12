#!/usr/bin/env node
// Fault-injection proxy for the RPP frontend -> RPP Web API path.
//
// Sits between the SPA and the API, forwards everything by default and applies the rules of the
// selected scenario (tests/fault-injection/scenarios.json) to matching requests. Test artifact only:
// nothing in src/ or RppWebApi/ knows this file exists - the SPA reaches it through the runtime
// configuration override described in README.md.
//
//   node tests/fault-injection/fault-proxy.mjs --scenario throttle-retry-after
//   node tests/fault-injection/fault-proxy.mjs --target http://localhost:5004 --port 5099
//
// The active scenario can be switched without a restart:
//   curl -X POST localhost:5099/__fi/scenario -d '{"scenario":"blackhole"}'
//   curl localhost:5099/__fi/state
//
// No dependencies beyond the Node standard library (Node 18+).

import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const options = parseArguments(process.argv.slice(2));
const scenarios = JSON.parse(readFileSync(join(here, "scenarios.json"), "utf8"));

let activeScenarioName = options.scenario;
let matchCounters = new Map();
let requestCounter = 0;
const journal = [];

if (!scenarios[activeScenarioName]) {
  fail(`Unknown scenario "${activeScenarioName}". Known: ${Object.keys(scenarios).filter((key) => !key.startsWith("$")).join(", ")}`);
}

const targetUrl = new URL(options.target);

const server = createServer(handleRequest);
server.on("clientError", (error, socket) => {
  // A destroyed socket is a fault we injected on purpose - do not let it kill the proxy.
  if (!socket.destroyed) {
    socket.destroy();
  }
});

server.listen(options.port, () => {
  log(`fault-proxy listening on http://localhost:${options.port} -> ${options.target}`);
  log(`scenario: ${activeScenarioName} - ${scenarios[activeScenarioName].description ?? ""}`);
  log(`point the SPA at http://localhost:${options.port} (see tests/fault-injection/README.md)`);
});

function handleRequest(clientRequest, clientResponse) {
  const requestId = ++requestCounter;
  const method = clientRequest.method ?? "GET";
  const path = clientRequest.url ?? "/";

  if (path.startsWith("/__fi/")) {
    handleControlRequest(clientRequest, clientResponse, path);
    return;
  }

  const rule = selectRule(method, path);

  if (!rule) {
    forward(clientRequest, clientResponse, { requestId, method, path });
    return;
  }

  record({ requestId, method, path, rule: describeRule(rule), applied: true });

  if (rule.blackhole) {
    log(`#${requestId} ${method} ${path} -> BLACKHOLE (no answer, socket held open)`);
    // Deliberately never call end(): this is what a stalled dependency looks like to fetch().
    clientRequest.socket.setKeepAlive(true);
    return;
  }

  if (rule.cut === "before") {
    log(`#${requestId} ${method} ${path} -> CUT before forwarding`);
    clientRequest.socket.destroy();
    return;
  }

  const respond = resolveRespond(rule);

  if (respond) {
    const delay = rule.delayMs ?? 0;
    setTimeout(() => {
      log(`#${requestId} ${method} ${path} -> INJECT HTTP ${respond.status}${delay ? ` after ${delay}ms` : ""}`);
      sendSynthetic(clientRequest, clientResponse, respond);
    }, delay);
    return;
  }

  forward(clientRequest, clientResponse, { requestId, method, path, rule });
}

function forward(clientRequest, clientResponse, context) {
  const { requestId, method, path, rule } = context;
  const delay = rule?.delayMs ?? 0;

  // Request bodies here are small JSON documents; buffering them keeps the delayed path honest
  // (a piped stream would already be drained by the time the timer fires).
  const run = (requestBody) => {
    const isHttps = targetUrl.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const headers = { ...clientRequest.headers, host: targetUrl.host };

    const upstream = requestFn(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        method,
        path,
        headers
      },
      (upstreamResponse) => {
        if (rule?.cut === "after") {
          log(`#${requestId} ${method} ${path} -> CUT after upstream answered ${upstreamResponse.statusCode}`);
          upstreamResponse.destroy();
          clientRequest.socket.destroy();
          return;
        }

        if (rule?.mutate) {
          collectBody(upstreamResponse).then((body) => {
            const mutated = mutateBody(rule.mutate, body, path);
            log(`#${requestId} ${method} ${path} -> MUTATE ${rule.mutate} (${upstreamResponse.statusCode})`);
            const outgoingHeaders = stripLengthHeaders(upstreamResponse.headers);
            outgoingHeaders["content-type"] = mutated.contentType;
            clientResponse.writeHead(upstreamResponse.statusCode ?? 200, outgoingHeaders);
            clientResponse.end(mutated.body);
          });
          return;
        }

        log(`#${requestId} ${method} ${path} -> ${upstreamResponse.statusCode}${delay ? ` (delayed ${delay}ms)` : ""}`);
        clientResponse.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(clientResponse);
      }
    );

    upstream.on("error", (error) => {
      log(`#${requestId} ${method} ${path} -> upstream error: ${error.message}`);

      if (!clientResponse.headersSent) {
        clientResponse.writeHead(502, { "content-type": "application/json", ...corsHeaders(clientRequest) });
      }

      clientResponse.end(JSON.stringify({ code: "proxyUpstreamError", message: error.message }));
    });

    upstream.end(requestBody.length > 0 ? requestBody : undefined);
  };

  collectBody(clientRequest).then((requestBody) => {
    if (delay > 0) {
      setTimeout(() => run(requestBody), delay);
      return;
    }

    run(requestBody);
  });
}

function selectRule(method, path) {
  const scenario = scenarios[activeScenarioName];

  for (const rule of scenario.rules ?? []) {
    if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) {
      continue;
    }

    if (!matchesPath(rule.path, path)) {
      continue;
    }

    const key = `${activeScenarioName}|${rule.path}|${rule.method ?? "*"}`;
    const seen = (matchCounters.get(key) ?? 0) + 1;
    matchCounters.set(key, seen);

    if (rule.skipFirst && seen <= rule.skipFirst) {
      continue;
    }

    if (rule.onlyOnce && seen > (rule.skipFirst ?? 0) + 1) {
      continue;
    }

    return { ...rule, hitCount: seen };
  }

  return undefined;
}

function matchesPath(pattern, path) {
  if (!pattern) {
    return true;
  }

  if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
    return new RegExp(pattern.slice(1, -1)).test(path);
  }

  return path.includes(pattern);
}

function resolveRespond(rule) {
  if (!rule.respond) {
    return undefined;
  }

  if (rule.alternate && rule.hitCount % 2 === 0) {
    return rule.alternate;
  }

  return rule.respond;
}

function sendSynthetic(clientRequest, clientResponse, respond) {
  const body = typeof respond.body === "string"
    ? respond.body
    : JSON.stringify(respond.body ?? { code: "injectedFault" });

  clientResponse.writeHead(respond.status ?? 500, {
    "content-type": "application/json",
    ...corsHeaders(clientRequest),
    ...(respond.headers ?? {})
  });
  clientResponse.end(body);
}

// The SPA sends credentialed cross-origin requests. Injected answers never reach the API, so the
// proxy has to produce the CORS headers itself - otherwise the browser reports an opaque network
// error and the test would measure the proxy instead of the app.
function corsHeaders(clientRequest) {
  const origin = clientRequest.headers.origin;

  if (!origin) {
    return {};
  }

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization,content-type,accept,x-rpp-active-teamid",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "access-control-expose-headers": "retry-after"
  };
}

function mutateBody(kind, body, path) {
  const asText = body.toString("utf8");

  switch (kind) {
    case "emptyObject":
      return { body: "{}", contentType: "application/json" };

    case "html":
      return {
        body: "<!doctype html><html><head><title>502 Bad Gateway</title></head><body>502</body></html>",
        contentType: "text/html"
      };

    case "truncate":
      return { body: asText.slice(0, Math.max(1, Math.floor(asText.length / 2))), contentType: "application/json" };

    case "pagingLoop": {
      const parsed = tryParse(asText);

      if (!parsed) {
        return { body: asText, contentType: "application/json" };
      }

      // Always hand back the same token: a server (or a broken proxy) that never advances.
      parsed.nextPageToken = "fault-injection-stuck-token";
      return { body: JSON.stringify(parsed), contentType: "application/json" };
    }

    case "nullFields": {
      const parsed = tryParse(asText);

      if (!parsed || !Array.isArray(parsed.items)) {
        return { body: asText, contentType: "application/json" };
      }

      parsed.items = parsed.items.map((item) =>
        Object.fromEntries(Object.keys(item ?? {}).map((key) => [key, key === "id" ? item[key] : null]))
      );
      return { body: JSON.stringify(parsed), contentType: "application/json" };
    }

    default:
      log(`unknown mutate "${kind}" for ${path} - passing the body through unchanged`);
      return { body: asText, contentType: "application/json" };
  }
}

function tryParse(text) {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function collectBody(stream) {
  return new Promise((resolve) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", () => resolve(Buffer.concat(chunks)));
  });
}

function stripLengthHeaders(headers) {
  const copy = { ...headers };
  delete copy["content-length"];
  delete copy["content-encoding"];
  delete copy["transfer-encoding"];
  return copy;
}

function handleControlRequest(clientRequest, clientResponse, path) {
  if (path === "/__fi/state") {
    sendJson(clientResponse, 200, {
      scenario: activeScenarioName,
      description: scenarios[activeScenarioName].description,
      faultIds: scenarios[activeScenarioName].faultIds ?? [],
      target: options.target,
      requests: requestCounter,
      journal: journal.slice(-50)
    });
    return;
  }

  if (path === "/__fi/scenario" && clientRequest.method === "POST") {
    collectBody(clientRequest).then((body) => {
      const parsed = tryParse(body.toString("utf8"));
      const next = parsed?.scenario;

      if (!next || !scenarios[next]) {
        sendJson(clientResponse, 400, { error: "unknown scenario", known: Object.keys(scenarios).filter((key) => !key.startsWith("$")) });
        return;
      }

      activeScenarioName = next;
      matchCounters = new Map();
      log(`scenario switched to "${next}"`);
      sendJson(clientResponse, 200, { scenario: activeScenarioName, faultIds: scenarios[next].faultIds ?? [] });
    });
    return;
  }

  if (path === "/__fi/reset" && clientRequest.method === "POST") {
    matchCounters = new Map();
    journal.length = 0;
    requestCounter = 0;
    sendJson(clientResponse, 200, { reset: true });
    return;
  }

  sendJson(clientResponse, 404, { error: "unknown control endpoint", endpoints: ["/__fi/state", "POST /__fi/scenario", "POST /__fi/reset"] });
}

function sendJson(clientResponse, status, payload) {
  clientResponse.writeHead(status, { "content-type": "application/json" });
  clientResponse.end(JSON.stringify(payload, null, 2));
}

function record(entry) {
  journal.push({ ...entry, at: new Date().toISOString() });

  if (journal.length > 500) {
    journal.splice(0, journal.length - 500);
  }
}

function describeRule(rule) {
  return {
    path: rule.path,
    method: rule.method ?? "*",
    hitCount: rule.hitCount,
    effect: rule.blackhole ? "blackhole" : rule.cut ? `cut:${rule.cut}` : rule.mutate ? `mutate:${rule.mutate}` : rule.respond ? `http:${rule.respond.status}` : rule.delayMs ? `delay:${rule.delayMs}` : "none"
  };
}

function parseArguments(argv) {
  const parsed = {
    port: Number(process.env.FI_PORT ?? 5099),
    target: process.env.FI_TARGET ?? "http://localhost:5004",
    scenario: process.env.FI_SCENARIO ?? "passthrough"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--port") {
      parsed.port = Number(argv[++index]);
    } else if (argument === "--target") {
      parsed.target = argv[++index];
    } else if (argument === "--scenario" || argument === "-s") {
      parsed.scenario = argv[++index];
    } else if (argument === "--list") {
      Object.entries(scenariosForListing()).forEach(([name, scenario]) => {
        console.log(`${name.padEnd(22)} ${(scenario.faultIds ?? []).join(",").padEnd(12)} ${scenario.description ?? ""}`);
      });
      process.exit(0);
    } else if (argument === "--help" || argument === "-h") {
      console.log("usage: node tests/fault-injection/fault-proxy.mjs [--scenario <name>] [--target <url>] [--port <n>] [--list]");
      process.exit(0);
    }
  }

  return parsed;
}

function scenariosForListing() {
  const raw = JSON.parse(readFileSync(join(here, "scenarios.json"), "utf8"));
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith("$")));
}

function log(message) {
  console.log(`[fault-proxy] ${message}`);
}

function fail(message) {
  console.error(`[fault-proxy] ${message}`);
  process.exit(1);
}
