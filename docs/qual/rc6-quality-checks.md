# RC6 Qualitychecks — Durchführungsprotokoll

Branch `RC6-Qualitychecks`, Stand `b9440ab` (Release 4.0.6 / Release Candidate 6).

Dieses Dokument hält fest, **was geprüft wurde und mit welchem Ergebnis** — nicht, was zu tun ist.
Die offene Arbeitsliste steht in `ROADMAP.md` unter *Next, in order → RC6 quality checks*.

---

## 1. Automatisierte Gates

| Gate | Kommando | Ergebnis |
| --- | --- | --- |
| ESLint | `npm run lint` | **grün** — keine Fehler, keine Warnungen |
| Typprüfung + Build | `npm run build` (`tsc --noEmit` + `vite build` + `release:metadata`) | **grün** — Build in ~8 s |
| Deployment-Validierung | `npm run validate:deployment` | **grün** |
| Sicherheits-Validierung | `npm run validate:security` | **grün** |
| Repo-Hygiene | `npm run validate:repo-hygiene` (Pre-Commit-Hook) | **grün** |
| Release-Konsistenz | `npm run validate:release` | **bedingt grün** — siehe unten |
| Backend-Tests | `dotnet test RppWebApi.Tests` | **nicht ausgeführt** — siehe unten |

### Release-Konsistenz

`validate:release` ist ein Verpackungs-Gate, kein Arbeitskopie-Gate: es liest
`dist/config/runtime-config.js` und schlägt fehl, solange `stamp-runtime-config.mjs` nicht gelaufen
ist. Nach `node scripts/stamp-runtime-config.mjs --env prod` bleibt genau **eine** Meldung übrig:

```
- Could not read the assembly version from MSBuild. Install the .NET SDK, or run this check where `dotnet` is available.
```

Frontend-Seite (`release.json`, gestempelte Runtime-Config, Release-Metadaten, Teams-Manifest)
stimmt auf `4.0.6` / `b9440ab6df83` überein. Die Assembly-Version konnte nicht gegengeprüft werden.

### Backend-Tests

`RppWebApi.Tests` enthält **56 Tests** in 7 Dateien (`HelpControllerTests`, `IcsParserTests`,
`MailboxSyncControllerAuthorizationTests`, `MailboxSyncTextTests`, `MimeCalendarExtractorTests`,
`PlanningControllerAuthorizationTests`, `PlanningStoreSettingsTests`). Sie wurden **nicht
ausgeführt**: in der verwendeten Umgebung ist kein .NET SDK installiert und die Netzwerk-Policy
verweigert den Download (`builds.dotnet.microsoft.com` → HTTP 403). Das Ergebnis dieses Gates ist
damit **unbekannt, nicht grün** — es muss auf einer Maschine mit .NET 8 SDK nachgeholt werden.

---

## 2. Nachkontrolle der offenen Punkte aus der ROADMAP

Geprüft wurde, ob die in `ROADMAP.md` festgehaltenen Befunde am aktuellen Stand noch zutreffen.

### 2.1 Stille Ablehnungen — bestätigt, alle drei bestehen weiter

**`IsUserOwnerOfTeamAsync` lehnt still ab**
`RppWebApi/Services/GraphTeamMembershipService.cs:107-119` ruft `GetRealTeamMembersAsync(teamId)`
ohne `throwOnFailure`. Der `catch (GraphUnavailableException) when (!throwOnFailure)` in Zeile 72
gibt bei einem Graph-Ausfall eine leere Liste zurück; die Besitzprüfung wertet das als „kein
Owner". Die beiden Aufrufer in `RppWebApi/Controllers/PlanningController.cs:539` und `:919`
antworten daraufhin mit `Forbid()` — ein Ausfall erscheint dem Benutzer als Berechtigungsproblem.
Das ist dieselbe Fehlerform, die EO-428 in den Mitgliederlisten behoben hat.

**`apiApprovalRepositories` kollabiert 401 und 403**
`src/repositories/apiApprovalRepositories.ts:81` — `response.status === 401 || response.status === 403 ? "forbidden"`.

**`apiHelpRepository` kollabiert 401 und 403**
`src/repositories/apiHelpRepository.ts:78` — identisches Muster.

Der Zielzustand existiert bereits im Nachbarmodul: `src/repositories/apiPlanningRepositories.ts:65-69`
trennt `401 → "unauthenticated"` von `403 → "forbidden"`, samt Begründung im Kommentar. Der
Fehlercode `unauthenticated` ist in `src/repositories/planningRepositories.ts:18` definiert und
dokumentiert; für die Korrektur der beiden Module ist kein neuer Vertrag nötig.

### 2.2 Membership-Reads in Organisation-A-Grösse — bestätigt

`GraphTeamMembershipService.FetchTeamMembersAsync` (`:143-159`) liest bei einem Cache-Miss die
vollständigen `/members`- und `/owners`-Collections der Gruppe seitenweise mit `Top = 999` aus. Das
ist korrekt und war die Behebung eines echten Defekts, kostet aber bei ~3000 Konten mehrere
Graph-Aufrufe pro Cache-Ablauf (Cache: 5 Minuten, `:28`). Die Besitzprüfung braucht davon genau
einen Datensatz.

### 2.3 Nur im Tenant prüfbar — hier nicht abgedeckt

Die folgenden Punkte der RC6-Liste lassen sich aus dem Repository heraus weder bestätigen noch
widerlegen und bleiben offen:

- **Deployment-Topologie** — welche Installation welchen Teams-Tab bedient (`rpp.example.com`).
- **Gast-Verhalten jenseits des Happy Path** — persönlicher App-Scope, mehrere Teams, kein primäres Team.
- **Safe Browsing** — Chrome-Interstitial auf `rpp-dev-….azurewebsites.net`.
- **Veralteter Browser-Stand nach einem Deployment** — hier fehlt kein Code, sondern ein
  dokumentierter Support-Pfad („zeigt der Info-Tab die ausgelieferte Revision?").

---

## 3. Zusammenfassung

Alle im Repository automatisierbaren Gates sind grün. Nicht grün, sondern **ungeprüft**, sind die
Backend-Tests und die Assembly-Version — beides mangels .NET SDK in der Prüfumgebung. Von den
inhaltlichen RC6-Punkten sind die drei stillen Ablehnungen und der Membership-Read am Code
bestätigt; die vier Tenant-Punkte bleiben ohne Evidenz.
