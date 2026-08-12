# Fault-Injection-Testplan

Ziel: jede in `failure-path-analysis.md` benannte Fehlerstelle reproduzierbar auslösen und das
tatsächliche Verhalten festhalten. Der Plan ist ein **Prüfplan, kein Fix-Plan** — die Spalte
„Erwartet (Soll)“ beschreibt das gewünschte Zielverhalten und ist damit zugleich die
Akzeptanzbedingung für eine spätere Härtung.

Die Spalte „Heute (aus Code abgeleitet)“ ist eine Vorhersage aus der Codeanalyse, **kein Messwert**.
Der Testlauf bestätigt oder widerlegt sie; abweichende Ergebnisse sind der wertvollste Teil des Laufs.

Werkzeuge und Bedienung: `tests/fault-injection/README.md`.
Maschinenlesbare Fassung der Szenarien: `tests/fault-injection/scenarios.json`.

## Testumgebung

| Ebene | Aufbau |
|---|---|
| L1 Browser → API | Fault-Proxy (`tests/fault-injection/fault-proxy.mjs`) zwischen SPA und API; `apiBaseUrl` per localStorage-Override auf den Proxy |
| L2 Browser → Graph | `tests/fault-injection/browser/fault-injector.js` in der Konsole (patcht `window.fetch`); Graph-Basis-URL ist im Code fixiert und nicht umlenkbar |
| L3 API → Graph | Netzwerkebene: DNS-Umleitung/Blockade des Containers, oder Entzug der Graph-App-Berechtigung im Testtenant |
| L4 API → SQL | `docker compose -f docker-compose.api.yml` mit gestopptem/unerreichbarem SQL, oder Firewall-Regel |
| L5 Callback → API | `curl` gegen `/api/approvals/callback` (Replay, Abbruch, Fehlkonfiguration) |

Vor jedem Szenario: Browser-Konsole offen (Netzwerk-Tab mitschneiden), API-Logs mitlaufen,
`window.localStorage` sauber, Tab hart neu laden (der Bootstrap-Cache ist ein `WeakMap` pro
Repositories-Instanz, `planningBootstrapService.ts:32`).

---

## A — Graph / API: HTTP-Fehlerantworten

| ID | Szenario | Injektion | Erwartet (Soll) | Heute (aus Code abgeleitet) | Sev |
|---|---|---|---|---|---|
| FI-01 | `runtime-config.js` liefert 404 | Proxy-Regel `blockRuntimeConfig`, oder Datei umbenennen | Sichtbarer Fehlerzustand: „Konfiguration nicht ladbar“, **kein** Datenzugriff | Stiller Fall auf Mock-Repository; erfundene Personen/Abwesenheiten ohne Hinweis (FP-01) | **kritisch** |
| FI-02 | 429 **mit** `Retry-After: 5` auf Seite 2 der Mitgliedschaften | `scenario=throttle-retry-after` | Header respektieren, nach ≥5 s genau einmal wiederholen, Bootstrap gelingt | Kein Retry; `code:"unknown"`, `recoverable:false`; Teildaten oder Fehlerbanner (FP-06) | **kritisch** |
| FI-03 | Verbindung hängt (kein RST, keine Antwort) | `scenario=blackhole` (Proxy antwortet nie) | Abbruch nach definiertem Timeout, Fehlerzustand mit Retry-Schaltfläche | `fetch` ohne Timeout → Tab bleibt dauerhaft in `loading` (FP-05) | **hoch** |
| FI-04 | Server liefert denselben `nextPageToken` erneut | `scenario=paging-loop` | Schleife nach n Seiten oder bei Token-Wiederholung abbrechen, Teildaten kennzeichnen | Endlosschleife in `listAllPages`, Tab hängt (FP-04) | **hoch** |
| FI-05 | 500 auf `/api/planning/settings` | `scenario=fail-settings` | Fehlerbanner mit Korrelations-ID | `status: "empty"` → „keine planbaren Personen“ (FP-03) | **kritisch** |
| FI-06 | 500 auf `/api/planning/absences`, alles andere gesund | `scenario=fail-absences` | Teilweiser Erfolg **oder** klarer Fehler; Mitgliedschaften bleiben erhalten | `Promise.all` verwirft alle Parallel-Ergebnisse; Bootstrap-Fehler (FP-03) | **hoch** |
| FI-07 | Teams-Host antwortet auf `getContext` nicht | Browser-Injektor `stallTeamsContext` | Kontext einmal auflösen und cachen; ein Timeout, nicht acht | ≥8 Auflösungen à bis zu 10 s pro Bootstrap (FP-02) | **hoch** |
| FI-08 | 429 **ohne** `Retry-After` | `scenario=throttle-bare` | Exponentielles Backoff mit Jitter, begrenzte Versuche | Kein Retry, als dauerhafter Fehler behandelt (FP-06) | **hoch** |
| FI-09 | 503 und 504 im Wechsel | `scenario=flaky-5xx` | Begrenzte Wiederholung, danach Fehlerbanner | `recoverable:true` gesetzt, aber niemand wertet es aus (FP-06) | **hoch** |
| FI-13 | 200 OK mit unerwartetem Schema (`{}`, `null`-Felder, HTML) | `scenario=garbage-body` | Validierung, klarer Fehler, keine stille Leere | `TypeError` → Teilergebnisse → `empty` (FP-12) | **hoch** |
| FI-14 | `$batch` mit gemischten Teilantworten (200/429/403) | — heute nicht anwendbar | Pro Teilantwort auswerten | **Kein `$batch` im Code.** Szenario bleibt als Regressionswächter für künftige Batch-Nutzung dokumentiert | — |

## B — Auth

| ID | Szenario | Injektion | Erwartet (Soll) | Heute (aus Code abgeleitet) | Sev |
|---|---|---|---|---|---|
| FI-10 | Token läuft mitten in der Session ab (401 auf allen Folgeaufrufen) | `scenario=expire-token` (Proxy antwortet 401) | Genau ein Refresh, Wiederholung des Aufrufs, für den Nutzer unsichtbar | Kein Invalidieren des Token-Caches (`clear()` wird nie aufgerufen); bis zu 5 min lang 401 mit demselben Token (FP-07) | **hoch** |
| FI-11 | Consent nachträglich entzogen / Nutzer deaktiviert (dauerhaft 403) | Testtenant: App-Zuweisung entfernen; ersatzweise `scenario=forbidden` | Zustand `accessDenied` **mit** einem gangbaren Weg (Consent-Popup oder klare Anweisung) | `accessDenied` wird korrekt unterschieden (`unauthenticated` vs. `forbidden`), aber es gibt keinen Consent-Fluss im Code (FP-07) | mittel |
| FI-12 | Auth-Provider nicht erreichbar (`getAuthToken` hängt) | Browser-Injektor `stallGetAuthToken` | Timeout, verständliche Meldung, Wiederholung möglich | Korrekt behandelt: 10-s-Timeout, `forbidden/recoverable` (`teamsSsoAuthProvider.ts:71`) — **erwarteter Passfall** | — |
| FI-27 | MFA-/Consent-Prompt wird im iframe blockiert | Teams-Client mit Conditional-Access-Regel im Testtenant | Ausweichweg über `authentication.authenticate()`-Popup | Kein Popup-Fallback implementiert; Endzustand `accessDenied` (FP-07) | mittel |

## C — Eigenes Backend, Daten, Konsistenz

| ID | Szenario | Injektion | Erwartet (Soll) | Heute (aus Code abgeleitet) | Sev |
|---|---|---|---|---|---|
| FI-15 | Transienter SQL-Fehler beim Schreiben (Deadlock/40197) | SQL: konkurrierende Transaktion erzwingen, oder DB kurz stoppen | EF-Retry (`EnableRetryOnFailure`), Nutzer merkt nichts | Kein Retry konfiguriert → 500 an den Client, kein Client-Retry (FP-P2) | **hoch** |
| FI-16 | Verbindungsabbruch nach dem POST, vor der Antwort | Proxy `scenario=cut-after-request` | Wiederholung ist gefahrlos | Ist gefahrlos: Upsert auf clientseitiger Id (`EfPlanningRepository.cs:58`) — **erwarteter Passfall** | — |
| FI-17 | Graph-Kalenderaufruf gelingt, danach schlägt Commit #2 fehl | DB nach dem Graph-Aufruf stoppen (Breakpoint/Verzögerung) | Kompensation oder Outbox; kein verwaister Termin | Verwaister Kalendertermin ohne persistierte `GraphEventId`; nächster Übergang legt einen zweiten an (FP-08) | **kritisch** |
| FI-18 | Callback-Client trennt die Verbindung während des Graph-Aufrufs | `curl --max-time 1` gegen `/api/approvals/callback` | Entscheidung bleibt konsistent, Wiederholung ist idempotent | `OperationCanceledException` läuft durch → 500; Entscheidung ist bereits committed (FP-08) | **kritisch** |
| FI-19 | Identischer Callback wird wiederholt (Flow-Retry) | Denselben `curl`-Aufruf zweimal senden | 200 mit demselben Ergebnis (idempotent) | Zweiter Aufruf: **404 `pendingRequestNotFound`**, obwohl die Entscheidung angewendet wurde (FP-08) | **kritisch** |
| FI-20 | Graph antwortet 429 beim Kalender-Upsert nach Genehmigung | L3-Blockade oder Testtenant-Drosselung | `Retry-After` respektieren; spätestens durch einen Wiederanlauf nachziehen | `OutlookSyncStatus="failed"`, **kein** Wiederanlauf existiert — entgegen `docs/architecture.md:173` (FP-14) | **hoch** |
| FI-21 | Graph antwortet für **ein** Team sehr langsam (60 s) | L3: Verzögerung auf `graph.microsoft.com` | Nur dieses Team ist betroffen | Globales `SemaphoreSlim` staut die Mitgliederabrufe **aller** Teams (FP-15) | **hoch** |
| FI-22 | Graph fällt aus, Aufrufer ohne `oid`-Claim (oder Dev-Bypass aktiv) | Graph blockieren, Anfrage ohne Token (`RequireAuthentication=false`) | 502 „membershipLookupFailed“ | HTTP **200 mit leerer Mitgliederliste** über den kulanten Repository-Pfad (FP-17) | **hoch** |
| FI-25 | SQL beim **Start** der API nicht erreichbar | `docker compose up` mit gestopptem SQL | App startet, meldet sich `unhealthy`, liefert statische SPA aus | `Database.Migrate()` wirft → Prozessende → Neustartschleife; nichts wird ausgeliefert (FP-10) | **kritisch** |
| FI-26 | Vollständiger DB-Ausfall im laufenden Betrieb | SQL-Container stoppen | `/health` meldet `unhealthy`/503, Admin-Center zeigt rot | `/health` meldet weiterhin `healthy`; Admin-Center-Probe grün (FP-11) | **hoch** |

## D — Hintergrundprozesse

| ID | Szenario | Injektion | Erwartet (Soll) | Heute (aus Code abgeleitet) | Sev |
|---|---|---|---|---|---|
| FI-23 | Graph liefert dauerhaft 403 für die Mailbox-Abfrage | App-Berechtigung im Testtenant entziehen | Zustand ist außerhalb der Logs sichtbar; Zähler/Alarm nach n Fehlläufen | Zyklus scheitert still bis zum nächsten Cron-Termin; Zustand nur im flüchtigen `MailboxSyncState` (FP-19) | mittel |
| FI-24 | Nachricht mit unparsbarer `.ics` | Testmail mit defekter `.ics` an die Sammel-Mailbox | Dead-Letter oder Nachricht ungelesen lassen | Nachricht wird als gelesen markiert, Beleg verschwindet aus dem Blickfeld (FP-20) | mittel |
| FI-28 | Token läuft während eines langen Sync-Zyklus ab | `BatchSize` hochsetzen, Token-Lebensdauer im Testtenant kürzen | Token pro Aufruf frisch beziehen | 401 für alle restlichen Nachrichten des Zyklus, kein Neubezug (FP-18) | mittel |
| FI-29 | Ungültiger Cron-Ausdruck in der Konfiguration | `MailboxSync:CronExpression = "nonsense"` | Konfigurationsfehler beim Start sichtbar machen | Stiller Fallback auf 4-Stunden-Intervall, nur `LogWarning` (`MailboxSyncBackgroundService.cs:87`) | niedrig |

---

## Durchführungsreihenfolge

Nicht nach ID, sondern nach Aufwand für den Aufbau:

1. **Runde 1 (nur Fault-Proxy, ~1 h):** FI-01, FI-02, FI-03, FI-04, FI-05, FI-06, FI-08, FI-09, FI-10, FI-13, FI-16.
   Deckt 11 von 26 Szenarien und alle vier kritischen Frontend-Befunde ab.
2. **Runde 2 (Browser-Injektor):** FI-07, FI-12.
3. **Runde 3 (Container-/DB-Ebene):** FI-15, FI-25, FI-26, FI-17.
4. **Runde 4 (`curl` gegen die API):** FI-18, FI-19, FI-22.
5. **Runde 5 (Testtenant, längste Vorlaufzeit):** FI-11, FI-20, FI-21, FI-23, FI-24, FI-27, FI-28.

## Protokollvorlage je Szenario

```
ID:            FI-xx
Datum/Build:   release.json version, sourceRevision
Aufbau:        L1..L5, Proxy-Szenario
Beobachtung:   Was der Nutzer sieht (Screenshot), Netzwerk-Tab, API-Log
Bewertung:     bestanden | abweichend | schlechter als vorhergesagt
Abweichung:    ...
Folge-EO:      ...
```

## Abbruch-/Abnahmekriterien

Ein Fault-Injection-Lauf gilt als **bestanden**, wenn für jedes Szenario gilt:

1. Der Nutzer sieht nie erfundene Daten, die als echte ausgegeben werden (FI-01).
2. Es gibt keinen Zustand ohne Ausgang — jeder Fehler endet in einem Endzustand mit Wiederholmöglichkeit
   und Korrelations-ID, kein dauerhaftes `loading` (FI-03, FI-04).
3. Ein Ausfall wird nie als „leer“ dargestellt (FI-05, FI-13, FI-22).
4. Wiederholbare Operationen sind idempotent (FI-16, FI-19).
5. Der Health-Endpunkt widerspricht der Realität nicht (FI-25, FI-26).

## Bezug zur Governance

Dieser Plan ist **kein** Engineering Order und implementiert nichts (`AGENTS.md`: nur eine EO gleichzeitig aktiv).
Er liefert die Faktenbasis, aus der eine spätere EO ihren Umfang zieht. Nach heutigem Stand
wären das drei sinnvoll getrennte Pakete:

- **Härtung Frontend-Transport** — Timeout + Backoff mit Jitter + `Retry-After` in einem gemeinsamen
  `fetch`-Wrapper für `graphClient`, `apiPlanningRepositories`, `sharePointClient`; Paging-Bremse und
  ein `partial`-Flag im Snapshot. (FI-02, FI-03, FI-04, FI-08, FI-09)
- **Ehrliche Zustände** — kein stiller Mock-Fallback, `settings`-Fehler als `PlanningUnavailableError`,
  Schemaprüfung, echter Health-Check. (FI-01, FI-05, FI-13, FI-26)
- **Konsistenz der Schreibpfade** — Idempotenz des Callbacks, Reihenfolge/Kompensation um den
  Kalender-Schreibvorgang, `EnableRetryOnFailure`, `Migrate()` beim Start absichern. (FI-15, FI-17, FI-18, FI-19, FI-25)
