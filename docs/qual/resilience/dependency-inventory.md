# Abhängigkeits-Inventar (Resilience-Sicht)

Stand: Analyse des Repository-Zustands auf Branch `claude/teams-fault-injection-plan-m9k8kz`.
Diese Datei ist reine Analyse — sie beschreibt, was der Code **tut**, nicht was er tun sollte.

Legende Blast-Radius: **A** = Kernpfad (Timeline/Planung unbenutzbar), **B** = Teilfunktion fällt aus,
**C** = kosmetisch/degradiert.

## 1. Browser (SPA) → externe Abhängigkeiten

| # | Abhängigkeit | Aufrufer im Code | Auth | Timeout | Retry | Blast-Radius |
|---|---|---|---|---|---|---|
| D1 | Microsoft Graph `v1.0` | `src/infrastructure/microsoft365/graphClient.ts:66` (`fetch`) | Teams SSO Bearer | **keiner** | **keiner** | A (nur bei `planningMembershipSource=graph`) |
| D2 | RPP Web API | `src/repositories/apiPlanningRepositories.ts:51` | Teams SSO Bearer + `credentials: include` | **keiner** | **keiner** | A |
| D3 | Teams Host SDK (`app.initialize`, `getContext`, `getAuthToken`) | `teamsApp.ts:58`, `teamsSsoAuthProvider.ts:58/71/95` | — | 3 s / 5 s / 10 s | keiner | A |
| D4 | SharePoint REST (`/_api/web/lists/...`) | `sharePointClient.ts:87` | Teams SSO Bearer | **keiner** | **keiner** | A (nur `planningDataSource=sharepoint`) |
| D5 | Power Automate Flow (SAS-URL) | `powerAutomateApprovalIntegrationRepository.ts:45` | SAS in URL | 30 s (AbortController) | keiner | B (Antrag startet nicht) |
| D6 | Foto-Proxy der API | `src/services/userPhotoService.ts:32` | Bearer | **keiner** | keiner, **negatives Caching für die ganze Session** | C |
| D7 | `/config/runtime-config.js` | `index.html:70` (klassisches `<script>`, **kein `onerror`**) | — | — | — | **A, siehe FP-01** |
| D8 | `/api/health` (Admin-Center-Probe) | `features/app-admin/services/appConfigService.ts:77` | — | 1 Probe mit AbortController | keiner | C |

## 2. RPP Web API → externe Abhängigkeiten

| # | Abhängigkeit | Aufrufer | Auth | Timeout | Retry | Blast-Radius |
|---|---|---|---|---|---|---|
| D9 | Azure SQL / SQL Server (EF Core) | `Program.cs:46`, `Data/EfPlanningRepository.cs` (16× `SaveChangesAsync`) | Connection String / Managed Identity | EF/ADO-Default | **kein `EnableRetryOnFailure`** | A |
| D10 | SQL beim **Start** (`Database.Migrate()`) | `Program.cs:212` | s. o. | — | keiner, ungeschützt | **A — Prozessabbruch, siehe FP-10** |
| D11 | Graph (Members/Owners/memberOf) über Graph SDK 5.0 | `Services/GraphTeamMembershipService.cs:143/152/318` | App-only (`.default`) | Kiota/HttpClient-Default (~100 s) | **Kiota-Default-RetryHandler (einzige Stelle mit echter 429-Behandlung)** | A |
| D12 | Graph Calendar (`/users/{id}/events`) | `Services/OutlookCalendarSyncService.cs:122/167` | App-only | HttpClient-Default | **keiner** | B |
| D13 | Graph Mail (Shared Mailbox) | `Services/MailboxSyncService.cs:182/205/615/635/675/701` | App-only | HttpClient-Default | **keiner** | B |
| D14 | Graph Approvals **beta** `/solutions/approval` | `Services/GraphApprovalService.cs:18` | OBO delegiert | HttpClient-Default | **keiner** | B |
| D15 | Power Automate Flow (serverseitig) | `Services/ApprovalFlowService.cs:55` | SAS in URL | 30 s (`CancelAfter`) | **keiner** | B |
| D16 | Entra ID / Token-Endpunkt | `ITokenAcquisition` (Microsoft.Identity.Web 3.1.0), In-Memory-Token-Cache | Client Secret / MI | Bibliotheks-Default | Bibliotheks-intern | A |
| D17 | Azure AI Foundry + IMDS (Managed Identity) | `FoundryHelpAssistantService.cs`, `FoundryTokenProvider.cs:74` | Managed Identity | HttpClient-Default | **keiner** (IMDS gilt als retry-pflichtig) | C (Help-Tab) |
| D18 | Eingehend: Power-Automate-Callback | `Controllers/ApprovalCallbackController.cs:41` | Shared Secret Header | `HttpContext.RequestAborted` | Wiederholung durch den Flow, **nicht idempotent** | B, siehe FP-08 |

## 3. Was es **nicht** gibt (verifiziert per Suche)

- Kein `$batch` — weder Frontend noch Backend. Das Szenario „Teilfehler im Batch wird als Erfolg
  gewertet“ ist heute **nicht anwendbar**; FI-14 hält es als Regressionswächter fest.
- Kein `Retry-After`-Lesen an irgendeiner Stelle (`grep -r "Retry-After"` → 0 Treffer).
- Kein Polly, kein `AddStandardResilienceHandler`, kein Circuit Breaker, kein Bulkhead.
- Kein `EnableRetryOnFailure`, keine `BeginTransaction` in `EfPlanningRepository`, kein Outbox-Muster.
- Keine Delta-Queries (`deltaLink`), keine Wiederaufnahme abgebrochener Paging-Läufe.
- Keine Health-Prüfung, die eine Abhängigkeit tatsächlich anfasst (siehe FP-11).
- 7 typisierte `HttpClient`s (`Program.cs:64,65,74,79,83,89,93`) — alle mit Default-Timeout (100 s)
  und ohne Resilience-Handler.
