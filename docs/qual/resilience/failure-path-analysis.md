# Fehlerpfad-Analyse

Für jeden kritischen Nutzerpfad: die Aufrufkette, die Punkte, an denen ein Fehler entstehen kann,
und **was der Code an dieser Stelle tatsächlich tut** — belegt mit `datei:zeile`. Kommentare im Code
wurden bewusst nicht als Beleg akzeptiert; wo Kommentar/Dokumentation und Verhalten auseinandergehen,
steht das unter „Behauptung vs. Code“.

---

## Pfad P1 — Tab öffnen, Timeline laden

```
index.html:70  <script src="/config/runtime-config.js">        ← FP-01
  → runtimeConfig.ts:getRuntimeConfiguration()
  → defaultPlanningRepositories.ts:9  Provider-Auswahl          ← FP-01
  → Timeline.tsx:151  bootstrapPlanningState()
      → planningBootstrapService.ts:133  Cache/Dedup
      → planningDataService.ts:67  resolveActiveTeamId()        ← FP-02
      → planningDataService.ts:69  Promise.all([7 Loader])      ← FP-03
          → listAllPages()  do/while über nextPageToken         ← FP-04
              → apiPlanningRepositories.ts:35 fetchJson()       ← FP-05, FP-06
                  → resolveActiveTeamId()  (pro Request!)       ← FP-02
                  → getApiToken() → cachedAuthProvider          ← FP-07
              → oder graphTeamMembershipProvider.ts:74          ← FP-05, FP-12
      → requireRepositoryValue(settings)                        ← FP-03
  → PlanningBootstrapStatus.tsx  rendert loading/empty/error
```

### FP-01 — Ausfall der Runtime-Config führt zu **erfundenen Daten** (Schweregrad: kritisch)

`index.html:70` lädt `/config/runtime-config.js` als klassisches `<script>` ohne `onerror`. Schlägt
das fehl (404 nach Deployment, CDN-/App-Service-Aussetzer, kaputter Cache), bleibt
`window.__RESOURCE_PRESENCE_PLANNER_CONFIG__` undefiniert. `runtimeConfig.ts` fällt dann still über
`build` auf `default` zurück, `apiBaseUrl` wird `undefined`, und:

```ts
// defaultPlanningRepositories.ts:14
let repositories: PlanningRepositories = createMockPlanningRepositories();
if (planningDataSource === "api" && runtimeConfiguration.apiBaseUrl) { ... }
```

Ohne gültige `apiBaseUrl` bleibt es beim **Mock-Repository**. Der Nutzer sieht eine vollständig
gefüllte Timeline mit erfundenen Personen und Abwesenheiten — kein Banner, kein Log-Hinweis in der UI,
keine Statusabweichung. Das ist die schlimmste Fehlerklasse in diesem Repo: eine Infrastrukturstörung,
die als **plausible Falschdaten** erscheint. Genau dieselbe Lücke besteht, wenn `apiBaseUrl` gesetzt,
aber ungültig ist (`validateApiBaseUrl`, `runtimeConfig.ts:328` gibt `undefined` zurück — nur
`https:` oder `http://localhost` sind erlaubt; ein `http://`-Host in einer Testumgebung fällt damit
lautlos auf Mock).

Test: FI-01.

### FP-02 — Teams-Kontext wird pro Request neu aufgelöst (Schweregrad: hoch, Latenz-Verstärker)

`apiPlanningRepositories.ts:39` ruft in **jedem** `fetchJson` `resolveActiveTeamId()`. Das erzeugt
jedes Mal einen neuen `TeamsSsoAuthProvider` (`currentUser.ts:48`), der `initializeTeamsApp()`
(Timeout 5 s, `teamsSsoAuthProvider.ts:91`) und `getContext()` (Timeout 5 s, Zeile 95) ausführt. Es
gibt keinerlei Caching des Kontexts.

Ein Bootstrap startet 7 parallele Loader (`planningDataService.ts:69`), jeder mit mindestens einer
Seite: mindestens 8 Kontextauflösungen, bei mehrseitigen Listen entsprechend mehr. Antwortet der
Teams-Host langsam oder gar nicht, addieren sich pro Request bis zu 10 s **vor** dem eigentlichen
`fetch`. Der Ladezustand endet, aber sehr spät — und `Promise.all` wartet auf den langsamsten.

Test: FI-07.

### FP-03 — `Promise.all` + eine Ausnahme vom Fehlerkonzept (Schweregrad: kritisch)

```ts
// planningDataService.ts:69
const [memberships, absences, ...] = await Promise.all([...]);   // kein allSettled
// planningDataService.ts:82
const planningSettings = mergeTeamPlanningConfigurations(requireRepositoryValue(settings), ...);
```

Zwei getrennte Probleme:

1. **`Promise.all`**: die erste Ablehnung gewinnt, alle bereits erfolgreich geladenen Ergebnisse der
   anderen sechs Loader werden verworfen. Ein 500er auf `/absences` löscht die bereits gelesenen
   Mitgliedschaften mit.
2. **`requireRepositoryValue`** (`planningDataService.ts:176`) wirft einen **generischen `Error`** —
   nicht `PlanningUnavailableError`. In `planningBootstrapService.ts:113` landet der im
   „unerwartet"-Zweig und wird zu:

```ts
// planningBootstrapService.ts:121
return { status: "empty", snapshot: { resources: [], ... } };
```

Ein HTTP 500 auf `/api/planning/settings` erzeugt also exakt den Zustand, den EO-428 laut den
Kommentaren in `listAllPages` beseitigen sollte: „keine planbaren Personen gefunden“ statt eines
Fehlerbanners mit Korrelations-ID. Der Fix wurde in `listAllPages` eingebaut, aber der
`settings`-Zweig geht daran vorbei.

Test: FI-05, FI-06.

### FP-04 — Paging: unbegrenzt, ohne Zyklus-Schutz, ohne Teilergebnis-Signal (Schweregrad: hoch)

```ts
// planningDataService.ts:121
do {
  const result = await loadPage({ pageToken, pageSize: 100 });
  ...
  pageToken = page.nextPageToken;
} while (pageToken);
```

- **Kein Seitenlimit und kein Duplikat-Erkennen des Tokens.** Liefert ein Server (oder ein Proxy im
  Fehlerfall) denselben `nextPageToken` erneut, läuft die Schleife endlos und der Tab hängt im
  Ladezustand — ohne Timeout, weil auch `fetch` keinen hat (FP-05). Das Backend hat für denselben
  Fall bewusst eine Bremse (`GraphTeamMembershipService.cs:374`, `guard < 100`); im Frontend fehlt sie.
- **Teildaten bleiben liegen, ohne dass es jemand erfährt.** Bricht Seite 3 von 5 ab, gibt
  `listAllPages` die ersten beiden Seiten zurück (Zeile 149/150: `console.warn` + `break`). Der
  Aufrufer erhält ein `ready`-Snapshot und `capacityEngine` rechnet Auslastung auf einem
  abgeschnittenen Datensatz — als wäre er vollständig. Es gibt kein `partial`-Flag im
  `PlanningDataSnapshot` und keinen Zustand dafür in `PlanningBootstrapState`.
- Die beiden `console.warn` (Zeile 149, 170) verletzen zusätzlich die Logging-Regel aus `CLAUDE.md`
  (nur `Logger.ts` darf `console` anfassen) — die Warnung erscheint damit auch nicht im
  Monitoring-Puffer (`monitoringService.ts:18`).

Test: FI-04, FI-13.

### FP-05 — Kein Timeout auf `fetch`, weder API noch Graph noch SharePoint (Schweregrad: hoch)

`apiPlanningRepositories.ts:51`, `graphClient.ts:66`, `sharePointClient.ts:87` und
`userPhotoService.ts:32` rufen `fetch` ohne `AbortController`/`signal`. Ein hängender TCP-Strom
(Verbindungsabbruch ohne RST, Load-Balancer-Blackhole, Teams-Webview im Hintergrund) blockiert die
Promise unbegrenzt. Da `bootstrapPlanningState` darauf wartet, bleibt die Timeline dauerhaft im
Zustand `loading` — ohne Fehler, ohne Retry-Button (der Button steckt in
`PlanningBootstrapStatus.tsx` erst hinter den Endzuständen).

Die einzigen zwei Stellen mit Timeout sind `powerAutomateApprovalIntegrationRepository.ts:42` (30 s)
und `appConfigService.ts:77` (Health-Probe). Beide sind vorbildlich — das Muster ist im Repo
vorhanden, nur nicht auf den Kernpfaden angewandt.

Test: FI-03.

### FP-06 — 429 wird als nicht behebbar klassifiziert, `Retry-After` wird ignoriert (Schweregrad: kritisch)

```ts
// graphClient.ts:80
code: response.status === 404 ? "notFound" : response.status === 403 ? "forbidden" : "unknown",
recoverable: response.status >= 500
```

```ts
// apiPlanningRepositories.ts:79
recoverable: response.status >= 500 || response.status === 404 || errorCode === "noTeamContext"
```

Für **429 Too Many Requests** heißt das: `code: "unknown"`, `recoverable: false`. Der Header
`Retry-After` wird nirgends gelesen; es gibt kein Backoff, keinen Jitter und keinen Retry. Kein
Retry-Sturm also — aber der entgegengesetzte Fehler: eine per Definition vorübergehende Drosselung
wird als dauerhafter Fehler behandelt. Praktische Folge im Bootstrap: Seite 1 lädt, Seite 2 bekommt
429 → `listAllPages` bricht ab → Teildaten (FP-04) oder, bei 429 auf der ersten Seite,
`PlanningUnavailableError` → Fehlerbanner. Der Nutzer kann nur manuell neu laden — und läuft dabei in
dasselbe Rate-Limit, weil kein Wartefenster respektiert wird.

**503/504** werden zwar `recoverable: true` markiert, aber `recoverable` wird von niemandem
ausgewertet, der daraufhin wiederholen würde (Suche: keine Konsumenten außer der Anzeige).

Einzige Ausnahme im gesamten Repo: das Backend nutzt für Mitgliedschaften den Graph-SDK-Client
(`GraphTeamMembershipService.cs:228`, `new GraphServiceClient(...)`) und erbt damit die
Kiota-Default-Middleware inklusive `RetryHandler`, der `Retry-After` respektiert. Alle direkten
`HttpClient`-Aufrufe gegen Graph (Kalender, Mail, Approvals, Fotos) tun das **nicht**.

Test: FI-02, FI-08, FI-09.

### FP-07 — Token: Refresh nur über TTL, kein Invalidieren bei 401 (Schweregrad: mittel–hoch)

`cachedAuthProvider.ts:59` bestimmt die Cache-Dauer aus `token.expiresOn`. Der Teams-SSO-Provider
liefert **kein** `expiresOn` (`teamsSsoAuthProvider.ts:77` gibt nur `{ token }` zurück), also gilt
`defaultTokenTtlMs` = 5 Minuten. Das ist der eigentliche Refresh-Mechanismus: nach fünf Minuten wird
neu geholt.

Was fehlt: bei einem **401** von Graph oder API wird der Cache nicht geleert. `clear()` existiert
(`cachedAuthProvider.ts:50`), wird aber **nirgends aufgerufen** (verifiziert per Suche). Ein
widerrufener Consent, ein deaktivierter Nutzer oder eine Conditional-Access-Änderung erzeugt
folglich bis zu 5 Minuten lang 401-Antworten mit demselben toten Token; die UI zeigt in dieser Zeit
`accessDenied`/`unknown`, ohne je einen Refresh zu versuchen. Umgekehrt wird ein 401 im Graph-Client
nicht einmal als solcher erkannt (`graphClient.ts:80`: 401 → `"unknown"`, `recoverable: false`).

MFA-/Consent-Prompt im iframe: `getAuthToken` läuft im Teams-Host; scheitert es, greift der
10-s-Timeout (`teamsSsoAuthProvider.ts:71`) und es wird `forbidden, recoverable: true` gemeldet. Es
gibt **kein** `authentication.authenticate()`-Popup als Fallback im Code — ein
Consent-Nachfordern ist im Produkt nicht implementiert. Der Nutzer sieht `accessDenied` mit dem Text
„Consent akzeptieren“ (`PlanningBootstrapStatus.tsx:51`), hat aber keinen Weg dorthin.

Test: FI-10, FI-11, FI-12.

### FP-12 — Unerwartetes Schema wird zu „leerer Plan“ (Schweregrad: hoch)

`graphTeamMembershipProvider.ts:90` greift ohne Prüfung auf `graphResult.value.value` zu. Antwortet
Graph mit `200 OK` und einem Körper ohne `value` (Proxy-Fehlerseite, abgeschnittene Antwort, geänderte
Form), wirft `.filter` einen `TypeError`. Dieser wird nicht lokal gefangen, sondern erst in
`listAllPages` (`planningDataService.ts:159`) — und dort als „unerwartet“ zu Teilergebnissen
degradiert, also zu einer leeren Liste. Ergebnis: `status: "empty"`, Anzeige „keine planbaren
Personen“.

Gleiches Muster im API-Pfad: `apiPlanningRepositories.ts:88` (`await response.json()`) wirft bei
leerem Körper oder HTML-Antwort — dort fängt es zwar der `catch` (Zeile 90) und mappt auf
`network/recoverable`, aber `listAllPages` macht daraus bei `items.length === 0` einen
`PlanningUnavailableError` (korrekt) bzw. Teildaten (still).

Test: FI-13.

---

## Pfad P2 — Abwesenheit speichern

```
Timeline.tsx  → repositories.absences.saveAbsence()
  → apiPlanningRepositories.ts:181  POST /api/planning/absences
  → PlanningController → EfPlanningRepository.SaveAbsenceAsync:50  (Upsert, SaveChangesAsync)
```

- **Kein Timeout, kein Retry** auf dem POST (FP-05/FP-06). Ein Verbindungsabbruch nach dem Senden,
  aber vor der Antwort, ist für den Client nicht von „nie angekommen“ unterscheidbar. Die Id wird
  clientseitig vergeben (`EfPlanningRepository.cs:58` beschreibt das ausdrücklich) und der Server
  macht ein Upsert — ein Wiederholen durch den Nutzer ist damit **idempotent**. Das ist der einzige
  Schreibpfad im Repo mit dieser Eigenschaft, und er ist gut.
- **Kein `EnableRetryOnFailure`** (`Program.cs:46`): ein transienter Azure-SQL-Fehler (40613, 40197,
  Failover, Deadlock) wird zu einer 500-Antwort. Der Client mappt sie auf `unknown/recoverable:true`,
  wiederholt aber nichts.
- Keine Optimistic Concurrency (kein `RowVersion`): `SetValues` (`EfPlanningRepository.cs:68`) ist
  Last-Write-Wins. Zwei parallele Bearbeiter überschreiben sich lautlos.

Test: FI-15, FI-16.

---

## Pfad P3 — Ferienantrag → Approval → Entscheidung → Outlook

```
POST /vacationrequests/{id}/start-approval  (PlanningController.cs:251)
  → GraphApprovalService (beta) ODER ApprovalFlowService (Power Automate)
  → bei null: request.Status = "failed"; SaveVacationRequest; 502          ← FP-09
Entscheidung:
  a) Callback: ApprovalCallbackController.cs:41
       → ApplyApprovalDecisionAsync   (DB-Commit #1)                       ← FP-08
       → OutlookSync.ApplyLifecycleAsync (Graph-Schreibvorgang)            ← FP-08
       → SaveVacationRequestAsync     (DB-Commit #2)                       ← FP-08
  b) Pull: PlanningController.cs:176-206 (gleiche Reihenfolge)
```

### FP-08 — Zwei Systeme, drei Commits, keine Kompensation (Schweregrad: kritisch)

```csharp
// ApprovalCallbackController.cs:56-68
var updated = await _repository.ApplyApprovalDecisionAsync(callback);   // Commit #1
if (_outlookSyncService.IsEnabled) {
    await _outlookSyncService.ApplyLifecycleAsync(updated, HttpContext.RequestAborted);  // Graph
    await _repository.SaveVacationRequestAsync(updated);                // Commit #2
}
```

Drei unabhängige Fehlerfenster, keine Transaktion (`grep BeginTransaction` in
`EfPlanningRepository.cs` → 0 Treffer), kein Outbox, keine Kompensation:

1. **Graph erfolgreich, Commit #2 schlägt fehl** → der Kalendereintrag existiert, aber
   `GraphEventId` wurde nie persistiert. RPP kann diesen Termin danach weder aktualisieren noch
   löschen; die nächste Statusänderung legt einen **zweiten** Termin an
   (`OutlookCalendarSyncService.cs:111` entscheidet allein anhand von `GraphEventId`). Verwaiste
   OOF-Termine im Kalender einer realen Person sind sichtbarer Schaden.
2. **Der Aufrufer trennt die Verbindung** (Power Automate bricht nach Timeout ab): der übergebene
   `HttpContext.RequestAborted` kanzelt den Graph-Aufruf. Der Catch-Filter in
   `OutlookCalendarSyncService.cs:76` schließt `OperationCanceledException` **ausdrücklich aus**, die
   Ausnahme läuft also nach oben → HTTP 500. Der Flow wiederholt den Callback → …
3. … und der Wiederholversuch trifft auf `ApplyApprovalDecisionAsync`, das nur Anträge mit
   `Status == "pendingApproval"` findet (`EfPlanningRepository.cs:242`). Der Antrag steht inzwischen
   auf `approved` → `null` → **HTTP 404 `pendingRequestNotFound`**, obwohl die Entscheidung längst
   angewendet wurde. Der Callback ist **nicht idempotent**: eine normale Wiederholung meldet einen
   dauerhaften Fehler, und der Outlook-Termin fehlt trotzdem.

Test: FI-17, FI-18, FI-19.

### FP-09 — `start-approval`: Timeout ≠ „nicht passiert“ (Schweregrad: hoch)

`ApprovalFlowService.cs:50` bricht nach 30 s ab und gibt `null` zurück; der Controller setzt daraufhin
`request.Status = "failed"` (`PlanningController.cs:303`) und antwortet 502. Ein Timeout heißt aber
nicht, dass der Flow nicht gestartet ist — Power Automate kann die Genehmigung sehr wohl erzeugt
haben. Es gibt keinen Idempotenz-Schlüssel Richtung Flow und keine Abgleichlogik; ein erneuter
Versuch des Nutzers erzeugt eine **zweite Genehmigung** für denselben Antrag. Derselbe Mechanismus
gilt für den Graph-Approvals-Pfad (`GraphApprovalService.CreateApprovalAsync` → `null` bei jedem
Fehler, `GraphApprovalService.cs:71/90`).

### FP-14 — Outlook-Sync: „failed“ ist eine Sackgasse (Schweregrad: mittel)

`OutlookCalendarSyncService.cs:138/179` setzt bei jedem HTTP-Fehler — inklusive **429 und 503** —
`OutlookSyncStatus = "failed"` und gibt auf. Kein `Retry-After`, kein Retry, kein Backoff.

**Behauptung vs. Code:** `docs/architecture.md:173` schreibt: „They update the synchronization status
to `failed`, retain the last error, and **allow retry through the service/UI boundary**.“ Ein solcher
Retry-Pfad existiert nicht. `ApplyLifecycleAsync` wird ausschließlich bei Lebenszyklus-Übergängen
aufgerufen (`PlanningController.cs:197,204,240,317`, `ApprovalCallbackController.cs:66`); es gibt
keinen Endpunkt, keinen Hintergrunddienst und kein UI-Element, das einen fehlgeschlagenen Sync erneut
anstößt. Ein während einer Graph-Drosselung genehmigter Antrag bleibt dauerhaft ohne Kalendereintrag.

Test: FI-20.

---

## Pfad P4 — Mitgliedschaften und Autorisierung (Backend)

```
GET /api/planning/memberships (PlanningController.cs:402)
  → GraphTeamMembershipService.GetRealTeamMembersAsync(teamId, throwOnFailure: true)  ← Gate
      → statischer Cache 5 min + globaler SemaphoreSlim                     ← FP-15, FP-16
      → FetchTeamMembersAsync → Graph SDK (Members + Owners, je bis 100 Seiten)
  → _repository.GetTeamMembershipsAsync → GetRealTeamMembersAsync()  (ohne throwOnFailure) ← FP-17
```

### FP-15 — Globales Semaphor serialisiert alle Graph-Mitgliederabrufe (Schweregrad: hoch)

```csharp
// GraphTeamMembershipService.cs:29
private static readonly SemaphoreSlim CacheLock = new(1, 1);
```

Der Cache ist pro Team geschlüsselt (`MemberCache`, Zeile 30), das Schloss ist es **nicht**. Jeder
Cache-Miss — für ein beliebiges Team — hält alle anderen Anfragen auf. Ist Graph langsam (der
HttpClient-Default-Timeout liegt bei ~100 s, dazu kommen SDK-interne Retries bei 429), stauen sich
sämtliche Membership-Anfragen aller Teams und Nutzer hinter einem einzigen Aufruf. Wegen `await` gibt
es keine Thread-Blockade, aber die Anfragen laufen selbst in Timeouts, und da der Membership-Check
ein **Autorisierungs-Gate** ist, betrifft das praktisch jeden Kernendpunkt.

Test: FI-21.

### FP-16 — Kein Negativ-Caching, kein „stale while error“ (Schweregrad: mittel)

`GraphTeamMembershipService.cs:79` schreibt nur nicht-leere Ergebnisse in den Cache. Fällt Graph nach
Ablauf der 5 Minuten aus, gibt es keinen letzten bekannten guten Stand, auf den zurückgefallen würde —
stattdessen ruft jede Anfrage erneut Graph (Thundering Herd, wenn auch durch FP-15 serialisiert) und
scheitert mit 502 (`PlanningController.cs:452`). Das Verhalten ist ehrlich, aber unnötig hart: für
eine reine Leseansicht wäre eine 5 Minuten alte Mitgliederliste die deutlich bessere Antwort.

Umgekehrt hat der 5-Minuten-Cache eine Autorisierungs-Wirkung: `IsUserOwnerOfTeamAsync`
(`GraphTeamMembershipService.cs:107`) und das Gate in `PlanningController.cs:430` entscheiden auf bis
zu 5 Minuten alten Daten. Ein aus dem Team entfernter Nutzer behält so lange Zugriff.

### FP-17 — Zwei Aufrufer, zwei Fehlerregime, ein Datenweg (Schweregrad: hoch)

Der Controller fragt Graph strikt (`throwOnFailure: true`, Zeile 430) — das Repository unmittelbar
danach kulant: `EfPlanningRepository.cs:306` ruft `GetRealTeamMembersAsync(teamId)` **ohne** das Flag,
und `GetRealTeamMembersAsync` fängt `GraphUnavailableException` bei `throwOnFailure == false` ab und
gibt eine leere Liste zurück (`GraphTeamMembershipService.cs:72-77`). Normalerweise deckt der
5-Minuten-Cache diesen zweiten Aufruf ab; bei Cache-Ablauf zwischen beiden Aufrufen oder wenn das
Gate übersprungen wird (kein `oid`-Claim, `PlanningController.cs:424`, oder aktiver
Development-Bypass `ApiSettings:RequireAuthentication=false`) liefert der Endpunkt **HTTP 200 mit
leerer Mitgliederliste** — genau der Fehler, den EO-428 laut Kommentar (`PlanningController.cs:447`)
beseitigt hat. Für `GetOrgConfigAsync` (`EfPlanningRepository.cs:352`) und
`GetTeamAdminDetailsAsync` (Zeile 637) gilt der kulante Pfad ohnehin immer.

Test: FI-22.

---

## Pfad P5 — Eingehender Mailbox-Sync (Hintergrund)

```
MailboxSyncBackgroundService.cs:37  cron-Schleife (Fallback 4 h bei ungültigem Ausdruck)
  → MailboxSyncService.RunSyncAsync:87
      → GetAccessTokenForAppAsync   (ein Token für den gesamten Zyklus)     ← FP-18
      → FetchUnreadMessagesAsync    (Fehler = Abbruch des ganzen Zyklus)    ← FP-19
      → je Nachricht: Anhänge/MIME laden → IcsParser → DB → MarkAsRead      ← FP-20
```

### FP-18 — Ein Token für den ganzen Zyklus (Schweregrad: mittel)

`MailboxSyncService.cs:113` holt das App-Token einmal und reicht es durch alle nachfolgenden Aufrufe
(bis hinunter zu `DownloadAttachmentAsync`, Zeile 673). Bei `BatchSize`-vielen Nachrichten mit je
mehreren Graph-Aufrufen kann ein Zyklus die Tokenlebensdauer überschreiten; danach schlägt jede
weitere Nachricht mit 401 fehl, ohne dass ein neues Token geholt wird. Die Nachrichten bleiben
ungelesen und werden im nächsten Zyklus erneut versucht — der Sync ist dadurch nicht kaputt, aber
er kommt bei einem Rückstau nicht mehr voran.

### FP-19 — Zyklus-Abbruch ohne Backoff, ohne Alarm (Schweregrad: mittel)

`MailboxSyncService.cs:214` wirft bei jedem Nicht-2xx `MailboxSyncUnavailableException`. Das ist eine
bewusste, gut begründete Entscheidung (der Kommentar Zeile 208-211 erklärt sie überzeugend, und der
Code hält sie ein). Was fehlt: Die Hintergrundschleife fängt die Ausnahme nur ab
(`MailboxSyncBackgroundService.cs:57`) und wartet bis zum nächsten Cron-Termin. Bei 429 wird
`Retry-After` ignoriert; bei einem dauerhaften 403 (fehlender Consent) scheitert der Sync stundenlang
still — sichtbar nur im Log und im flüchtigen `MailboxSyncState` (In-Memory-Singleton, beim Neustart
verloren). Es gibt keinen Alarm und keinen Zähler, der eine Serie fehlgeschlagener Zyklen aufdeckt.

### FP-20 — Nachrichten werden auch dann als gelesen markiert, wenn nichts verarbeitet wurde (Schweregrad: mittel)

`MailboxSyncService.cs:255` markiert Nachrichten ohne Kalenderdaten als gelesen, `:341` markiert am
Ende jede verarbeitete Nachricht — auch dann, wenn jede einzelne Payload am Parser gescheitert ist
(Zeile 267-278: `continue`). Es gibt kein Dead-Letter, keinen Ordner, kein persistiertes Protokoll:
Der Beleg verschwindet aus der Sicht des Syncs, die Diagnose lebt nur im letzten `SyncResult` im
Speicher. Umgekehrt ist die Wiederverarbeitung nach einem fehlgeschlagenen `MarkAsRead` (Zeile 703,
nur `LogWarning`) durch `IcsUid` (Zeile 351) und die Überlappungsprüfung (Zeile 377) weitgehend
idempotent — Ausnahme: eine ICS **ohne UID**, deren erzeugte Abwesenheit zwischenzeitlich auf einen
anderen Zeitraum bearbeitet wurde, wird beim nächsten Lauf erneut angelegt.

Test: FI-23, FI-24.

---

## Querschnitt

### FP-10 — Datenbankausfall beim Start beendet den Prozess (Schweregrad: kritisch)

```csharp
// Program.cs:212
app.Logger.LogInformation("Applying database migrations.");
context.Database.Migrate();
```

Ungeschützt und **vor** `app.Run()`. Ist SQL beim Start nicht erreichbar — Azure-SQL-Failover,
Firewall-Regel, pausierte Serverless-DB, Neustart nach Deployment — wirft `Migrate()`, der Prozess
endet mit einem unbehandelten Fehler und der App Service startet ihn erneut: eine Neustartschleife.
Betroffen ist dabei **alles**, auch die statisch ausgelieferte SPA, `/health` und alle Endpunkte, die
gar keine Datenbank brauchen. Eine kurze DB-Störung wird so zu einem Totalausfall, der die
DB-Störung überdauert. Zum Vergleich: die fehlende Verbindungszeichenfolge ist sauber behandelt
(Zeile 204-208, Warnung statt Absturz) — der Ausfallfall ist es nicht.

Test: FI-25.

### FP-11 — Health-Endpunkt und Monitoring melden „gesund“ im Totalausfall (Schweregrad: hoch)

`HealthController.cs:42` gibt **statisch** `Status = "healthy"` zurück. Die Datenbank wird nicht
angefasst — `TryReadDatabaseTarget` (Zeile 62) parst lediglich die Verbindungszeichenfolge, öffnet
aber keine Verbindung. Graph wird nicht geprüft. Der Endpunkt ist damit ein reiner Prozess-Ping und
für Readiness ungeeignet: Bei ausgefallener Datenbank meldet der Health-Check weiterhin „healthy“,
die Admin-Center-Probe (`appConfigService.ts:82`) zeigt grün, und die einzige Stelle, an der ein
Betreiber den Ausfall sieht, sind 500er in den Nutzeranfragen.

Auf der Client-Seite dasselbe Bild: `monitoringService.ts:76` prüft ausschließlich die
**Konfiguration** (ist eine URL gesetzt), niemals Erreichbarkeit. `getMonitoringHealthSnapshot`
liefert `healthy`, während sämtliche Abhängigkeiten unten sind.

Test: FI-26.

### FP-13 — Fotos: Fehlschläge werden für die gesamte Session gecacht (Schweregrad: niedrig)

`userPhotoService.ts:26` legt die **Promise** in den Cache, bevor sie erfüllt ist, und `loadPhoto`
gibt bei jedem Fehler `undefined` zurück (Zeile 40/44). Ein 503 oder 429 während des ersten
Timeline-Aufbaus bedeutet: dieser Nutzer hat bis zum Neuladen des Tabs kein Bild. Nur kosmetisch,
aber ein Beispiel für dasselbe Muster — ein vorübergehender Fehler wird zum Dauerzustand.

---

## Zusammenfassung Behauptung vs. Code

| Behauptung | Fundstelle | Realität |
|---|---|---|
| Fehlgeschlagene Outlook-Syncs „allow retry through the service/UI boundary“ | `docs/architecture.md:173` | Kein Retry-Pfad existiert (FP-14) |
| EO-428: Ausfälle erscheinen nie als „leerer Plan“ | Kommentare `planningDataService.ts:127-147`, `PlanningController.cs:447` | Gilt für `listAllPages`; der `settings`-Zweig (FP-03), Schema-Fehler (FP-12) und der kulante Repository-Pfad (FP-17) erzeugen ihn weiterhin |
| „A cycle would otherwise hang the request; a bounded loop costs nothing“ | `GraphTeamMembershipService.cs:372` | Im Backend umgesetzt, im Frontend-Paging fehlt genau diese Bremse (FP-04) |
| Health-Endpunkt für Frontend + App-Admin-Center | `HealthController.cs:9-11` | Statisches „healthy“, prüft keine Abhängigkeit (FP-11) |
| „getAuthToken can hang indefinitely … never block the UI forever“ | `teamsSsoAuthProvider.ts:70` | Korrekt umgesetzt — aber `fetch` darunter hat keinen Timeout, die UI hängt dort (FP-05) |
