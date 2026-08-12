# Resilience-Analyse und Fault-Injection

Analyse des Verhaltens bei Ausfällen und Störungen der Abhängigkeiten. **Reine Analyse plus
Testartefakte — es wurde kein Produktivcode geändert.**

| Dokument | Inhalt |
|---|---|
| [`dependency-inventory.md`](./dependency-inventory.md) | Alle externen Abhängigkeiten (Graph, eigenes Backend, SQL, Auth, Drittdienste) mit Timeout-, Retry- und Blast-Radius-Angabe |
| [`failure-path-analysis.md`](./failure-path-analysis.md) | Aufrufketten der fünf kritischen Nutzerpfade, jeder Fehlerpunkt FP-01…FP-20 mit `datei:zeile`-Beleg, plus „Behauptung vs. Code“ |
| [`fault-injection-testplan.md`](./fault-injection-testplan.md) | Prüfmatrix FI-01…FI-29: Injektion, Soll-Verhalten, vorhergesagtes Ist-Verhalten, Schweregrad, Durchführungsreihenfolge, Abnahmekriterien |
| `tests/fault-injection/` *(noch nicht implementiert)* | Lauffähiger Harness: Fault-Proxy, Szenariendatei, Browser-Injektor |

## Die fünf Befunde, die zählen

1. **FP-01 — Konfigurationsausfall erzeugt erfundene Daten.** Lädt `/config/runtime-config.js` nicht
   oder ist `apiBaseUrl` ungültig, fällt die App still auf das Mock-Repository zurück und zeigt
   erfundene Personen und Abwesenheiten als echte an. Kein Hinweis, kein Banner. (FI-01)
2. **FP-08 — Genehmigungs-Callback ist nicht idempotent und schreibt in zwei Systeme ohne
   Kompensation.** Ein Wiederholversuch des Flows antwortet 404, obwohl die Entscheidung angewendet
   wurde; ein Fehler zwischen Graph-Aufruf und zweitem DB-Commit hinterlässt verwaiste
   Kalendertermine. (FI-17, FI-18, FI-19)
3. **FP-10 — Datenbankausfall beim Start beendet den Prozess.** `Database.Migrate()` läuft
   ungeschützt vor `app.Run()`; eine kurze SQL-Störung wird zur Neustartschleife, in der auch die
   statische SPA und `/health` ausfallen. (FI-25)
4. **FP-06 — 429 wird als dauerhafter Fehler behandelt.** `Retry-After` wird nirgends gelesen, es
   gibt kein Backoff und keinen Retry; einzige Ausnahme ist der Graph-SDK-Pfad im Backend. Kein
   Retry-Sturm — dafür gibt die App bei jeder Drosselung sofort auf. (FI-02, FI-08)
5. **FP-05/FP-04 — Kein `fetch`-Timeout und kein Paging-Limit.** Ein hängender Aufruf oder ein
   stehengebliebener `nextPageToken` lässt den Tab dauerhaft im Ladezustand — ohne Fehler und ohne
   Wiederholmöglichkeit. (FI-03, FI-04)

## Was gut ist

Nicht alles ist Befund. Diese Stellen halten dem Fehlerfall stand und sollten Vorbild für die
Härtung der übrigen sein:

- `teamsSsoAuthProvider.ts:58/71/91/95` — jeder Aufruf ins Teams-SDK ist mit einem Timeout versehen,
  mit einer Begründung im Code, die zutrifft.
- `EfPlanningRepository.SaveAbsenceAsync:50` — clientseitige Id plus serverseitiges Upsert macht den
  meistgenutzten Schreibpfad idempotent.
- `MailboxSyncService.cs:214` und `PlanningController.cs:445` — ein Graph-Ausfall wird als Ausfall
  gemeldet statt als leeres Ergebnis. Die EO-428-Korrekturen sind echt, sie sind nur nicht überall
  angekommen (FP-03, FP-12, FP-17).
- `GraphTeamMembershipService.cs:374` — begrenzte Paging-Schleife mit Zyklusschutz; genau das fehlt
  im Frontend.
- `powerAutomateApprovalIntegrationRepository.ts:42` und `appConfigService.ts:77` — sauberes
  `AbortController`-Muster, im Repo vorhanden, aber nicht auf den Kernpfaden angewandt.

## Verhältnis zur Governance

Dieser Ordner ist keine Engineering Order und implementiert nichts (`AGENTS.md`: nur eine EO
gleichzeitig aktiv). Er ist die Faktenbasis für eine spätere EO; ein Vorschlag zum Zuschnitt in drei
Pakete steht am Ende des Testplans.
