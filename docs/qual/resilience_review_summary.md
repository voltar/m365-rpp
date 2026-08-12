# M365 Ressourcen & Präsenzplanung (RPP)
## Resilience Review — Zusammenfassung

Kurzfassung der Analyse „Verhalten bei Ausfällen und Störungen der Abhängigkeiten“.
Reine Analyse plus Testartefakte — **es wurde kein Produktivcode geändert**.

Ausführliche Fassung: [`docs/resilience/`](./resilience/README.md).

---

## Artefakte

| Datei | Inhalt |
|---|---|
| [`docs/resilience/README.md`](./resilience/README.md) | Einstieg, Top-5-Befunde, Liste der Stellen, die dem Fehlerfall standhalten |
| [`docs/resilience/dependency-inventory.md`](./resilience/dependency-inventory.md) | 18 externe Abhängigkeiten mit Timeout, Retry und Blast-Radius |
| [`docs/resilience/failure-path-analysis.md`](./resilience/failure-path-analysis.md) | 5 kritische Nutzerpfade, Fehlerpunkte FP-01…FP-20 mit `datei:zeile`-Beleg |
| [`docs/resilience/fault-injection-testplan.md`](./resilience/fault-injection-testplan.md) | Prüfmatrix FI-01…FI-29, Durchführungsreihenfolge, Abnahmekriterien |
| [`tests/fault-injection/`](../../tests/fault-injection/README.md) | Lauffähiger Harness: Fault-Proxy (17 Szenarien, abhängigkeitsfrei), Browser-Injektor für Graph- und Teams-SDK-Pfade |

---

## Die wichtigsten Befunde

### 1. Konfigurationsausfall erzeugt erfundene Daten (kritisch)

`index.html:70` lädt `/config/runtime-config.js` als klassisches `<script>` **ohne `onerror`**. Ohne
gültige `apiBaseUrl` bleibt `defaultPlanningRepositories.ts:14` beim Mock-Repository:

```ts
let repositories: PlanningRepositories = createMockPlanningRepositories();
if (planningDataSource === "api" && runtimeConfiguration.apiBaseUrl) { ... }
```

Der Nutzer sieht eine vollständig gefüllte Timeline mit erfundenen Personen und Abwesenheiten —
kein Banner, kein Statusunterschied, kein Hinweis. Eine Infrastrukturstörung erscheint als plausible
Falschdaten. Derselbe Effekt tritt ein, wenn `apiBaseUrl` gesetzt, aber ungültig ist
(`validateApiBaseUrl` erlaubt nur `https:` oder `http://localhost`). → FP-01, Test FI-01

### 2. 429 wird als dauerhafter Fehler behandelt (kritisch)

`Retry-After` wird im gesamten Repository **nirgends** gelesen (0 Treffer). In `graphClient.ts:80`
und `apiPlanningRepositories.ts:79` gilt `recoverable: status >= 500` — für 429 also `false`. Es gibt
kein Backoff, keinen Jitter, keinen Retry.

Kein Retry-Sturm also, sondern der entgegengesetzte Fehler: eine per Definition vorübergehende
Drosselung wird als endgültig behandelt, und der Nutzer kann nur manuell neu laden — direkt in
dasselbe Rate-Limit hinein. Einzige Ausnahme im Repo ist der Graph-SDK-Pfad im Backend
(`GraphTeamMembershipService.cs:228`), der die Kiota-Default-Middleware mit `RetryHandler` erbt.
Alle direkten `HttpClient`-Aufrufe gegen Graph (Kalender, Mail, Approvals, Fotos) tun das nicht.
→ FP-06, Tests FI-02, FI-08, FI-09

### 3. Kein `fetch`-Timeout, keine Paging-Bremse (hoch)

`apiPlanningRepositories.ts:51`, `graphClient.ts:66` und `sharePointClient.ts:87` rufen `fetch` ohne
`AbortController`. Ein hängender Aufruf lässt den Tab dauerhaft im Zustand `loading` — ohne Fehler
und ohne Wiederholmöglichkeit, weil der Retry-Button erst hinter den Endzuständen sitzt.

`listAllPages` (`planningDataService.ts:121`) hat weder ein Seitenlimit noch ein Erkennen wiederholter
Tokens; ein stehengebliebener `nextPageToken` erzeugt eine Endlosschleife. Das Backend hat für genau
diesen Fall bewusst eine Bremse (`GraphTeamMembershipService.cs:374`, `guard < 100`) — im Frontend
fehlt sie. Bricht das Paging mittendrin ab, werden Teildaten ohne jedes Signal an die UI
weitergereicht, und `capacityEngine` rechnet die Auslastung auf einem abgeschnittenen Datensatz.
→ FP-04, FP-05, Tests FI-03, FI-04

### 4. Genehmigungs-Callback nicht idempotent, zwei Systeme ohne Kompensation (kritisch)

Reihenfolge in `ApprovalCallbackController.cs:56-68`: DB-Commit → Graph-Kalenderschreibvorgang →
zweiter DB-Commit. Keine Transaktion, kein Outbox, keine Kompensation (`BeginTransaction` in
`EfPlanningRepository.cs`: 0 Treffer).

* Schlägt Commit #2 fehl, existiert ein Kalendertermin, dessen `GraphEventId` nie persistiert wurde —
  RPP kann ihn weder aktualisieren noch löschen, und die nächste Statusänderung legt einen zweiten an.
* Trennt der Aufrufer die Verbindung, kanzelt `HttpContext.RequestAborted` den Graph-Aufruf; der
  Catch-Filter in `OutlookCalendarSyncService.cs:76` schließt `OperationCanceledException` aus → 500.
* Der Retry des Flows trifft auf `Status == "pendingApproval"` (`EfPlanningRepository.cs:242`) →
  **404 `pendingRequestNotFound`**, obwohl die Entscheidung längst angewendet wurde.

→ FP-08, Tests FI-17, FI-18, FI-19

### 5. Datenbankausfall beim Start beendet den Prozess (kritisch)

`Program.cs:212` ruft `context.Database.Migrate()` ungeschützt vor `app.Run()`. Ist SQL beim Start
nicht erreichbar (Failover, Firewall, pausierte Serverless-DB), endet der Prozess mit einem
unbehandelten Fehler und startet neu — eine Neustartschleife, in der auch die statische SPA,
`/health` und alle Endpunkte ohne Datenbankbedarf ausfallen. Die *fehlende* Verbindungszeichenfolge
ist sauber behandelt (Warnung statt Absturz, Zeile 204) — der Ausfallfall nicht.

Ergänzend: `HealthController.cs:42` gibt statisch `"healthy"` zurück und fasst keine Abhängigkeit an
(`TryReadDatabaseTarget` parst nur die Verbindungszeichenfolge). Der Endpunkt ist für Readiness
ungeeignet; bei totem SQL meldet er weiter grün. Dasselbe clientseitig in `monitoringService.ts:76`,
das ausschließlich Konfiguration prüft. → FP-10, FP-11, Tests FI-25, FI-26

---

## Behauptung vs. Code

| Behauptung | Fundstelle | Realität |
|---|---|---|
| Fehlgeschlagene Outlook-Syncs „allow retry through the service/UI boundary“ | `docs/architecture.md:173` | Kein Retry-Pfad existiert; `ApplyLifecycleAsync` wird nur bei Lebenszyklus-Übergängen aufgerufen |
| EO-428: Ausfälle erscheinen nie als „leerer Plan“ | Kommentare in `planningDataService.ts:127-147`, `PlanningController.cs:447` | Gilt für `listAllPages`; der `settings`-Zweig, Schemafehler und der kulante Repository-Pfad erzeugen ihn weiterhin |
| „A bounded loop costs nothing“ | `GraphTeamMembershipService.cs:372` | Im Backend umgesetzt, im Frontend-Paging fehlt genau diese Bremse |
| Health-Endpunkt für Frontend + App-Admin-Center | `HealthController.cs:9-11` | Statisches „healthy“, prüft keine Abhängigkeit |

---

## Was gut ist

Nicht alles ist Befund. Diese Stellen halten dem Fehlerfall stand und taugen als Vorbild für die
Härtung der übrigen:

* `teamsSsoAuthProvider.ts:58/71/91/95` — jeder Aufruf ins Teams-SDK ist mit einem Timeout versehen,
  mit einer Begründung im Code, die zutrifft.
* `EfPlanningRepository.SaveAbsenceAsync:50` — clientseitige Id plus serverseitiges Upsert macht den
  meistgenutzten Schreibpfad idempotent.
* `MailboxSyncService.cs:214`, `PlanningController.cs:445` — ein Graph-Ausfall wird als Ausfall
  gemeldet statt als leeres Ergebnis. Die EO-428-Korrekturen sind echt, sie sind nur nicht überall
  angekommen.
* `powerAutomateApprovalIntegrationRepository.ts:42`, `appConfigService.ts:77` — sauberes
  `AbortController`-Muster; im Repo vorhanden, aber nicht auf den Kernpfaden angewandt.

---

## Nicht anwendbar

`$batch` wird weder im Frontend noch im Backend verwendet. Das Szenario „Teilfehler im Batch wird als
Erfolg gewertet“ ist heute gegenstandslos; FI-14 bleibt als Regressionswächter für eine künftige
Batch-Nutzung im Testplan stehen.

---

## Vorschlag für den EO-Zuschnitt

Dieser Review ist keine Engineering Order und implementiert nichts (`AGENTS.md`: nur eine EO
gleichzeitig aktiv). Aus den Befunden ergeben sich drei sinnvoll getrennte Pakete:

1. **Härtung Frontend-Transport** — gemeinsamer `fetch`-Wrapper mit Timeout, Backoff mit Jitter und
   `Retry-After` für `graphClient`, `apiPlanningRepositories`, `sharePointClient`; Paging-Bremse und
   ein `partial`-Flag im Snapshot. (FI-02, FI-03, FI-04, FI-08, FI-09)
2. **Ehrliche Zustände** — kein stiller Mock-Fallback, `settings`-Fehler als
   `PlanningUnavailableError`, Schemaprüfung, echter Health-Check. (FI-01, FI-05, FI-13, FI-26)
3. **Konsistenz der Schreibpfade** — Idempotenz des Callbacks, Reihenfolge bzw. Kompensation um den
   Kalenderschreibvorgang, `EnableRetryOnFailure`, `Migrate()` beim Start absichern.
   (FI-15, FI-17, FI-18, FI-19, FI-25)
