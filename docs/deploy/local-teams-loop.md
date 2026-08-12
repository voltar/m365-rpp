# Local Teams loop — checklist (Dev Tunnel)

Goal: exercise **real Microsoft Teams** behaviour (SSO, host context, deep links, EO-456 seed)
against code running on your machine — without packing and ZIP-deploying to Azure every time.

This is the short cycle next to the normal path:

```text
npm run package:api -- --env prod  →  az webapp deploy  →  rpp-dev App Service
```

Your machine already has the **Dev Tunnel CLI** (`devtunnel`). A previous setup may have been a
one-off tunnel that no longer exists (`devtunnel list` empty), or **VS Code / Cursor port
forwarding** (different tool, same idea: public HTTPS → localhost).

---

## 1. What you are wiring (mental model)

```text
Microsoft Teams (desktop or web)
        │  loads tab contentUrl (must be HTTPS)
        ▼
  https://<your-tunnel-host>/     ← public face Teams is allowed to open
        │  Dev Tunnel forwards
        ▼
  http://127.0.0.1:<local-port>   ← your PC
        │
        ├─ SPA (React bundle or Vite)
        └─ /api/*  →  RppWebApi (Graph + SQL)
```

Three things must agree on the **same public host name**:

| Place | Why |
| --- | --- |
| Tunnel URL | What Teams actually loads |
| Teams manifest `contentUrl` + `validDomains` | Teams refuses other origins |
| Entra / `webApplicationInfo.resource` | Teams SSO token audience for the API |

If only the tunnel runs but the **sideloaded app still points at Azure**, you are still testing
Azure — that is the usual source of “I thought I had a tunnel”.

---

## 2. Two ways to run locally (pick one)

### Path A — recommended: one port, API serves the SPA

Matches production: Kestrel serves `wwwroot` + `/api`.

| Process | Port (this repo) |
| --- | --- |
| `cd RppWebApi && dotnet run` | HTTP **5004**, HTTPS **5005** |
| Tunnel target | **5004** (or 5005 if you terminate TLS yourself) |

Frontend must be built into what the API serves:

```bash
npm run build
# mirror dist → RppWebApi/wwwroot (package:api does this; for a quick loop:)
# PowerShell example:
Remove-Item -Recurse -Force RppWebApi/wwwroot -ErrorAction SilentlyContinue
Copy-Item -Recurse dist RppWebApi/wwwroot
```

Stamp a **local** runtime config into `RppWebApi/wwwroot/config/runtime-config.js` so the browser
talks to the **same origin** (the tunnel), not Azure:

```js
window.__RESOURCE_PRESENCE_PLANNER_CONFIG__ = {
  environmentName: "LOCAL-TUNNEL",
  planningMembershipSource: "mock",   // memberships come from API when dataSource is api
  planningDataSource: "api",
  approvalMode: "mock",               // or m365 if you need that path
  sharePointSiteUrl: "",
  // Same origin via tunnel: empty or the tunnel https origin both work if the SPA is on the API host.
  apiBaseUrl: "",                     // prefer "" = same origin as the tab
  apiAccessTokenScopes: [
    "api://00000000-0000-0000-0000-000000000002/access_as_user"
  ],
  // After Entra is updated for the tunnel host, the resource/scope host part may need to match
  // webApplicationInfo.resource — see §5.
  healthCheckUrl: "/health"
};
```

**CSP note:** production `index.html` allows `connect-src` to localhost API ports, not arbitrary
tunnel hosts. With **same-origin** `apiBaseUrl: ""`, API calls stay on `'self'` and CSP is fine.
If you point `apiBaseUrl` at a *second* origin, you must extend CSP `connect-src` for that host.

### Path B — Vite dev server + proxy (faster UI reload)

| Process | Port |
| --- | --- |
| `npm run dev` | **4321** (`vite.config.ts`) |
| Vite proxies `/api`, `/health` → `http://localhost:5004` | |
| `dotnet run` | **5004** |
| Tunnel target | **4321** |

`public/config/runtime-config.js` defaults to **mock**. For API mode while tunnelling, either:

- temporarily set `planningDataSource: "api"` and `apiBaseUrl: ""` (same origin through Vite proxy), or  
- use App Admin **local override** once the shell loads (only helps after first paint; seed/API tests need api from the start).

Hot reload works; Teams still full-reloads the iframe on many navigations.

---

## 3. One-time / rare setup checklist

### 3.1 Dev Tunnel CLI

```bash
devtunnel --version
devtunnel user login          # once per machine / org
```

Create a **persistent** tunnel (stable host name — important for Entra + manifest):

```bash
# Example: named tunnel, port 5004 (Path A)
devtunnel create rpp-local -a
devtunnel port create rpp-local -p 5004
devtunnel host rpp-local
```

Note the printed HTTPS URL, e.g.:

```text
https://<something>.euw.devtunnels.ms
```

Optional: allow anonymous browser access if the tunnel requires a prompt page (Teams webviews hate
interactive tunnel consent pages):

```bash
devtunnel host rpp-local --allow-anonymous
```

If Teams shows a Dev Tunnel access page instead of RPP, fix access first — nothing else will work.

**Check you still have it:**

```bash
devtunnel list
devtunnel show rpp-local
```

Empty list ⇒ tunnel was deleted or never persisted; recreate before debugging Teams.

### 3.2 Sideload manifest “RPP Local” (do not overwrite the Azure package blindly)

Copy `teams-app-package/` to something like `teams-app-package-local/` and change **only**:

1. **`id`** — new GUID (so Azure “RPP RC7” and local app can coexist).  
2. **`name.short`** — e.g. `RPP Local`.  
3. **`staticTabs[0].contentUrl`** and **`websiteUrl`** — tunnel HTTPS origin (no trailing path required if the API serves `/`).  
4. **`validDomains`** — tunnel host only (no `https://`).  
5. **`webApplicationInfo`** — must match Entra (§5). Typical Teams pattern:

```json
"webApplicationInfo": {
  "id": "00000000-0000-0000-0000-000000000002",
  "resource": "api://<tunnel-host-without-https>/00000000-0000-0000-0000-000000000002"
}
```

Zip icons + manifest + locale JSON; in Teams: **Apps → Manage your apps → Upload a custom app**
(or org catalog if that is how you sideload).

Pin **RPP Local** in a **test team**, not only personal scope, when testing EO-456 host seed
(`X-RPP-Active-TeamId` / channel `groupId`).

### 3.3 Entra ID (app registration used by the API / Teams SSO)

Exact blades differ slightly by portal UI; you need all of the following for the **API app**
(`00000000-0000-0000-0000-000000000002` in the current dev manifest):

- [ ] **Application ID URI** exposes a URI whose host is the tunnel host  
      `api://<tunnel-host>/<client-id>`  
      (You can keep the Azure App Service URI as an *additional* URI if the portal allows multiple.)
- [ ] **Expose an API** → scope `access_as_user` (already used in prod config).
- [ ] **Authorized client applications** / Teams client IDs still allowed to request that scope
      (same as for rpp-dev).
- [ ] **SPA / redirect** entries only if you also open the tunnel URL outside Teams; pure Teams SSO
      is driven by `webApplicationInfo`, not by a browser redirect URI.
- [ ] **API App Service / local API** `AzureAd__Audience` still accepts tokens for this API
      (local User Secrets aligned with the registration).

If SSO fails with empty token / 401 while the tab loads: 9/10 times `resource` in the manifest
does not match an Application ID URI on the app registration.

### 3.4 Local API secrets (Path A/B)

Same as normal local API work ([scripts/dev-setup/README.md](../scripts/dev-setup/README.md)):

```bash
cd RppWebApi
dotnet user-secrets list
# Need at least:
# ConnectionStrings:DefaultConnection  → rpp-db-dev (or local SQL)
# AzureAd:*                            → same app registration as Teams SSO
# Graph works via app-only / MI pattern you already use on rpp-dev — mirror required keys locally
```

Checklist:

- [ ] SQL reachable from your IP (Azure SQL firewall).  
- [ ] `ApiSettings:RequireAuthentication` — for real SSO tests use **true** (or Production-like).  
  Anonymous bypass hides 401s you need to see.  
- [ ] `dotnet run` → `http://localhost:5004/health` returns 200.  
- [ ] Tunnel host running → `https://<tunnel>/health` returns 200 **in a private browser window**.

---

## 4. Every test session (short checklist)

Print and tick:

### Start order

1. [ ] SQL / secrets OK  
2. [ ] `dotnet run` in `RppWebApi` (and leave it running)  
3. [ ] Path A: fresh `wwwroot` from `npm run build` + local `runtime-config.js`  
      **or** Path B: `npm run dev`  
4. [ ] `devtunnel host rpp-local` (or your tunnel name) — note URL still matches manifest  
5. [ ] Browser: `https://<tunnel>/health` and `https://<tunnel>/` show API/SPA (not tunnel login wall)  
6. [ ] Teams: open **RPP Local** (not the Azure app) in the **test team**  
7. [ ] Info tab / footer: environment `LOCAL-TUNNEL` (or your label), revision looks local  
8. [ ] Hard refresh if UI looks stale (Teams webview cache)

### After a code change

| Change type | What to restart |
| --- | --- |
| Frontend only, Path B | Vite HMR; Teams iframe refresh |
| Frontend only, Path A | `npm run build` + copy `wwwroot`; Teams refresh |
| Backend only | restart `dotnet run`; Teams refresh |
| Manifest / Entra | re-zip sideload; rarely re-consent |

You do **not** need `az webapp deploy` on this path.

---

## 5. What each EO needs on this loop

### EO-456 — default team `Alle - …`

| Step | Check |
| --- | --- |
| Host team | Channel/tab inside an M365 team that has **no** internal RPP teams yet for that `OwningTeamId` (new team is easiest) |
| API | Local API build includes EO-456 |
| Graph | Local API can call Graph members/owners for that group |
| SQL | Writable dev DB (seed writes rows) |
| Proof | Timeline shows people under `Alle - {team display name}`; or SQL: one `TeamAdminTeams` row + assignments |

**Faster than Teams (optional):** with a user Bearer token and header:

```http
GET https://<tunnel>/api/planning/memberships
Authorization: Bearer …
X-RPP-Active-TeamId: <m365-group-id>
```

### EO-455 — host adapter

| Step | Check |
| --- | --- |
| App | **RPP Local** tab (tunnel), not browser-only |
| Host kind | Teams context present (team badge / no endless SSO timeout) |
| Demo chrome | No fake Teams rail inside real Teams |
| Deep link | Optional: entity link / hash with vacation-request id |
| Browser control | Same build opened outside Teams → browser adapter, no Teams SDK hang |

---

## 6. “I thought the tunnel was on” — decision tree

```text
devtunnel list empty?
  YES → recreate tunnel; update manifest if host name changed; re-sideload
  NO  → continue

Teams app name is still "RPP RC7" / Azure URL in manifest?
  YES → you are on Azure. Sideload RPP Local.

https://<tunnel>/health fails in browser?
  YES → API not running, wrong port, or tunnel not hosted

Tunnel shows authentication / “continue” interstitial in Teams?
  YES → host with --allow-anonymous or sign in once in browser, then retry Teams

Tab loads but 401 on /api/planning/*?
  YES → webApplicationInfo.resource vs Entra Application ID URI mismatch,
        or apiAccessTokenScopes wrong, or local AzureAd audience

Tab loads mock demo data?
  YES → runtime-config still mock; fix wwwroot/config or Vite public config

Seed does nothing on a team you already used?
  YES → internal teams already exist for that OwningTeamId (by design). Use a new team
        or delete internal teams for that host in dev DB only.
```

---

## 7. Azure path (when the tunnel is the wrong tool)

Use full deploy when you need **shared** rpp-dev, mailbox sync, or “what the org actually runs”:

```bash
npm run package:api -- --env prod
az webapp deploy --resource-group RPP-DEV --name rpp-dev --src-path ./publish/RppWebApi.zip --type zip --clean true
```

Then open the **normal** Teams app (Azure `contentUrl`), not RPP Local.

| | Tunnel loop | Azure deploy |
| --- | --- | --- |
| Latency per change | minutes | many minutes + cache risk |
| Who can open it | you (+ tunnel access) | anyone with the app |
| EO-456 alone | local API enough | API zip often enough |
| EO-455 in Teams | tunnel + local manifest | frontend on App Service |

---

## 8. Safety

- [ ] Never commit tunnel host names with secrets.  
- [ ] Prefer a **separate** sideload app id so you do not point the shared RC package at your laptop.  
- [ ] Do not set `ApiSettings:RequireAuthentication=false` on anything reachable beyond your desk.  
- [ ] Dev DB only for destructive seed experiments.  
- [ ] When finished: `Ctrl+C` on `devtunnel host` so the public endpoint goes away.

---

## 9. Quick copy-paste session (Path A)

```bash
# Terminal 1 — API
cd RppWebApi
dotnet run

# Terminal 2 — frontend into wwwroot (after code change)
cd <repo-root>
npm run build
# copy dist → RppWebApi/wwwroot and ensure runtime-config api + apiBaseUrl ""

# Terminal 3 — tunnel
devtunnel host rpp-local --allow-anonymous
```

Teams → **RPP Local** → test team → verify.

---

## Related

- [deployment.md](./deployment.md) — `package:api`, rpp-dev ZIP deploy  
- [microsoft-365-authentication.md](../architecture/microsoft-365-authentication.md) — SSO / scopes  
- [scripts/dev-setup/README.md](../../scripts/dev-setup/README.md) — local tooling  
- ADR-004 / EO-455 — host adapter  
- ADR-005 / EO-456 — default planning team seed  
