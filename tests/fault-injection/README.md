# Fault-Injection-Harness

Werkzeuge zum Auslösen der Szenarien aus `docs/resilience/fault-injection-testplan.md`.
Alles hier ist **Testartefakt**: Kein Produktivcode wird verändert, nichts davon wird gebündelt,
nichts davon läuft in einem Deployment. Die App erreicht den Proxy ausschließlich über die
Runtime-Konfiguration, die dafür ohnehin vorgesehen ist (ADR-003).

```
tests/fault-injection/
  fault-proxy.mjs            HTTP-Proxy SPA -> RPP Web API mit Fehlerinjektion (keine Abhängigkeiten)
  scenarios.json             Szenariendefinitionen, verweisen auf die FI-IDs des Testplans
  browser/fault-injector.js  Konsolen-Snippet für Graph- und Teams-SDK-Pfade
```

## 1. Proxy starten

```bash
node tests/fault-injection/fault-proxy.mjs --list
node tests/fault-injection/fault-proxy.mjs --target http://localhost:5004 --scenario passthrough
```

Standard: Port `5099`, Ziel `http://localhost:5004` (`cd RppWebApi && dotnet run`).

Szenario im laufenden Betrieb wechseln — ohne Neustart, ohne Neuladen des Proxys:

```bash
curl -X POST localhost:5099/__fi/scenario -d '{"scenario":"throttle-retry-after"}'
curl localhost:5099/__fi/state     # aktives Szenario + die letzten 50 injizierten Antworten
curl -X POST localhost:5099/__fi/reset
```

## 2. SPA auf den Proxy zeigen

In der Konsole des laufenden Tabs (`npm run dev`, http://localhost:5173):

```js
localStorage.setItem("resourcePresencePlanner.runtimeConfig.override", JSON.stringify({
  version: 1,
  value: { planningDataSource: "api", apiBaseUrl: "http://localhost:5099" }
}));
location.reload();
```

`http://localhost:...` ist als API-Basis-URL zulässig (`runtimeConfig.ts:334`), `https` sonst
Pflicht. Aufräumen danach:

```js
localStorage.removeItem("resourcePresencePlanner.runtimeConfig.override");
```

Den `version`-Wert bitte gegen `localOverrideStorageVersion` in
`src/infrastructure/deployment/runtimeConfig.ts` prüfen — bei Abweichung wird das Override
kommentarlos verworfen und der Testlauf misst nichts.

## 3. FI-01 auslösen (stiller Mock-Fallback)

FI-01 braucht keinen Proxy, sondern eine ungültige Konfiguration:

```js
localStorage.setItem("resourcePresencePlanner.runtimeConfig.override", JSON.stringify({
  version: 1,
  value: { planningDataSource: "api", apiBaseUrl: "http://api.invalid" }   // kein https, kein localhost
}));
location.reload();
```

`validateApiBaseUrl` verwirft den Wert, `createDefaultPlanningRepositories` fällt auf das
Mock-Repository zurück. Zu protokollieren ist genau eines: **woran** ein Nutzer erkennen könnte, dass
die angezeigten Personen erfunden sind. Denselben Effekt erzeugt in einer echten Umgebung ein
fehlgeschlagener Abruf von `/config/runtime-config.js`.

## 4. Graph- und Teams-SDK-Pfade

Graph-Aufrufe des Browsers gehen an eine fest verdrahtete Basis-URL mit Origin-Allowlist und lassen
sich nicht umlenken. Dafür `browser/fault-injector.js` in die Konsole einfügen:

```js
__fi.graph({ status: 429, retryAfter: 5, skipFirst: 1 });   // FI-02
__fi.graph({ status: 401, skipFirst: 2 });                  // FI-10
__fi.graph({ body: {} });                                   // FI-13
__fi.stallTeamsContext(30000);                              // FI-07
__fi.report();
__fi.off();
```

Relevant ist der Injektor nur bei `planningMembershipSource=graph` **und**
`planningDataSource != "api"` — sonst liefert die API die Mitgliedschaften serverseitig
(`defaultPlanningRepositories.ts:33`).

Für Playwright: dieselbe Datei über `page.addInitScript({ path: ... })` einspielen, dann greift sie
schon beim ersten Bootstrap statt erst nach dem Laden.

## 5. Backend-seitige Fehler (L3–L5)

**SQL weg, während die API läuft (FI-26):**

```bash
docker compose -f docker-compose.api.yml up -d
docker stop <sql-container>
curl -s localhost:5004/api/health        # erwartet heute weiterhin: "healthy"
curl -s localhost:5004/api/planning/absences
```

**SQL weg beim Start (FI-25):**

```bash
docker stop <sql-container>
docker compose -f docker-compose.api.yml restart rpp-webapi
docker logs -f rpp-webapi                # Program.cs:212 Database.Migrate()
docker inspect -f '{{.RestartCount}}' rpp-webapi
```

Zu protokollieren: Startet der Prozess neu? Wird die SPA weiterhin ausgeliefert? Antwortet `/health`?

**Callback-Idempotenz (FI-18, FI-19):** einen Antrag auf `pendingApproval` bringen, dann

```bash
SECRET='<ApprovalFlow:CallbackSecret>'
BODY='{"requestId":"<id>","approvalReferenceId":"<ref>","decision":"approved","decisionBy":"tester","decisionDate":"2026-07-31T10:00:00Z"}'

curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:5004/api/approvals/callback \
  -H "X-RPP-Approval-Secret: $SECRET" -H 'Content-Type: application/json' -d "$BODY"

# exakt dieselbe Anfrage erneut - so verhält sich jeder Flow-Retry
curl -s -i -X POST localhost:5004/api/approvals/callback \
  -H "X-RPP-Approval-Secret: $SECRET" -H 'Content-Type: application/json' -d "$BODY"

# Abbruch mitten im Aufruf (FI-18)
curl --max-time 1 -X POST localhost:5004/api/approvals/callback \
  -H "X-RPP-Approval-Secret: $SECRET" -H 'Content-Type: application/json' -d "$BODY"
```

Danach prüfen: Status des Antrags in der DB, `OutlookSyncStatus`, `OutlookGraphEventId` und ob im
Zielkalender ein Termin liegt, den RPP nicht kennt.

**Graph aus Sicht der API (FI-20, FI-21, FI-22, FI-23):** braucht einen Testtenant. Sauberste Wege
ohne Codeänderung: die App-Berechtigung im Tenant entziehen (erzeugt 403), oder ausgehenden Verkehr
zu `graph.microsoft.com` im Container blockieren bzw. per DNS auf einen langsamen Endpunkt umbiegen.
Ein TLS-abfangender Proxy ist möglich, aber hier bewusst nicht empfohlen — der Aufwand für ein
vertrautes CA-Zertifikat im Container übersteigt den Erkenntnisgewinn gegenüber der Blockade.

## 6. Protokollieren

Pro Szenario die Vorlage aus `docs/resilience/fault-injection-testplan.md` ausfüllen. Wichtig sind
drei Dinge, in dieser Reihenfolge: **was der Nutzer sieht**, was im Netzwerk-Tab steht, was im Log
steht. Der Testplan sagt vorher, was passieren wird — Abweichungen davon sind das eigentliche
Ergebnis des Laufs.
