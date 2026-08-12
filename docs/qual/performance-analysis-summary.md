# Performance-Analyse RPP — Zusammenfassung

Kurzfassung von [`performance-analysis.md`](./performance-analysis.md) für Entscheid und
EO-Planung. Alle Details, Datei- und Zeilenverweise stehen im Hauptdokument.

| | |
|---|---|
| Analysierter Stand | `ba42131` (Branch `claude/m365-teams-perf-analysis-hwl80e`) |
| Release | 4.0.6 |
| Datum | 2026-07-31 |
| Status | Analyse — **kein Code geändert** |

---

## Ausgangslage

Gemessen wurde mit `npm ci` + `npm run build` gegen den analysierten Stand; die Byte-Zahlen stammen
aus dem tatsächlichen `dist/`. Nicht messbar waren in dieser Umgebung der Backend-Testlauf und die
API-Latenz (kein `dotnet` installiert), die Startzeit im echten Teams-Client und Brotli-Grössen.
Backend- und Rendering-Befunde sind deshalb statisch bzw. analytisch hergeleitet und im
Hauptdokument entsprechend markiert.

---

## Die drei dominierenden Befunde

**1. Alle 41 Sprachpakete werden bei jedem Tab-Load geladen.**
`translations.ts` importiert alle 40 Locales statisch. Das Chunk-Splitting in `vite.config.ts`
trennt sie zwar in eigene Dateien, hebt die Abhängigkeit aber nicht auf — `dist/index.html` lädt
alle 41 per `modulepreload` vor. Das sind **488 KiB gzip / 1 619 KiB roh ≈ 65 % der Startpayload**
für 40 Sprachen, die die Session nie anzeigt. Pro Session ist genau ein Locale relevant (~12 KiB
gzip). Da die UI-Sprache aus dem Teams-Kontext kommt und es keinen Sprachumschalter gibt, hängt
nichts Funktionales am Eager-Load.

**2. Keine Response Compression im Backend, das die SPA ausliefert.**
Volltextsuche über `RppWebApi/` nach `Compression|Brotli|Gzip`: kein Treffer, und keine
`web.config`. Kestrel komprimiert statische Dateien nicht von selbst, und ohne IIS oder Reverse
Proxy davor holt das niemand nach. Der Client lädt damit voraussichtlich **2 474 KiB statt
725 KiB** — Faktor 3,4, geschätzt rund 2,0 s statt 0,6 s Transferzeit auf einem typischen
Firmen-Uplink.

**3. Bis zu 20 sequenzielle Graph-Roundtrips in jedem `GET /vacationrequests`.**
`SyncPendingGraphApprovalsAsync` läuft synchron im Request-Pfad jedes Listenabrufs, ohne Cache, mit
strikt serialisierten Calls in einer `foreach`-Schleife. Geschätzt **4–8 s zusätzliche Antwortzeit**
pro Aufruf.

---

## Weitere Befunde

| Bereich | Befund |
|---|---|
| Startzeit | `app.initialize()` hängt hinter dem vollständigen Modulgraph (`AppShell.tsx:114`) — der Teams-Spinner läuft, bis Bundle, Fluent UI und alle Locales geladen und React gemountet ist. Der Handshake selbst hat keine dieser Abhängigkeiten. |
| Über-Abruf | Nur `/memberships` unterstützt Paging. Absenzen, Ferienguthaben und Events kommen ungefiltert für **alle Teams des Mandanten** und werden erst im Browser gefiltert (`planningDataService.ts:80`). Skaliert mit Mandanten-, nicht mit Teamgrösse. |
| EF Core | `GetAbsencesAsync` ohne `AsNoTracking()` und ohne `Skip`/`Take`; `DeleteAbsence` lädt die gesamte Absenztabelle, um eine Zeile per Id zu finden; ein SQL-Query pro Teammitglied beim Team-Admin-Speichern. |
| Throttling | **Kein 429-/`Retry-After`-Handling** in beiden Fetch-Clients. `graphClient.ts` stuft 429 sogar als `recoverable: false` ein, zeigt eine Drosselung also als permanenten Fehler. Backend-Graph-Calls sind über die Kiota-Middleware indirekt abgedeckt. |
| Teams-Kontext | Wird **pro HTTP-Request** neu aufgelöst, ohne Caching (~8–10 postMessage-Roundtrips je Snapshot). Ausserhalb eines Teams-Hosts läuft das je Request in zwei 5-s-Timeouts. Die Token-Ebene löst dasselbe Problem bereits korrekt. |
| Profilfotos | Ein Request pro Person, kein Batching — 50 parallele Requests beim ersten Rendern eines 50er-Teams. |
| Timeline | Keine Virtualisierung bei **~22 800 Zellen** (Default) bis **~36 500** (`fullYear`). Treiber ist die unbedingte 12-Monats-Rückschau: `next30Days` erzeugt 395 Spalten, nicht 30. |
| Observability | Die `applicationStartup`-Metrik startet erst nach dem Bundle-Download und wird nirgends exportiert. Die Zeit bis `notifySuccess()` wird nicht erfasst. |

---

## Was bereits gut gelöst ist

Festgehalten, damit ein späteres Refactoring es nicht rückgängig macht: Route-Level Code Splitting
mit Preloading auf Hover/Focus, korrekte Cache-Header (`immutable` für gehashte Assets,
`no-cache` für Entry-Points), sauberes `$select`/`$top`/`nextLink`-Paging auf beiden Ebenen,
serverseitige Caches für Mitglieder und Fotos, paralleles Snapshot-Laden per `Promise.all`,
Request-Dedup im Bootstrap, Token-Caching mit Expiry-Skew, sorgfältige Timeline-Memoisierung und
der Verzicht auf Web-Fonts.

---

## Empfohlene Reihenfolge

| Priorität | Massnahme | Wirkung | Aufwand |
|---|---|---|---|
| **Sofort** | Response Compression aktivieren | ~3,4× weniger Bytes | XS |
| **Sofort** | `content-visibility: auto` auf Timeline-Zeilen | schnellerer Mount | XS |
| Hoch | Locales per `import()` lazy laden | −488 KiB gzip, −40 Requests | M *(eigener EO)* |
| Hoch | `app.initialize()` vor den React-Mount ziehen | Spinner endet ~1–2 s früher | S |
| Hoch | Graph-Approval-Sync parallelisieren oder in Hintergrunddienst | −4 bis −8 s pro Aufruf | M |
| Mittel | Serverseitiger Team-Filter + Paging + `AsNoTracking()` | Payload skaliert mit Team | M |
| Mittel | Teams-Kontext cachen | −8 bis −10 Roundtrips je Snapshot | S |
| Mittel | 429-Handling mit Backoff | Robustheit unter Drosselung | S |
| Niedrig | Foto-Batch-Endpunkt | 50 Requests → 3 | M |
| Niedrig | Zirkularität `vendor ↔ react` auflösen | sauberer Preload-Graph | XS |

Die beiden XS-Massnahmen sind Einzeiler mit unverhältnismässig grosser Wirkung und der natürliche
Startpunkt. Die Localization-Umstellung ist der grösste Einzelgewinn, stellt aber `createTranslator`
auf einen asynchronen Ladepfad um und berührt damit die Bootstrap-Sequenz — sie gehört in einen
eigenen Engineering Order.

Gemäss `AGENTS.md` darf nur eine EO gleichzeitig aktiv sein; keine der Massnahmen sollte umgesetzt
werden, bevor sie in eine EO aufgenommen und diese die aktive ist.
