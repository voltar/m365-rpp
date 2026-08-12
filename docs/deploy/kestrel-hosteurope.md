# Deployment von ASP.NET Core (Kestrel) bei Host Europe

Diese Anleitung beschreibt ein praxiserprobtes Deployment einer ASP.NET-Core-Anwendung mit **Kestrel** auf einem Linux-Server bei Host Europe – inklusive systemd-Service, Reverse Proxy und SSL.

> Getestete Zielumgebung: Ubuntu/Debian-ähnliche Distribution mit root/sudo-Zugriff.
>
> **RPP Organisation-A / public demo:** `https://rpp.example.com` → systemd `kestrel-rpp@rpp-organisation-a`,
> app root `/var/www/vhosts/example.com/apps/rpp-organisation-a/`, PostgreSQL via
> `Planning__Provider=postgres` (EO-458). Package for this host:
>
> ```powershell
> # one-shot (SSH: deploy@YOUR_SERVER_IP)
> .\scripts\deploy-hosteurope.ps1
> .\scripts\deploy-hosteurope.ps1 -HealthCheck
> ```
>
> Manual equivalent:
>
> ```bash
> npm run package:api -- --env hosteurope
> scp -r ./publish/RppWebApi/* deploy@YOUR_SERVER_IP:/var/www/vhosts/example.com/apps/rpp-organisation-a/
> ssh deploy@YOUR_SERVER_IP "sudo systemctl restart kestrel-rpp@rpp-organisation-a"
> ```
>
> Env on the server (already typical): `Planning__Provider=postgres`,
> `ConnectionStrings__DefaultConnection=…` (Npgsql), AzureAd secrets.
> Do **not** rely on committed `appsettings.json` for provider or secrets.
>
> **Voltar edition Entra app** (parallel to Azure RC7): client id
> `00000000-0000-0000-0000-000000000003`, Application ID URI
> `api://rpp.example.com/00000000-…003`. Configure via
> [`scripts/configure-hosteurope-kestrel-env.sh`](../../scripts/configure-hosteurope-kestrel-env.sh)
> Entra SSO via `.\scripts\configure-entra-sso.ps1 -Profile example` and Graph planning
> application permissions via `.\scripts\configure-graph-planning.ps1 -Profile example`.
> See [§4.1 kestrel.env](#41-kestrelenv--example-entra-scripted).

## 1) Voraussetzungen

- SSH-Zugang zum Server
- Domain/Subdomain zeigt per DNS auf den Server
- Installiertes .NET Runtime oder SDK (passend zur App)
- Nginx oder Apache als Reverse Proxy
- Repository lokal verfügbar

## 2) App veröffentlichen (Publish)

Im Projektordner der Web-App:

```bash
dotnet restore
dotnet publish -c Release -o ./publish
```

Optional (wenn keine Runtime auf dem Server installiert werden soll):

```bash
dotnet publish -c Release -r linux-x64 --self-contained true -o ./publish
```

Die erzeugten Dateien liegen im `publish`-Ordner.

## 3) Deployment-Verzeichnis auf dem Server

Beispiel-Verzeichnis:

```bash
sudo mkdir -p /var/www/m365-rpp-teamsapp
sudo chown -R $USER:$USER /var/www/m365-rpp-teamsapp
```

Publish-Dateien hochladen (z. B. via `scp`):

```bash
scp -r ./publish/* user@SERVER_IP:/var/www/m365-rpp-teamsapp/
```

## 4) Konfiguration (Production)

### Umgebungsvariablen

Sensible Daten **nicht** in Git speichern. Stattdessen als Environment Variables setzen (systemd, siehe unten).

Typische Variablen:

- `ASPNETCORE_ENVIRONMENT=Production`
- `ASPNETCORE_URLS=http://127.0.0.1:5000`
- App-spezifische Secrets (z. B. Azure AD, API Keys, DB-Strings)

### appsettings

- `appsettings.json`: Basiswerte
- `appsettings.Production.json`: Produktionswerte ohne Secrets

### 4.1 kestrel.env — Voltar Entra (scripted)

Production on Host Europe uses a **systemd template unit** and a **per-instance env file**:

```ini
# /etc/systemd/system/kestrel-rpp@.service  (excerpt)
[Service]
WorkingDirectory=/var/www/vhosts/example.com/apps/%i
ExecStart=/usr/bin/dotnet /var/www/vhosts/example.com/apps/%i/RppWebApi.dll
EnvironmentFile=/var/www/vhosts/example.com/apps/%i/kestrel.env
Environment=ASPNETCORE_ENVIRONMENT=Production
Environment=TENANT_ID=%i
```

| Piece | Example (`rpp-organisation-a`) |
| --- | --- |
| Unit instance | `kestrel-rpp@rpp-organisation-a` |
| App root | `/var/www/vhosts/example.com/apps/rpp-organisation-a/` |
| Env file | `/var/www/vhosts/example.com/apps/rpp-organisation-a/kestrel.env` |
| Public origin | `https://rpp.example.com` |

`%i` is the instance name. **Do not** put tenant secrets in the shared `kestrel-rpp@.service` template — only in the instance `kestrel.env`.

#### Required Azure AD keys (Voltar app)

.NET maps nested config with `__`:

```bash
AzureAd__TenantId=00000000-0000-0000-0000-000000000001
AzureAd__ClientId=00000000-0000-0000-0000-000000000003
AzureAd__ClientSecret=<from Entra Certificates & secrets — the Value, never the Secret ID>
AzureAd__Audience=api://rpp.example.com/00000000-0000-0000-0000-000000000003
ApiSettings__AllowedOrigins__0=https://rpp.example.com
ApiSettings__RequireAuthentication=true
```

**Client secret: Value, not Secret ID.** Entra shows two columns when you create a client secret:

| Entra column | Use in `kestrel.env`? |
| --- | --- |
| **Secret ID** | No — administrative id only |
| **Value** | Yes → `AzureAd__ClientSecret=…` (shown only once at creation) |

Using the Secret ID produces `GetAccessTokenForAppAsync` failures (`CreateGraphClientAsync` stack in the journal). The personal-scope team picker then shows *Ihre Teams konnten nicht geladen werden* even though App Admin still works (user token vs app token).

Keep existing operational keys in the same file (do not delete them when rotating Entra):

- `ConnectionStrings__DefaultConnection=…` (Npgsql)
- `Planning__Provider=postgres`
- any other instance-specific settings

These identifiers must match:

| Layer | Value |
| --- | --- |
| Entra Application ID URI | `api://rpp.example.com/00000000-…003` |
| `AzureAd__Audience` | same URI |
| `runtime-config-HOSTEUROPE.js` → `apiAccessTokenScopes` | same URI + `/access_as_user` |
| `teams-app-package/rpp-he/manifest.json` → `webApplicationInfo.resource` | same URI |
| Entra SSO script | `.\scripts\configure-entra-sso.ps1 -Profile example` |

Use a separate Entra app registration per environment; do not share one `kestrel.env` across hosts.

#### Graph application permissions (planning / team picker)

SSO (`configure-entra-sso.ps1`) only configures the API scope `access_as_user`. The Web API also calls Microsoft Graph **app-only** (`GetAccessTokenForAppAsync` / client credentials) for:

| Permission (Application) | Needed for |
| --- | --- |
| `GroupMember.Read.All` | `GET /users/{id}/memberOf` (EO-428 personal team picker), group members/owners |
| `Group.Read.All` | Team / group display names (EO-456 `Alle - {name}`, header badge) |
| `User.Read.All` | Member `displayName` / UPN / photos, and **companyName / officeLocation** (Firma & Standort, EO-415). Without this the timeline shows **Unknown User** and organisation/location stay empty |

Delegated grants alone (`User.Read`, `ApprovalSolution.ReadWrite`) are **not** enough.  
`az ad app permission list-grants` lists **delegated** grants only; application roles appear on the service principal’s `appRoleAssignments`.

From a workstation with `az login` (app admin + consent rights):

```powershell
# Host Europe / Voltar app
.\scripts\configure-graph-planning.ps1 -Profile example

# Azure RC7 app (default profile)
.\scripts\configure-graph-planning.ps1

# Check only (exit 2 if something is missing)
.\scripts\configure-graph-planning.ps1 -Profile example -VerifyOnly
```

Optional related scripts (same `-Profile` switch):

| Script | Purpose |
| --- | --- |
| `configure-entra-sso.ps1` | Application ID URI, `access_as_user`, Teams preauth |
| `configure-graph-planning.ps1` | Graph **application** roles for planning (this section) |
| `configure-graph-approvals.ps1` | Delegated `ApprovalSolution.ReadWrite` |
| `configure-outlook-sync.ps1` / `configure-mailbox-sync.ps1` | Calendar / mailbox app permissions (**per Entra app** — Azure RC7 ≠ Voltar) |

#### Outbound Outlook calendar sync (EO-414) — `OutlookSync__Enabled`

One-way **RPP → personal calendar** of the requester (Graph app-only `Calendars.ReadWrite`).
Azure RC7 and Host Europe use **different** Entra apps; permissions on Azure do **not** cover
Voltar.

**Verified field path (Host Europe / example):**

```powershell
# 1) Entra: declare + grant Calendars.ReadWrite (application) without wiping delegated grants
[ ] configure-outlook-sync.ps1 -Profile <your-profile> (-VerifyOnly green)

# 2) Check (must show [OK] Calendars.ReadWrite; delegated should still list ApprovalSolution.ReadWrite)
[ ] configure-outlook-sync.ps1 -Profile <your-profile> (-VerifyOnly green)
```

Example successful VerifyOnly (2026-08-11):

- AppId `00000000-0000-0000-0000-000000000003`
- Granted application role: `Calendars.ReadWrite` (`ef54d2bf-783f-4e0f-bca1-3210c0444d99`)
- Delegated still includes `ApprovalSolution.ReadWrite`

**3) Exchange Application Access Policy (least privilege — mandatory before production use)**

Classic EAC `https://outlook.office365.com/ecp/` is retired. Use PowerShell:

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser   # once
Connect-ExchangeOnline

# Security group of people whose calendars RPP may write (create once)
# New-DistributionGroup -Name "RPP Kalender-Sync" -Type Security -Members user1@...,user2@...

New-ApplicationAccessPolicy `
  -AppId "00000000-0000-0000-0000-000000000003" `
  -PolicyScopeGroupId "RPP Kalender-Sync" `
  -AccessRight RestrictAccess `
  -Description "RPP darf nur Kalender der Planungsmitglieder schreiben"

Test-ApplicationAccessPolicy -AppId "00000000-0000-0000-0000-000000000003" -Identity <member@...>
Test-ApplicationAccessPolicy -AppId "00000000-0000-0000-0000-000000000003" -Identity <other@...>
```

Expect member **allowed**, control mailbox **denied** (wording is localised, e.g. German *Gewährt*).
Propagation can take up to ~1 hour.

**4) Turn the feature on in Kestrel — `OutlookSync__Enabled=true`**

.NET configuration uses double underscores for nested keys. On the server edit:

`/var/www/vhosts/example.com/apps/rpp-organisation-a/kestrel.env`

Add or set (no quotes needed for simple booleans):

```ini
# EO-414: one-way RPP → requester personal calendar (Graph app-only Calendars.ReadWrite)
OutlookSync__Enabled=true
```

Then restart so the process reloads env (env-only change does **not** need `daemon-reload`):

```bash
sudo nano /var/www/vhosts/example.com/apps/rpp-organisation-a/kestrel.env
sudo chmod 600 /var/www/vhosts/example.com/apps/rpp-organisation-a/kestrel.env
sudo systemctl restart kestrel-rpp@rpp-organisation-a
sudo systemctl is-active kestrel-rpp@rpp-organisation-a
```

Without this flag the API keeps Outlook write-back **off** even if Entra permissions exist.
Azure equivalent is an App Setting `OutlookSync__Enabled=true` on the Web App (not used on Host Europe).

**5) Product default in the UI**

Absence / vacation forms default **Outlook sync off** (`syncToOutlook: false`); the user must
opt in per request unless a future team policy forces it.

**6) Smoke test**

1. In Teams RPP: create/submit an absence with **Mit Outlook synchronisieren** enabled.
2. After approval (or according to product rules for when the calendar write runs), open the
   requester’s Outlook calendar and look for the RPP event.
3. On failure:

```bash
sudo journalctl -u kestrel-rpp@rpp-organisation-a -n 100 --no-pager | grep -iE 'Outlook|Calendar|403|Graph'
```

#### Inbound mailbox sync (EO-424 beta) on Host Europe

Separate from EO-414. Needs **application** `Mail.ReadWrite` + AAP on the **shared absence
mailbox** for the **same Voltar app**. Azure’s mailbox grant does not apply here.

```powershell
.\scripts\configure-mailbox-sync.ps1 -Profile example `
  -MailboxAddress "absence@your-domain.ch" `
  -ControlMailbox "someone-else@your-domain.ch"
```

On the server (`kestrel.env`):

```ini
MailboxSync__Enabled=true
MailboxSync__MailboxAddress=absence@your-domain.ch
```

Then `sudo systemctl restart kestrel-rpp@rpp-organisation-a`.
See [deployment.md — Application Permissions](./deployment.md#microsoft-365-application-permissions--access-policy-is-mandatory).

After granting `User.Read.All` or rotating the client secret, restart Kestrel so the in-process Graph member cache (≈5 min) is cleared:

```bash
sudo systemctl restart kestrel-rpp@rpp-organisation-a
```

Then reload the RPP tab in Teams (right-click tab → Reload, or close and reopen the tab).

##### Symptom → cause (field checklist)

| Symptom | Typical cause |
| --- | --- |
| App Admin visible; planning *Kein Team ausgewählt* + *Teams konnten nicht geladen werden* | Graph app token or `memberOf` failing (bad secret Value, or missing `GroupMember.Read.All`) |
| Journal: fail at `CreateGraphClientAsync` / `GetAccessTokenForAppAsync` | Wrong `AzureAd__ClientSecret` (Secret ID instead of Value), expired secret, or ClientId/Tenant mismatch |
| Journal: `ODataError` on `MemberOfRequestBuilder.GetAsync` | App token OK; missing **application** `GroupMember.Read.All` + admin consent |
| Timeline people show **Unknown User** | Missing **application** `User.Read.All` + consent; restart API after grant |
| Firma / Standort empty on person card and reports | Same `User.Read.All` gap, or empty `company` / `office location` on the Entra user profile; after grant restart API (5 min member cache) |
| Team Admin tab hidden | Needs owner of the *active* M365 team; no team context ⇒ tab stays hidden (by design) |
| Absence / vacation save HTTP 500 on Host Europe | Postgres + `DateTimeKind.Unspecified` from JSON; fixed by UTC normalize + `Npgsql.EnableLegacyTimestampBehavior` — redeploy if still on old build |
| `approvalFlowStartFailed` | Graph approval create/OBO failed, or relative `Location` URL not expanded; check journal for `ApprovalSolution` / `AADSTS65001` / Graph HTTP body |
| RPP “Verknüpft” but nothing in Teams Approvals **Erhalten** | Graph item exists (`state=pending`); **approver Entra object id ≠ account used in Approvals**. Multi-account setups (guest vs home tenant) are the usual cause. Open Approvals as the approver account, or set Team Admin default approver to the account users actually use |
| Outlook calendar write never runs | Missing `OutlookSync__Enabled=true` in `kestrel.env`, or AAP/permission only on Azure app, or UI left sync off (default is off) |
| `outlook.office365.com/ecp` dead | Classic EAC retired → https://admin.exchange.microsoft.com + PowerShell for Application Access Policies |

Quick log filter on the server:

```bash
sudo journalctl -u kestrel-rpp@rpp-organisation-a -n 150 --no-pager \
  | grep -iE 'my-teams|Could not resolve Microsoft 365 teams|GetAccessTokenForApp|OData|Resolved .+ teams|Unknown User|Graph'
```

#### Script: `configure-hosteurope-kestrel-env.sh`

Repo path: [`scripts/configure-hosteurope-kestrel-env.sh`](../../scripts/configure-hosteurope-kestrel-env.sh).

Runs **on the server** (SSH). Merges the Azure AD / CORS keys into the existing `kestrel.env` (connection string preserved), writes a timestamped `.bak.*`, sets mode `600`, optionally restarts the unit and verifies HTTP.

```bash
# Copy script once (from a machine that has the repo), then SSH:
scp scripts/configure-hosteurope-kestrel-env.sh user@host:/tmp/
ssh user@host

sudo bash /tmp/configure-hosteurope-kestrel-env.sh --instance rpp-organisation-a --show

# Apply Voltar Entra settings (secret via prompt — not shell history):
sudo bash /tmp/configure-hosteurope-kestrel-env.sh \
  --instance rpp-organisation-a \
  --prompt-secret \
  --restart \
  --verify

# Or non-interactive (CI / controlled shell):
sudo RPP_CLIENT_SECRET='…' bash /tmp/configure-hosteurope-kestrel-env.sh \
  --instance rpp-organisation-a --restart --verify

# Dry-run (no write):
sudo bash /tmp/configure-hosteurope-kestrel-env.sh \
  --instance rpp-organisation-a --client-secret '…' --dry-run
```

Defaults match `scripts/rpp-config-example.psd1` (`--client-id`, `--api-domain`, tenant). Override with flags if a future instance differs.

#### Manual edit (same file)

```bash
sudo nano /var/www/vhosts/example.com/apps/rpp-organisation-a/kestrel.env
sudo chmod 600 /var/www/vhosts/example.com/apps/rpp-organisation-a/kestrel.env
sudo systemctl restart kestrel-rpp@rpp-organisation-a
# daemon-reload only if you changed the .service unit, not for env-only edits
```

#### Verify

```bash
curl -sS https://rpp.example.com/health
# expect 200 + "healthy"

curl -sS -o /dev/null -w "%{http_code}\n" https://rpp.example.com/api/planning/absences
# expect 401 (auth required — correct)

sudo journalctl -u kestrel-rpp@rpp-organisation-a -n 80 --no-pager
```

#### Deploy without wiping secrets

`kestrel.env` lives **inside** the app root. A naive `scp -r ./publish/RppWebApi/* …/rpp-organisation-a/` does not remove it, but a full directory sync/`rsync --delete` can. Prefer:

```bash
# keep env across deploys (or: .\scripts\deploy-hosteurope.ps1)
scp -r ./publish/RppWebApi/* deploy@YOUR_SERVER_IP:/var/www/vhosts/example.com/apps/rpp-organisation-a/
# never publish a kestrel.env from the build machine
ssh deploy@YOUR_SERVER_IP 'sudo systemctl restart kestrel-rpp@rpp-organisation-a'
```

After Entra app rotation, re-run the env script (or edit keys) **before** relying on Teams SSO against the new audience.

#### Browser without Teams SSO (mock demo)

Opening `https://rpp.example.com` outside Teams does **not** mint API tokens (no MSAL in the browser host). The Host Europe runtime config therefore sets `standaloneBrowserUsesMock: true`:

- **Plain browser** → mock/demo product (no login required)
- **Microsoft Teams** tab → real `api` + `m365` providers via Teams SSO

That is resolved at session start from host detection (EO-455); one packaged artefact serves both. Details:
[deployment.md — Standalone browser mock demo](./deployment.md#standalone-browser-mock-demo-same-artefact-as-teams).

If you need mock on a host **without** that flag, the developer console local override still works:
[deployment.md — Local mock override without App Admin](./deployment.md#local-mock-override-without-app-admin-developer-console).

Productive API use remains the **Teams** package (`rpp-he` / RPP BetaV2).

## 5) systemd Service für Kestrel

Datei erstellen:

```bash
sudo nano /etc/systemd/system/m365-rpp-teamsapp.service
```

Inhalt:

```ini
[Unit]
Description=M365 RPP TeamsApp (ASP.NET Core Kestrel)
After=network.target

[Service]
WorkingDirectory=/var/www/m365-rpp-teamsapp
ExecStart=/usr/bin/dotnet /var/www/m365-rpp-teamsapp/M365-RPP-TeamsApp.dll
Restart=always
RestartSec=10
KillSignal=SIGINT
SyslogIdentifier=m365-rpp-teamsapp
User=www-data
Environment=ASPNETCORE_ENVIRONMENT=Production
Environment=ASPNETCORE_URLS=http://127.0.0.1:5000
# Beispiel für weitere Variablen:
# Environment=AzureAd__ClientId=...
# Environment=ConnectionStrings__DefaultConnection=...

[Install]
WantedBy=multi-user.target
```

> Falls `ExecStart`/DLL-Name abweicht, entsprechend anpassen.

Service aktivieren:

```bash
sudo systemctl daemon-reload
sudo systemctl enable m365-rpp-teamsapp
sudo systemctl start m365-rpp-teamsapp
sudo systemctl status m365-rpp-teamsapp
```

Logs anzeigen:

```bash
journalctl -u m365-rpp-teamsapp -f
```

## 6) Reverse Proxy mit Nginx (empfohlen)

Nginx-Config erstellen:

```bash
sudo nano /etc/nginx/sites-available/m365-rpp-teamsapp
```

Inhalt:

```nginx
server {
    listen 80;
    server_name your-domain.tld www.your-domain.tld;

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection keep-alive;
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Aktivieren und testen:

```bash
sudo ln -s /etc/nginx/sites-available/m365-rpp-teamsapp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 7) HTTPS mit Let's Encrypt

Certbot installieren und Zertifikat erstellen:

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.tld -d www.your-domain.tld
```

Automatische Verlängerung testen:

```bash
sudo certbot renew --dry-run
```

## 8) Wichtige ASP.NET Core Hinweise

Wenn Forwarded Headers genutzt werden (Reverse Proxy), in `Program.cs` korrekt aktivieren:

```csharp
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});

var app = builder.Build();

app.UseForwardedHeaders();

app.Run();
```

## 9) Update-Deployment (Rolling Replace)

1. Neue Version publishen
2. Dateien hochladen
3. Service neu starten

```bash
sudo systemctl restart m365-rpp-teamsapp
sudo systemctl status m365-rpp-teamsapp
```

Optional mit kurzer Downtime minimieren:
- Upload in neues Verzeichnis (`/var/www/m365-rpp-teamsapp/releases/<timestamp>`)
- Symlink `current` umschalten
- Service mit `WorkingDirectory=/var/www/m365-rpp-teamsapp/current`

## 10) Troubleshooting

### App startet nicht
- `journalctl -u m365-rpp-teamsapp -f`
- DLL-Name, Pfade, Berechtigungen prüfen
- Installierte Runtime-Version prüfen:

```bash
dotnet --info
```

### 502 Bad Gateway in Nginx
- Läuft Kestrel lokal?

```bash
curl -I http://127.0.0.1:5000
```

- Stimmen Port und `proxy_pass`?
- `systemctl status nginx` und `nginx -t` prüfen

### Zertifikat-Probleme
- DNS korrekt auf Server-IP?
- Port 80/443 offen?
- `certbot renew --dry-run` ausführen

## 11) Sicherheitsempfehlungen

- SSH nur mit Key-Auth, Passwortlogin deaktivieren
- UFW/Firewall: nur 22, 80, 443 erlauben
- Regelmäßige Security-Updates
- Secrets nur über Environment Variables / Secret Store
- Backups für Konfiguration und Datenbank

---

## Quick Checklist

- [ ] `dotnet publish` / `npm run package:api -- --env hosteurope` / `.\scripts\deploy-hosteurope.ps1` erfolgreich
- [ ] Dateien nach `/var/www/vhosts/example.com/apps/rpp-organisation-a/` (oder Instance-Pfad) kopiert; **kein** `kestrel.env` aus dem Build überschreiben
- [ ] `kestrel.env` vorhanden; `AzureAd__*` auf Voltar-App; Secret nicht im Git
- [ ] `AzureAd__ClientSecret` = Entra secret **Value** (nicht Secret ID)
- [ ] `.\scripts\configure-entra-sso.ps1 -Profile example` (SSO / `access_as_user`)
- [ ] `.\scripts\configure-graph-planning.ps1 -Profile example` (Graph App-Rollen + Consent)
- [ ] `configure-graph-planning.ps1 -Profile example -VerifyOnly` → alle drei Rollen OK
- [ ] `.\scripts\configure-graph-approvals.ps1 -Profile example` (delegated `ApprovalSolution.ReadWrite`)
[ ] configure-outlook-sync.ps1 -Profile <your-profile> (-VerifyOnly green)
- [ ] Outlook AAP: `New-ApplicationAccessPolicy` for AppId `00000000-…003` + `Test-ApplicationAccessPolicy` member vs control
- [ ] **`OutlookSync__Enabled=true`** in `kestrel.env` (Host Europe) — without this, calendar write-back stays off
- [ ] Optional mailbox inbound (EO-424): `configure-mailbox-sync.ps1 -Profile example` + `MailboxSync__Enabled=true` + mailbox address
- [ ] Nach Permission-/Secret-/env-Änderung: `systemctl restart kestrel-rpp@rpp-organisation-a`
- [ ] `kestrel-rpp@rpp-organisation-a` läuft (`systemctl status`)
- [ ] Nginx Reverse Proxy aktiv
- [ ] HTTPS-Zertifikat aktiv
- [ ] `/health` → 200; anonymous `/api/planning/*` → 401
- [ ] Teams package `rpp-he` + runtime scopes match `AzureAd__Audience`
- [ ] In Teams: persönlicher Tab zeigt Team-Picker oder Plan; keine „Unknown User“-Zeilen
- [ ] Genehmigungen: Default-Genehmiger = Konto, mit dem User Approvals öffnen (Organisation-A vs example OIDs)

---

## Field notes — session 2026-08-11 (Host Europe / example)

Operational summary of work done against `rpp.example.com` / `kestrel-rpp@rpp-organisation-a` /
Entra app `00000000-0000-0000-0000-000000000003`. Details live in code + `CHANGELOG.md`;
this section is the ops memory.

### Deploy

| Item | Value |
| --- | --- |
| Script | `scripts/deploy-hosteurope.ps1` (default SSH `deploy@YOUR_SERVER_IP`) |
| Package | `npm run package:api -- --env hosteurope` → `publish/RppWebApi/` |
| App root | `/var/www/vhosts/example.com/apps/rpp-organisation-a/` |
| Restart | `sudo systemctl restart kestrel-rpp@rpp-organisation-a` |
| Logs | `sudo journalctl -u kestrel-rpp@rpp-organisation-a -n 150 --no-pager` |
| SSH | Prefer key auth + `~/.ssh/config` Host alias; do not commit secrets |

### Code / product fixes landed (high level)

1. **Firma / Standort from Graph** — enrich `companyName` / `officeLocation` via `/users/{id}` when group members omit them; frontend maps `location`.
2. **Postgres writes** — JSON dates are `DateTimeKind.Unspecified`; Npgsql rejected them (HTTP 500 on absence + vacation draft). Normalize to UTC + `Npgsql.EnableLegacyTimestampBehavior` for postgres.
3. **Approvals submit** — member-readable `GET /api/planning/approval-options`; default approver fallback (effective → team default → lead → first owner); seed first owner on EO-456 default team.
4. **Meine Anträge empty** — list filter now matches host id, internal team ids, and legacy team **names**; submit stores host/internal team id; approval client sends `X-RPP-Active-TeamId`.
5. **`approvalFlowStartFailed`** — expand relative Graph `Location` URLs to `https://graph.microsoft.com/...`; better OBO logging; GUID check on approver id.
6. **Approvals UI diagnostics** — columns Genehmiger, M365 Verknüpft + short Graph id; journal logs `state` + approver OID on sync.
7. **UX** — Outlook sync toggle default **off**; Team capacity label DE **Abdeckung** / EN **Coverage**.
8. **Vite** — remove separate `react` manual chunk (circular `vendor ↔ react` warning).

### Graph Approvals — dual identity (field diagnosis)

RPP can show **Wartet auf Genehmigung** + **Verknüpft** while Teams Approvals **Erhalten** looks empty.

Typical cause: the Graph approval is pending for **approver Entra object id A**, while the user
looking at Teams Approvals is signed in as **object id B** (for example a guest account vs a home
tenant account).

| Action | Where |
| --- | --- |
| Approve existing items | Sign in to Teams as the **approver** account → Approvals → **Erhalten** |
| Prefer one login going forward | Team Admin → set default approver to the account people actually use |
| As requester only | Approvals → **Gesendet** |
| Email inbox | Unreliable for Graph Approvals / guests — not the primary channel |

Useful log filter after **Status aktualisieren**:

```bash
sudo journalctl -u kestrel-rpp@rpp-organisation-a --since "today" --no-pager \
  | grep -iE 'Graph approval|Creating Graph approval|approvalFlow'
```

Do **not** paste example log lines with parentheses into bash (syntax error). Use `grep` only.

Graph Explorer (not raw browser address bar):  
https://developer.microsoft.com/en-us/graph/graph-explorer  
→ Sign in →  
`GET https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName`

### Outlook calendar sync enablement (checklist recap)

```text
[ ] configure-outlook-sync.ps1 -Profile <your-profile> (-VerifyOnly green)
[ ] Exchange Application Access Policy for your Entra app id (member allowed, control denied)
[ ] kestrel.env contains:  OutlookSync__Enabled=true
[ ] sudo systemctl restart kestrel-rpp@rpp-organisation-a
[ ] UI: enable “Mit Outlook synchronisieren” on a test absence (default is off)
[ ] Confirm event in requester calendar; journal on failure
```

**Meaning of `OutlookSync__Enabled=true`:** process-level feature flag read at runtime from
environment / `kestrel.env`. It does **not** replace Entra permissions or the AAP. It only
allows the API to attempt calendar writes when the product path asks for sync. If the flag is
missing or `false`, calendar write-back stays disabled regardless of Graph grants.

