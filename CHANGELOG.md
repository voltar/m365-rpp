# Changelog

## 4.0.9

- Version: **Release 4.0.9** — `release.json` und `teams-app-package/manifest.json`
  (Friends & Family final). Info-Badge unverändert «Friends & Family».

- Runtime: **`standaloneBrowserUsesMock`** — same deployment artefact can serve mock/demo
  in a plain browser while Teams keeps `api`/`m365`. Enabled on Host Europe
  (`runtime-config-HOSTEUROPE.js`) so `https://rpp.example.com` shows the demo product
  outside Teams without a localStorage hack. Local overrides still win. Docs:
  `docs/deploy/deployment.md`, `docs/deploy/kestrel-hosteurope.md`.
  Mock applies only when `detectHostKind()` is `browser` (not “top-level frame” alone —
  Teams desktop WebViews are top-level and must keep API). Teams packages should use
  `contentUrl` `…/?host=teams` so the tab is detected even without iframe ancestors.
  Chat referrers and `window.microsoftTeams` are not treated as proof of a Teams tab.
  CSP `frame-ancestors` includes New Teams hosts (`*.cloud.microsoft`, `*.microsoft365.com`,
  `*.office.com`) so the tab is not blocked with “refused to connect”.

- Docs: **Release Notes 4.0.9 — Friends & Family (final)** für Endnutzer DE/EN
  (`docs/release-notes/4.0.9-friends-family.*`); Kurzverweis in `friends-family.*`.
  Help-KB-Inventar und Alignment-Test ergänzt.

## 4.0.7

- Help: Wissensbasis neu kuratiert (DE/EN) für Friends & Family; neu
  `docs/user/team-admin.*` mit `audience: team-owner`. Mock-Hilfe und Foundry-Kontext
  geben Owner-Anleitungen nur an `teamLead`/`appAdmin`; Employees erhalten einen klaren
  Hinweis statt Admin-How-to. Starter-Fragen für Owner im Hilfe-Panel. Release Notes
  `friends-family`. Meta: `help-assistant-knowledge-base.md`.

- Security: **EO-459 Team-scoped planning reads + write target membership.**
  `GET /absences`, `/vacationbalances`, `/events` require team context and M365 membership
  (same semantics as memberships: `428 noTeamContext`, `403` non-member, `502` Graph down)
  and return only rows for Graph members of that team. Writes (self or owner) harden:
  owner needs team context; target must be a team member; self with team context must be
  a member. Frontend sends `teamId` on those list calls. Tests in
  `PlanningControllerAuthorizationTests`. Docs: EO-459, architecture, onboarding/release
  checklist already separate.

- Docs: **EO-600.1** als Done nachgezogen (Halbtags-Fix `c474b0f`); **EO-600** und ROADMAP
  markieren Defect 2 + Identity als erledigt, offen bleibt nur Kalenderdatum/Zeitzone
  (FR-600.1–600.3).

- Ops: Docker local stack auf EO-427/EO-458 gebracht — API-Image-Build mit
  Repo-Root-Context und `release.json`, `docker-compose.api.yml` startet Postgres
  mit und defaultet `Planning:Provider=postgres`, Doku unter
  `docs/distribution/Docker-development-setup.md` aktualisiert.

- Fix mailbox sync: **No employee match for user@…** despite person in RPP — matching
  used only `Member.Mail` from memberships; on Host Europe that field is often empty
  (Graph membership without host team) and guests use UPN/mail on another identity.
  Resolve address via Graph (`/users/{mail|upn}`) and match Entra **object id** to
  assignments (EO-600 identity note).

- UX: Abwesenheit — **Outlook-Sync standardmässig aus**; Team-Kapazität Label
  **Abdeckung** (DE) / **Coverage** (EN) statt Auslastung/Utilization.
  Docs: Mailbox-Sync auf Host Europe braucht `Mail.ReadWrite` + AAP auf der
  **Voltar**-App (Azure-Grant gilt dort nicht).

- Fix: **`approvalFlowStartFailed`** — Graph `Location`-Header oft relativ (`/beta/...`);
  HttpClient ohne BaseAddress konnte die Operation nicht pollen. Relative URLs werden auf
  `https://graph.microsoft.com` aufgelöst; 201 mit Item-Id unterstützt; bessere OBO-Logs.
  Vite: Circular-Chunk-Warnung `vendor ↔ react` behoben (React bleibt im `vendor`-Chunk).

- Fix: **Genehmigung grün, aber leer unter „Meine Anträge“**. Die Liste filterte nach
  Host-Team-Id, gespeichert war oft interner Team-Name/`primaryTeam` → null Treffer.
  Abfrage matched jetzt Host-Id, interne Team-Ids und Anzeigenamen; Submit speichert
  Host-Id als Fallback; Approval-Client sendet `X-RPP-Active-TeamId`. Hinweis: In der
  Teams-App „Approvals“ sieht der **Genehmiger** den Antrag unter Eingehend.

- Fix Host Europe / Postgres: **Abwesenheit und Genehmigung speichern HTTP 500**.
  JSON-Datumsfelder kommen als `DateTimeKind.Unspecified`; Npgsql lehnt das für
  `timestamptz` ab (SQL Server nicht). `SaveVacationRequest` / `SaveAbsence` normalisieren
  auf UTC; zusätzlich `Npgsql.EnableLegacyTimestampBehavior` für Postgres; `Forbid()` bei
  Absence-Writes liefert echtes 403 mit Code; Fehlercodes `absenceSaveFailed` /
  `vacationRequestSaveFailed` / `approvalPersistFailed` statt nacktem `(unknown)`.

- Genehmigungsantrag in Teams Approvals: **Datumsformat und Tageshälften lokalisiert** (z. B.
  `13.11.2026 – 16.11.2026` statt `2026-11-13 fullDay – 2026-11-16 fullDay`). Sprache über
  `Accept-Language` aus der SPA-UI-Locale; `fullDay` entfällt bei ganzen Tagen.

- Fix Regression: **Genehmigung beantragen** schlug fehl mit `(unknown)` und leerem Genehmiger.
  Ursachen: EO-456 seedete keinen Standard-Genehmiger; Team-Admin-Details sind owner-gated und
  wärmten den Client-Cache für normale Mitglieder nie; API-Fehlercodes (502/400) kamen als
  undifferenziertes `unknown` an. Neu: `GET /api/planning/approval-options` (mitgliedslesbar),
  Fallback Default-Genehmiger (effektiv → Team-Default → Team-Lead → erster M365-Owner), Seed setzt
  den ersten Owner, Formular lädt Optionen asynchron und blockiert Submit ohne Genehmiger, API
  lehnt leeren Approver mit `approverRequired` ab und liefert maschinenlesbare Codes.

- Fix EO-415: **Firma und Standort** werden zuverlässig aus Microsoft Graph gelesen und in der UI
  angezeigt. Der Members-Endpoint liefert `companyName`/`officeLocation` oft leer — die API reichert
  sie über `/users/{id}` an (`User.Read.All`). Membership-DTOs tragen die Rohwerte und Defaults;
  das Frontend mappt `location` von der Membership auf `ResourceSummary` (Personenkarte, Reports,
  Details). SharePoint-Provider wendet dieselben Profilwert-Mappings an wie EF.

- Docs/Ops: Graph-**Application**-Permissions und Client-Secret-Value für Planning dokumentiert
  (Host Europe Feldbefund). Neu: `scripts/configure-graph-planning.ps1` (`GroupMember.Read.All`,
  `Group.Read.All`, `User.Read.All` + Admin Consent, `-Profile example|azure`, `-VerifyOnly`).
  Runbook in `docs/deploy/kestrel-hosteurope.md`, `deployment.md`, Onboarding-Playbook und
  `microsoft-365-authentication.md` (Secret ID ≠ Value; Symptomtabelle Team-Picker / Unknown User).

- Angehoben: **Release 4.0.7**. Friends & Family bleibt unverändert; die neue Version hebt die
  Release-Kennung und das deploybare Artefakt auf 4.0.7 an.

## 0.1.0

- Implementiert, zur Abnahme bereit: **EO-458 PostgreSQL als relationales Engine** (ADR-007).
  `Planning:Provider=postgres` (Aliase `postgresql`, `npgsql`) registriert EF Core mit Npgsql und
  demselben `EfPlanningRepository` wie SQL Server. `sql` unverändert mit `Migrate()`. Postgres v1
  erzeugt das Schema per `CreateTables`, wenn die DB noch leer ist. Health meldet Engine und Host.
  Gefilterter Unique-Index für Primary-Assignments ist provider-aware. Optional
  `docker-compose.postgres.yml` für lokal. Tests für Provider-Parsing erweitert.

- Abgenommen 2026-08-08: **EO-455 Host Adapter (ADR-004)** und **EO-456 Default-RPP-Team
  (ADR-005)**, verifiziert auf rpp-dev (Team RPP-Seeding). Seed-Fix: bestehende Primary-Zuordnung
  global nicht verletzen.

- Implementiert, zur Abnahme bereit: **EO-455 Host Adapter (ADR-004)**. Ein SPA-Artefakt bedient
  die Hosts `teams`, `browser` und `sharepoint` über `src/infrastructure/host/`. Detection läuft
  ohne spekulativen Teams-SDK-Aufruf; SDK und Teams-Theme laden nur im Teams-Adapter. Auth,
  Kontext (session-gecacht), Theme, Chrome und Deeplinks laufen über den Adapter — `AppShell`,
  `currentUser`, `vacationRequestDeepLink` und `createMicrosoft365ClientFoundation` sind umgestellt.
  Der SharePoint-WebPart-Einstieg setzt den Host-Bootstrap; Demo-Header/Rail nur ausserhalb Teams im
  Mock-Modus. Datenprovider-Achse unverändert.

- Implementiert, zur Abnahme bereit: **EO-456 Default-RPP-Team beim ersten Host-Kontakt (ADR-005)**.
  Hat ein M365-Host noch keine internen Planungsteams, legt `EfPlanningRepository` beim scoped
  Memberships-/Managed-Teams-Read genau ein Team `Alle - {M365-Anzeigename}` an und weist alle
  Graph-Mitglieder und -Gäste zu. Wer global schon ein Primary-Team hat (Unique Index
  `UserId`+`IsPrimary`), wird am Default-Team **non-primary** gehängt — sonst knallt
  `SaveChanges` und `/memberships` sowie `/teamadmin/teams` liefern HTTP 500 (Feldbefund HAR
  2026-08-08, Team RPP-Seeding). Graph-Ausfall erzeugt keine leere Struktur (Retry möglich).
  Kein Host-Fallback (EO-428), kein Dauer-Sync späterer Joiner. InMemory-Tests + User/FAQ-Docs
  angepasst.

- Implementiert, zur Abnahme bereit: **EO-453 ehrliche Konfigurationsfehler und Drosselungsresilienz**.
  Eine fehlende, syntaktisch defekte oder für den gewählten Provider unvollständige
  `runtime-config.js` darf nicht mehr auf plausible Mockdaten zurückfallen; die App stoppt vor der
  Repository-Komposition in einem lokalisierten Fehlerzustand. Im Browser durch Abbruch des
  Config-Requests verifiziert. Die direkten Frontend-Clients und alle typisierten Backend-HttpClients
  teilen neu eine begrenzte Retry-Policy für idempotente Aufrufe: 429/502/503/504, `Retry-After`,
  exponentieller Backoff mit Jitter, drei Versuche und maximal zehn Sekunden Wartezeit. Schreibvorgänge
  werden bewusst nicht automatisch wiederholt. Acht Node-Resilience-Tests, drei Handler-Tests und alle
  70 Backend-Tests sind grün.

- Implementiert, zur Abnahme bereit: **EO-452 Startpayload und Genehmigungs-Latenz**. Englisch bleibt
  als synchroner Fallback im Entry-Graph, alle anderen 39 Sprachpakete werden nur für die tatsächlich
  aufgelöste Teams-Sprache dynamisch geladen. Der initiale Build-Graph sinkt damit von 2 474 KiB roh /
  725 KiB gzip auf 900.3 KiB roh / 253.6 KiB gzip; `validate:deployment` verhindert die Rückkehr
  eager geladener Locales. Das ASP.NET-Core-Backend komprimiert statische Assets neu mit Brotli/gzip,
  gegen Kestrel mit `Content-Encoding: br` verifiziert. Die bis zu 20 Graph-Approval-Abfragen laufen
  nicht mehr linear, sondern mit maximal vier parallelen delegierten OBO-Aufrufen; die anschliessenden
  EF-/Outlook-Schreibvorgänge bleiben bewusst sequenziell. Frontend-Gates und alle 67 Backend-Tests
  sind grün.

- Geliefert und danach geparkt: **EO-430 Etappe 1 — SharePoint Online als serverseitiger Planungsspeicher, Lesepfad.** Eine Installation kann die Planungsdaten neu in den SharePoint-Listen des Kunden führen statt in SQL Server; `Planning:Provider` wählt den Speicher beim Start, ohne Standardwert im Code und ohne stillen Rückfall. Der serverseitige Provider bedient **alle Leseanfragen** und ist gegen den Entwicklungstenant belegt — app-only mit Zertifikat und `Sites.Selected`, also ohne jedes Geheimnis in einer Konfigurationsdatei. Schreibvorgänge sind nicht gebaut und werfen benannt; `Planning:Provider = sharepoint` verweigert den Start, solange nicht ausdrücklich ein unvollständiger Provider zugelassen wird, damit keine Installation versehentlich darauf hochfährt. Etappen 2–4 (Schreiben mit ETag, Kompensation, Drosselung, Schemaprüfung beim Start, Tests) sind spezifiziert und bewusst zurückgestellt, bis feststeht, ob das Profil je benutzt wird — der Lesepfad ist der Teil, der die Machbarkeit beweist. **Vier Defekte kamen erst aus dem echten Tenant**, keiner davon durch Kompilieren oder Parsen auffindbar: (1) `Get-PnPField` trifft auch auf **Anzeigenamen**, wodurch das Provisioning-Skript eingebaute Spalten für eigene hielt — `Organisations.Name` und `Locations.Name` wurden nie angelegt, und `-RemoveRetiredFields` hätte die frisch erzeugte `SubstitutePerson` gelöscht, weil sie „Substitute" heisst; nur ein Treffer auf den **internen** Namen zählt jetzt. (2) Die Events-Vorlage besitzt eigene Spalten `Duration` und `EndDate`; beim Aufräumen zeigte sich, dass die Tagesanzahl aus Start, Ende und den Tageshälften folgt — sie ist ein **berechneter Wert** und wird gar nicht mehr gespeichert, die Formel liegt neu in `AbsenceDuration` und wird von Postfach-Sync und Provider geteilt. Aus demselben Grund fällt `StartDate` weg: `EventDate`/`EndDate` sind das System of Record, und die Kalenderansicht liest ohnehin diese. (3) Zwei Projektionen nannten `ModifiedAt` auf Listen, die `LastModified` führen — danach wurden **alle 16 maschinell** gegen das Schema abgeglichen statt auf den nächsten Fehlversuch zu warten. (4) **Die Identitätsquelle war falsch dokumentiert**: `UserId.NameId` ist unter demselben Issuer eine Microsoft-Account-PUID, nicht die Entra-Objekt-Id, und bei Gästen leer — richtig ist `AadObjectId.NameId`, das für Mitglieder wie Gäste die Objekt-Id trägt. Die Issuer-Prüfung, als Schutz genau dagegen geschrieben, hat nicht ausgelöst: der Issuer stimmte, das Feld war falsch. Beide Provider prüfen jetzt zusätzlich, ob der Wert als GUID parst. Dazu am Schema: Item-Versionierung wird auf jeder Liste gesetzt **und geprüft** (10 Versionen; sie ist der Audit-Trail und ruhte zuvor auf einer Plattform-Vorgabe, die niemand nachsah), das Titel-Feld ist auf allen drei Kalendern sichtbar und pflichtig, weil ein verstecktes `Title` einen Handeintrag als leeren Block im Monat zeichnet. Neu ist `scripts/reset-sharepoint-lists.ps1`, das die Listennamen aus dem Provisioning-Skript liest statt sie zu duplizieren, standardmässig trocken läuft und vor dem Löschen die Site-URL abtippen lässt. **Offen, falls das Profil je benutzt wird:** `Type` bleibt Freitext, ein Handeintrag mit unbekanntem Typ landet als `otherAbsence` statt abgewiesen zu werden.

- Ausgeliefert: **Release 4.0.6 / Release Candidate 6**. Der Sprint schliesst mit EO-424 (beta), EO-427, EO-428, EO-429 und EO-450; EO-451 bleibt ohne Umsetzung geschlossen, Stufe 4 verworfen, Stufen 1–3 bedarfsgetrieben. Der Info-Badge nennt neu «Release Candidate 6» — deutsch wie englisch, die englische Fassung sagte zuvor «Product info» und damit etwas ganz anderes.

- Behoben: **Mitgliederlisten wurden nur eine Seite tief gelesen**. `Groups[id].Members.GetAsync` liefert die erste Seite, Graph reicht den Rest über `@odata.nextLink` nach — dem folgte niemand. Bei rund 3000 Konten heisst das: Wer später hinzukam, existierte für das Zugangstor nicht und wurde abgewiesen. Die Wirkung sah aus wie ein Berechtigungsproblem, denn Owner stammen aus dem separaten `/owners`-Aufruf und standen immer auf Seite eins — Owner sahen alles, Gäste nichts, und im frisch angelegten Team mit drei Personen funktionierte beides. Neu wird `nextLink` für Mitglieder und Owner gefolgt, mit 999 statt 100 pro Seite und einer Schleifenbegrenzung. **Nebenwirkung:** Der erste Aufruf nach Cache-Ablauf liest jetzt tatsächlich die ganze Gruppe und dauert entsprechend länger; die Abfrage einzugrenzen steht auf `RC6-Qualitychecks`.

- Implementiert: **EO-428 Team-Kontext ausdrücklich auflösen, Standardteam entfernen**. Fehlte der Team-Kontext, tat die API so, als arbeite der Aufrufer in einem bestimmten Team — der Wert stand fest verdrahtet in `appsettings.json`. Der persönliche App-Bereich hat keine `groupId`, dort griff das also **immer**; wer dem unterstellten Team nicht angehörte, bekam einen Berechtigungsfehler für ein Team, nach dem er nie gefragt hatte. Genau das war der Feldbefund vom 26.07. Die Auflösung kennt jetzt nur noch Query-Parameter und Kontext-Header, bewusst keinen dritten Schritt: ohne Team antwortet die API mit HTTP 428 und dem Code `noTeamContext`. Der bekam einen eigenen `RepositoryErrorCode` und einen eigenen Bootstrap-Zustand — weder `forbidden` (Berechtigungsproblem, jemand anders muss handeln) noch `empty` (ein Plan ohne Personen), sondern eine fehlende Auswahl, die der Benutzer selbst treffen kann. Dabei kam heraus, dass der Rückfall auch eine **Lücke verdeckte**: ohne Team hätte `GetTeamMemberships` die Mitgliedschaften ungefiltert gelesen; das ist jetzt zu. Und dieselbe Tenant-Id steckte an zwei weiteren Stellen im Frontend, die das EO nicht kannte — in `teamsSsoAuthProvider` und `graphTeamMembershipProvider`, beide als «local development fallback» bezeichnet und beide in Produktion aktiv, sobald der Teams-Kontext fehlte. Neu beantwortet `GET /api/planning/my-teams` die Frage «welches Team» aus Graph (`/users/{id}/memberOf`, gefiltert auf tatsächlich als Team provisionierte Gruppen, sonst stünden Verteilerlisten zur Auswahl) und markiert das Primärteam; ein einzelnes oder ein primäres Team wird ohne Rückfrage übernommen, gefragt wird nur bei echter Mehrdeutigkeit. Die Wahl liegt nach Benutzer getrennt im Browser und ist reine Bequemlichkeit — der Server prüft jede Anfrage weiterhin gegen die echte Mitgliedschaft. Gäste sind neu ausdrücklich nie Team-Administratoren: Microsoft 365 verhindert das ohnehin, aber als Nebenwirkung, die sich mit jeder Änderung an der Prüfung still hätte drehen können; der Test riggt die Ownership-Prüfung bewusst auf «ja» und fällt um, sobald die Regel verschwindet. Jede Auflösung protokolliert ihre Herkunft (Query, Header, unresolved). 49 Tests.

- Abgenommen: **EO-424 Inbound-Outlook-Sync — als Beta-Funktion**. Ein aus Microsoft 365 weitergeleiteter Termin wurde gelesen, geparst, einer Person zugeordnet und als Abwesenheit mit `Source = "outlook-mailbox"` geschrieben. Der Bereich im App Admin Center trägt jetzt ein Beta-Kennzeichen und einen Hinweis, importierte Abwesenheiten zu kontrollieren (zwei neue Schlüssel, DE/EN gesetzt, übrige 36 Locales über `locales:fill`). Beta aus zwei Gründen, beide bewusst: Erstens ist **ein Pfad geprüft, nicht der Raum** — ein Postfach empfängt, was die Welt ihm schickt, und alle vier Defekte der Abnahme kamen aus genau diesem Rand, nicht aus dem Entwurf. Zweitens ist die **Wartungsfläche gross für das, was dabei herauskommt**: dieser eine Komfortpfad besitzt MIME-Parsing, iCalendar-Parsing, Zeitzonen, Identitätsauflösung, Dublettenerkennung, app-only Graph-Authentifizierung und eine Exchange-Zugriffsrichtlinie — damit jemand eine Abwesenheit nicht zweimal erfasst. Das Kennzeichen ist deshalb kein Qualitätsvorbehalt gegen den Code, sondern ehrliche Erwartungssteuerung und ein gesetzter Entscheidungspunkt: bei weiteren Formatdefekten den unterstützten Pfad verengen oder die Funktion zurückziehen, nicht verbreitern. Unabhängig davon in EO-424 vermerkt: das Postfach sollte nur authentifizierte Absender annehmen — die Anwendung prüft, ob der Absender zu einem Mitarbeiter passt, aber nicht, ob er echt ist.

- Behoben: **EO-424 legte nie eine Abwesenheit an**. Beim ersten echten Tenant-Lauf scheiterte jede Erstellung mit „An error occurred while saving the entity changes" — `Comment` ist `nvarchar(500)`, und die `DESCRIPTION` einer weitergeleiteten Einladung überschreitet das mühelos, sobald Beitrittslinks und zitierter Text angehängt sind. `IcsUid` (255) und der 1:1-Betreff-Fallback für `Type` (50) hatten dieselbe Lücke und werden mitgekappt; das Kappen ist deterministisch, eine gekürzte UID findet ihre Abwesenheit also bei einem späteren Update oder einer Absage weiterhin. Dazu die eigentliche Ursache dafür, dass daraus ein Rätsel wurde: protokolliert war nur `ex.Message`, und das ist bei einer `DbUpdateException` immer derselbe Satz — Spalte, Constraint und Wert stecken in der inneren `SqlException`. Die Kette wird jetzt ausgeschrieben. Dieselbe Fehlerklasse wie der still geschluckte 403 aus `2b860fa`: ein Fehlschlag wird als Tatsache gemeldet, ohne Begründung. Beide Textbelange liegen neu in `MailboxSyncText`, 9 Tests decken sie ab, 46 gesamt. Nebenbei geklärt: der hartnäckige HTTP 403 war ein **zwischengespeichertes Token**, kein Konfigurationsfehler — es war vor der Zustimmung zu `Mail.ReadWrite` ausgestellt worden und trug die Rolle nicht; ein Neustart der App Service reicht. Noch offen: ein fehlgeschlagener MIME-Abruf sieht im Status genauso aus wie eine Nachricht ohne Kalenderteil, weshalb die übersprungene Google-Einladung weiterhin unerklärt ist.

- Angehoben: **Release 4.0.6**. Der ausgelieferte Inhalt unterscheidet sich von dem, was im Tenant bereits als 4.0.5 liegt — der Info-Tab zeigt neu `4.0.6` statt `RC5`, und das PROD-Template wird nicht mehr mitgeliefert. Dieselbe Nummer für anderen Inhalt zu vergeben wäre genau die Verwechslung, gegen die EO-427 gebaut wurde. `teams-app-package/rpp-teams-app-v4.0.6.zip` entstand aus dem 4.0.5-Paket durch Austausch von `manifest.json` und sonst nichts, mit unverändertem Container-Profil und unveränderter App-`id` — Teams aktualisiert die App damit an Ort und Stelle, statt einen zweiten Katalogeintrag anzulegen. Das 4.0.5-Paket bleibt für den Rückweg liegen.

- Implementiert: **EO-427 Release-Versionierung und reproduzierbares Packaging**. Die Version, die ein Benutzer zu sehen bekam, entstand bisher aus vier voneinander unabhängigen, handgepflegten Strings, die kein Buildschritt abglich — genau deshalb konnten sie auseinanderlaufen, bis am 26.07.2026 ein für den Tenant bestimmtes Artefakt mit `planningDataSource: "mock"` bereitlag und `/health` dauerhaft `1.0.0` meldete. Neu ist `release.json` im Repo-Wurzelverzeichnis die einzige von Hand geschriebene Versionsangabe: `RppWebApi.csproj` liest sie beim Auswerten des Projekts (ein fest eingetragenes `<Version>` bricht den Build jetzt mit einer Fehlermeldung ab statt still `1.0.0` zu liefern), `scripts/stamp-runtime-config.mjs` stempelt sie samt Commit in `dist/config/runtime-config.js`, `write-release-metadata.mjs` schreibt sie nach `dist/release.json`. Das Teams-Manifest bleibt handgepflegt, wird aber geprüft — dafür liegt es erstmals als `teams-app-package/manifest.json` im Repo, was `docs/deployment.md` schon länger behauptete. `npm run package:api -- --env prod` ist neu der einzige Weg zu einem deploybaren Artefakt und führt die ganze Kette aus: bauen, stempeln, drei Validierungen, sauberes Spiegeln von `dist/` nach `RppWebApi/wwwroot/` mit anschliessendem byteweisem Vergleich beider Bäume, `dotnet publish` mit `-p:SourceRevisionId`, ZIP über `scripts/make-zip.py`. Die Umgebung **muss** benannt werden; der frühere stille Standard „was gerade in `public/config` lag" war die eigentliche Ursache des Mock-Artefakts. `public/config/runtime-config.js` bleibt der Entwicklungsstandard auf Mock und wird beim Packen nie gelesen. Zwei Nebenwirkungen: `releaseVersion` und `sourceRevision` sind aus allen Templates entfernt, weil sie gestempelt werden — im Dev-Lauf zeigt die App dort jetzt ehrlich `local`; und `validate-deployment.mjs` wertet die Runtime-Config in einer Sandbox aus, statt auf Text zu vergleichen, weil die gestempelte Datei JSON-Quoting hat und die alten `planningDataSource: "api"`-Textprüfungen sonst lautlos nie wieder gegriffen hätten. Bewusst **nicht** an die Versionskette gehängt: `package.json` `version` (das ist die npm-Paketversion, nicht das Release) und der Info-Seiten-Badge — der ist eine Endbenutzer-Kommunikation und soll einen Namen zeigen, den man weitererzählen kann, nicht `4.0.5`.

- Geschlossen: die **Formatlücke in EO-424**, die die User Story des EO unerfüllbar machte. `MailboxSyncService` akzeptierte Kalenderdaten nur als Dateianhang mit Endung `.ics` und stieg bei `hasAttachments: false` sofort aus — genau die Form, in der eine aus Outlook weitergeleitete Terminserie ankommt: Exchange liefert eine Besprechungsanfrage, deren Kalenderdaten die Nachricht selbst sind, und Outlook im Web bietet gar kein «als iCalendar weiterleiten» an. Der Dienst sammelt die Nutzdaten jetzt über zwei Wege: erst die `.ics`-Anhänge wie bisher, und wenn dabei nichts herauskommt, das rohe MIME (`GET /messages/{id}/$value`), aus dem der bereits vorhandene, bis dahin unverdrahtete `MimeCalendarExtractor` den ersten `text/calendar`-Teil zieht (`base64` und `quoted-printable`). Weg 2 läuft auch für Nachrichten *ohne* gemeldete Anhänge — ihn am Anhangs-Flag aufzuhängen hätte den Fehler erhalten. Der zweite EO-Kandidat, statt des Posteingangs den Postfachkalender zu lesen, wurde verworfen: er verlangt zusätzlich `Calendars.Read`, eine Änderung am Provisioning-Script und automatische Einladungsannahme am Shared Mailbox, also eine zweite Runde Tenant-Administration für einen Fall, den Weg 2 bereits abdeckt. Zwei Verhaltensänderungen fallen dabei an: Fehlt dem Kalenderteil die Eigenschaft `ORGANIZER` — bei einem einfachen weitergeleiteten Termin gab es nie eine Besprechung zu organisieren —, greift die Zuordnung auf den Absender zurück; `ORGANIZER` gewinnt weiterhin, wenn vorhanden, damit die fremde Besprechung ihrem Eigentümer zugeschrieben bleibt. Und ein nicht parsbarer Kalenderteil zählt jetzt als `skipped` samt Herkunftsangabe, statt den Eintrag ganz ohne Aktion zu lassen — auf dem Statusbildschirm war das bisher nicht von «Nachricht nie angesehen» zu unterscheiden, dieselbe Klasse Fehler wie der still geschluckte `403`. 13 neue Tests für `MimeCalendarExtractor` und `IcsParser` (letzterer hatte keine).

- Implementiert: **EO-429 Link-Vorschau** für die öffentliche Demo. `index.html` bekommt Open-Graph- und Twitter-Card-Tags, `description`, Favicon und `apple-touch-icon`; ausgeliefert werden `og-card.png` (1200×630, 91 KB, Kuhglocke in der linken Bildhälfte), `favicon.ico` (mehrere Grössen) und `apple-touch-icon.png` (180×180, weiss unterlegt, weil iOS Transparenz schwarz füllt). Die Tags sind **statisch** und das muss so sein: Link-Crawler führen kein JavaScript aus, können also weder React-Rendering noch `runtime-config.js` lesen, und `og:image` verlangt eine absolute URL. Die dadurch nötige feste Herkunft `https://rpp.example.com` ist eine **dokumentierte Ausnahme zu ADR-003** — nur diese Installation wird je als Link geteilt, die Teams-gehosteten liegen hinter Anmeldung. Beim Bauen der Icons zeigte sich: beide RPP-Logodateien haben das Transparenz-Karomuster als Pixel eingebrannt, der Alphakanal ist durchgehend opak; der Generator unter `assets/branding/social/` rechnet das weg.

- Gehärtet: **EO-424 Inbound-Outlook-Sync** vor der Aktivierung. Drei Befunde aus der Durchsicht: (1) `MailboxSyncController` trug nur `[Authorize]` und dokumentierte im Klassenkommentar eine App-Admin-Beschränkung, die nirgends geprüft wurde — jeder angemeldete Benutzer hätte Sync-Status samt Nachrichtenbetreffs und Personen-Ids lesen, einen Sync auslösen und die Postfachadresse ändern können; alle vier Routen prüfen jetzt die Rolle über das neue `AppAdminAuthorization`, das auch `PlanningController` nutzt. (2) `MailboxSyncService` wird über `AddHttpClient` registriert und ist damit transient, `LastSyncResult` und `IsRunning` lagen aber als Instanzfelder darauf — der Status-Endpunkt konnte einen geplanten Lauf nie anzeigen und die «läuft bereits»-Sperre sah Läufe anderer Instanzen nicht; der Zustand liegt jetzt im Singleton `MailboxSyncState` mit echter Sperre und einer auf 20 Zyklen begrenzten Historie. (3) `GET /api/admin/mailbox-sync/log` fehlte (FR-424.9), jetzt paginiert vorhanden. Dazu `MailboxSync`-Abschnitt in `appsettings.json` (Enabled bewusst false) und `scripts/configure-mailbox-sync.ps1`, das Entra-Berechtigung, Exchange Application Access Policy und Aktivierung in einem Lauf erledigt — und die Aktivierung **nur** ausführt, wenn die Policy verifiziert ist (Granted fürs Shared Mailbox, Denied für ein Kontrollpostfach), weil app-only `Mail.ReadWrite` sonst tenantweit gilt. 6 neue Tests, 24 gesamt. Noch offen: die Policy-Verifikation im Tenant und damit die Aktivierung.

- Geändert: die Hilfe ist ein **rechtes Seitenpanel statt eines Arbeitsbereich-Tabs** (EO-450 FR-450.8, angepasst). Der Tab «Hilfe ?» entfällt samt Route, `RouteKey`-Eintrag und Lazy-Import; an seiner Stelle steht eine Fragezeichen-Schaltfläche am Ende der Tab-Leiste, die einen Fluent-UI-`OverlayDrawer` über der aktiven Seite öffnet. Grund: ein Tab ersetzt genau die Seite, über die gefragt wird — «Weshalb ist das hier rot?» ist nur beantwortbar, solange das Rote sichtbar bleibt. Zwei Vereinfachungen fallen dabei ab: die Sonderlogik „letzte besuchte Fachseite merken" in `AppShell` entfällt, weil der Drawer die Route nie wechselt und der Seitenkontext damit schlicht die aktive Route ist; und `PlaceholderPage` verliert drei nur für den Hilfe-Tab existierende Props. Die Chat-Oberfläche liegt neu in `HelpChat`, der Drawer in `HelpPanel`, beide code-split und erst beim Öffnen geladen, mit Prefetch bei Hover oder Fokus. Fluent liefert Fokusfalle, Escape und Animation, es wird kein eigenes Overlay gepflegt. Zwei neue Lokalisierungsschlüssel (DE/EN, übrige Locales über `locales:fill`).

- Abgeschlossen: **EO-450 Help Assistant v1** (§8 Schritt 3 und Abnahme). Foundry-Ressource `rpp-help-ai` (AIServices S0, Switzerland North) mit Projekt `rpp-help`, Deployments `rpp-help-chat` (gpt-5-mini) und `rpp-help-embedding` (text-embedding-3-large), Vector Store `rpp-kb-user` mit den 24 kuratierten Wissensdateien (24/24 indexiert) und Agent `rpp-help-assistant` mit File Search und der Systemanweisung aus §5. Rollen nach Least Privilege: *Foundry Agent Consumer* für die Web-App-Identity auf Projekt-Scope — darf Agenten aufrufen, aber weder anlegen noch ändern. Alle sechs Abnahmefragen aus FR-450.9 werden mit Quellenangabe aus der Wissensbasis beantwortet, Negativtests verweigern sauber ohne Hinweis auf interne Doku, und der Seitenkontext aus FR-450.5 ist belegt («Weshalb ist das hier rot?» auf Team-Kapazität liefert die Kapazitätsregeln mit `capacity.de.md` als Quelle). Ein zweiter Vector Store `rpp-kb-marketing` liegt bereit, ist v1 aber bewusst nicht am Agenten — File Search erlaubt ohnehin nur einen Store pro Agent, und die Abnahme misst gegen die reine Benutzer-Wissensbasis.

- Korrigiert: `FoundryHelpAssistantService` gegen den echten Foundry-Contract, verifiziert am 2026-07-30 gegen die Live-Ressource. Vier Abweichungen vom ungeprüften Stand: der Aufruf geht an `{project}/openai/v1/responses` statt an `/assistants/{id}/responses?api-version=2025-05-01`; der Agent wird über `agent_reference` mit **Namen** referenziert (Foundry-Agenten haben keine GUID mehr), weshalb `HelpAssistant:AgentId` zu `AgentName` wurde; das Feld `instructions` ist bei gesetzter Agent-Referenz **verboten** („Not allowed when agent is specified"), der Seitenkontext läuft daher als führende `system`-Nachricht im `input`; und Input-Items brauchen explizites `type: "message"`, wobei wiedergegebene Assistant-Beiträge `output_text` samt `annotations`-Feld verlangen statt `input_text` — ohne diese Korrektur wäre jede Folgefrage im Chat gescheitert. Antwort- und Zitat-Auswertung blieben unverändert gültig.

- Implementiert: Tab «Hilfe ?» und Help-Assistant-Endpunkt (EO-450 §8 Schritte 4–5). Frontend: neue Route `help` mit Fluent-UI-Chat, sechs Einstiegsfragen aus EO-450 §1, Schaltfläche «Hilfe zu dieser Seite» (übergibt die zuletzt besuchte Fachseite, nicht den Hilfe-Tab selbst), Quellenangabe mit Sprung auf die genannte RPP-Seite und «Hilfreich / Nicht hilfreich» pro Antwort; code-split als eigener Chunk, hell/dunkel und responsiv. Schichtung eingehalten: die Komponente spricht ausschliesslich mit `HelpRepository` — `mockHelpRepository` (Demo-Modus, ohne Backend nutzbar) oder `apiHelpRepository`, das die aktive Team-ID selbst auflöst, damit die UI die Microsoft-365-Infrastruktur nicht anfasst. Backend: `POST /api/help/chat` und `POST /api/help/feedback` unter `[Authorize]`, `FoundryHelpAssistantService` mit Managed-Identity-Token über den Plattform-Identity-Endpunkt (kein zusätzliches NuGet-Paket, kein Schlüssel in Konfiguration oder Artefakt) und `FallbackHelpAssistantService`, solange die Foundry-Ressource fehlt. 47 neue Lokalisierungsschlüssel in DE/EN, übrige 38 Locales über `locales:fill` mit englischem Fallback. **Noch offen:** die Foundry-Ressource selbst (EO-450 §8 Schritt 3) und damit die Verifikation des Foundry-Request-/Response-Formats.

- Angelegt: kuratierte Benutzer-Wissensbasis für den RPP Help Assistant (EO-450 §3) unter `docs/user`, `docs/faq`, `docs/glossary` und `docs/release-notes` — 24 Dateien, durchgehend DE und EN. Die Inhalte sind aus dem Code abgeleitet, aber in Benutzersprache verfasst: Oberflächenbegriffe wörtlich aus `src/localization/de.ts` bzw. `en.ts`, Regeln zu Kapazität (Warn-/Kritisch-Schwelle, Mindestbesetzung), Genehmigung (Team-Richtlinie, Typ, persönliche Befreiung) und Ferien-Saldo aus der tatsächlichen Berechnungslogik. Über die fünf in EO-450 §3 skizzierten Seiten hinaus ergänzt um `timeline`, `teams-and-roles`, `settings` und `reports`, weil zwei Einstiegsfragen aus EO-450 §1 sonst nicht beantwortbar wären. Ausschlussliste eingehalten (kein Quellcode, keine Secrets, keine internen URLs, keine Betriebsinfos); Kurations- und Ingest-Regeln bewusst ausserhalb der Ingest-Ordner in `docs/architecture/help-assistant-knowledge-base.md`. Noch nicht enthalten: Hilfe-Tab, `/api/help/chat` und Foundry-Anbindung (EO-450 §8, Schritte 3–5).

- Decoupled deployed-environment safety from the `ASPNETCORE_ENVIRONMENT` name (EO-405 field remediation). Swagger and the developer exception page now require `Development` **and** `ApiSettings:EnableDeveloperTools`; demo-data seeding requires `Development` **and** `ApiSettings:SeedDevelopmentData`; both default to `false`. `Database.Migrate()` was moved out of the `IsDevelopment()` gate it shared with `DataSeeder.SeedAsync` — migrations now run in every environment when a connection string is configured (and log a warning instead of failing when none is), so switching the deployment to `Production` cannot silently stop applying them. Verified on the built artefact started with `ASPNETCORE_ENVIRONMENT=Development`: Swagger 404, `/api/planning/access` 401, no seeding. Documented in `docs/deployment.md`, including that local `Development` runs load User Secrets pointing at the shared `rpp-db-dev` and therefore migrate the deployed database — also recorded in `docs/secret-management.md`.

- Hardened the API deploy artefact: `appsettings.Development.json` is excluded from the publish output (`CopyToPublishDirectory="Never"`) because it carries `ApiSettings:RequireAuthentication=false`, which registers `DevelopmentAllowAnonymousHandler` and makes every `[Authorize]` requirement succeed (EO-405); authorization no longer depends on an App Service setting overriding a shipped bypass, since the key now falls back to `true` from `appsettings.json`. Excluded `publish/**` from content globbing after a stray `RppWebApi/publish/` folder was globbed as content items and landed nested inside the deploy zip (151 → 139 entries). Documented in `docs/deployment.md` that `ASPNETCORE_ENVIRONMENT` must be `Production` — `Development` publicly exposes Swagger, enables the developer exception page, and seeds test data into the connected database on every startup — plus the previously undocumented `dist` → `RppWebApi/wwwroot` mirror step and the `SourceRevisionId` publish argument.

- Produced a consistent RC5 / 4.0.5 release: Teams manifest version, frontend `releaseVersion`, and backend assembly version now state the same release for the first time. Set `<Version>4.0.5</Version>` in `RppWebApi.csproj` (previously absent, so `/health` reported `1.0.0` permanently) and stamped the commit via `-p:SourceRevisionId`, which `HealthController.TryExtractSourceRevision` already parses. Stamped `releaseVersion`/`sourceRevision` in `public/config/runtime-config-PROD.js` from the actual commit instead of the placeholder `"0"`, and restored the `dist` → `RppWebApi/wwwroot` mirror, which had been skipped and left the deploy artefact on an older bundle carrying `planningDataSource: "mock"`. Root cause — hand-maintained version strings plus an unscripted copy step — is scoped in `ENGINEERING-ORDERS/EO-427.md` (Proposed).

- Resolved the Teams app package upload failures and documented the packaging rules in `docs/deployment.md`: `staticTabs[].context` is schema-valid but rejected by the custom-app upload (verified by controlled test against the accepted package), `manifest.id` must stay stable with only `version` raised so Teams updates in place instead of creating an additional catalog entry (the cause of stale versions in the Admin Center), and the ZIP container must mirror a known-good artefact including `external_attr = 0` — Python `zipfile.writestr()` sets Unix mode bits without the regular-file bit. Added upload diagnostics (Developer Portal for real error messages, offline draft-04 schema validation) and the post-upload `OutlookSync__TeamsAppId` step. Synchronised `teams-app-package/manifest.json` with the shipped artefact (was 4.0.2 / manifestVersion 1.19 with a superseded app id), corrected the stale `name.short` override in `de-de.json`, and removed the intermediate bisect packages.

- Implemented EO-426 timeline rendering hot-path performance optimization: memoized Timeline/TimelineGrid/TimelineRow/EventLayer/TeamGroup render paths, pre-grouped events by resource, stabilized key callbacks and lookups, optimized absence/capacity aggregations (`Map`/`Set` based derivations), and reduced repeated date/formatter recomputation while preserving existing planning and approval behavior.

- Implemented EO-425 code quality, test suite & quality gate remediation: fixed `FakePlanningRepository` missing `IPlanningRepository` interface implementations (`CS0535`) so `dotnet test` passes 9/9; eliminated 27 ESLint errors and explicit `any` usages across `securityDiagnostics.ts`, `teamsSsoAuthProvider.ts`, `apiPlanningRepositories.ts`, `sharePointVacationRequestRepository.ts`, `planningDataService.ts`, `monitoringService.ts`, `PlaceholderPage.tsx`, and `powerAutomateApprovalIntegrationRepository.ts` per `AGENTS.md` TypeScript strict rules; refined `scripts/validate-security.mjs` to accept local dev host CSP origins (`http://localhost`, `http://127.0.0.1`) and target actual credential keys.

- Revised EO-422R calendar view per PO feedback: removed the Woche/Monat period options (calendar is an Ansicht), moved Heute/month navigation into the timeline toolbar (single Heute button), and let the month grid fill the available viewport height like Outlook/Teams.

- Implemented EO-422 Outlook-style month calendar view (external implementation, reviewed): week/month period options, month grid with KW column, day-cell absence bars with "+n weitere" overflow, holiday shading, details-panel click-through; restored mock-mode memberships and added a Team Admin mock fallback for demo installations.
- EO-422 review fixes: calendar events no longer clipped to the selected period, localized weekday/month labels, seamless multi-day bars with stable lanes, local date parsing, lint cleanup; layout polished toward Teams/Outlook (sticky Outlook-style navigation, equal-height weeks, today badge).

- Implemented EO-422 Outlook-style calendar view: added „Woche" and „Monat" period options (with 📅 icons) to the compact toolbar; introduced a new „Kalender (Monat)" view mode rendering a classic month grid (Mo–So columns, KW column, today highlight, out-of-month dimming, holiday shading); compact multi-day absence bars with type colouring, approval status indicators, and „+n weitere" overflow; Heute / ‹ / › navigation aligned with the Teams calendar; click-through to the existing details side panel; responsive at desktop, tablet, and phone widths; localized DE+EN; Fluent UI design tokens throughout. Also seeded the mock Team Admin Center from `mockResources` so the full app is browsable without an API backend.

- Revised EO-421R Outlook deep link target: opens the timeline with the linked absence's details panel (scroll to start date) instead of "Meine Anträge"; the approval list remains the fallback when the absence no longer exists.

- Implemented EO-421 timeline cosmetics: localized tooltips on the compact vacation metrics (A/G/R), tenant-wide Team Admin toggle "Ferien-Kennzahlen in der Timeline anzeigen" (API display settings + `EO421_DisplaySettings` migration), profile photos in timeline avatars via a new API photo proxy (`GET /api/planning/photos/{userId}`, app-only Graph, 24h cache, initials fallback), compact toolbar (controls in the title row), legend moved to a slim footer, double-horizontal-scrollbar fix (`scrollbar-width` overrode the `::-webkit-scrollbar` hiding), and an "In RPP öffnen" Teams deep link in Outlook-synced events (configurable `OutlookSync:TeamsAppId`/`TabEntityId`; the app opens "Meine Anträge" and highlights the request via `subEntityId`).
- Fixed a pre-existing bootstrap hang in non-Teams iframe hosts: `TeamsSsoAuthProvider.getContext` now guards `app.getContext()` with the same 5s timeout as initialization.
- Added a dev-only Vite proxy (`/api`, `/health` → `http://localhost:5004`) for same-origin local API testing.

- Added docs/secret-management.md documenting the end-to-end secret architecture (repo placeholders → User Secrets → Azure App Settings, secret-free deploy artefacts, rotation table); linked from security.md and deployment.md.
- Revised EO-500R customer onboarding playbook (first use of the EO revision scheme R/RA/RB…).
- Corrected the API deploy zip method (Python zipfile + `--clean true` instead of Compress-Archive, EO-420 lesson), the Application ID URI to domain form, and the Teams package reference (v4.0.3); promoted the Graph approval provider to the default handover path and marked SharePoint provisioning as conditional. Same zip fix applied to docs/deployment.md.

- Implemented EO-500 customer onboarding playbook.
- Added a tenant-agnostic onboarding playbook and parameter sheet template for deployment, provisioning, verification, approval handover, and operational closeout.

- Implemented EO-001 application shell.
- Added Teams-style header, navigation, layout, footer, and placeholder routing.
- Added light/dark theme readiness.
- Added German and English localization resources for shell labels.
- Implemented EO-002 design system foundation.
- Added Fluent token-backed design variables, page scaffold, reusable card pattern, and polished dashboard presentation.
- Implemented EO-003 timeline foundation.
- Added reusable timeline components with month/week/day headers, sticky employee column, scrolling grid, weekend styling, current-day indicator, and empty event layer.
- Implemented EO-004 resource summary panel.
- Added typed mock resource summaries, reusable badge/avatar/vacation summary components, team overflow badges, and compact sticky row context.
- Implemented EO-006 team grouping framework.
- Added primary-team grouping, sticky group headers, expand/collapse state, resource counts, and sorted resources within groups.
- Implemented EO-007 operational planning view.
- Added typed presence events, event rendering, tooltips, event type styling, and an integrated timeline with approximately 30 realistic resources.
- Implemented EO-008 universal details side panel.
- Added resource and presence event details views, overlay behavior, close button, ESC support, and click triggers from resource summaries and events.
- Implemented EO-009-A/B workspace navigation.
- Replaced the permanent left in-app navigation with horizontal workspace tabs to maximize timeline width.
- Implemented EO-009-C information density optimization.
- Promoted calendar weeks in the timeline header, simplified resource badges, removed repeated team labels from resource cards, and emphasized vacation figures.
- Implemented EO-009-D timeline density refinement.
- Added compact timeline headers, horizontal vacation summaries, compact team counts, and reduced page spacing without changing planning logic.
- Implemented EO-010 observability foundation.
- Added central logger, application error model, correlation IDs, global React error boundary, and localized user-friendly error UI.
- Implemented EO-011 create and manage absences.
- Added typed absence entities, configurable absence types, half-day validation, working-day duration calculation, side-panel create/edit/delete workflow, immediate timeline updates, vacation-balance recalculation, and EO-010 logging.
- Implemented EO-012 interactive timeline editing.
- Added drag-to-move, left/right resize handles, half-day slot validation, live edit preview, keyboard alternatives, immediate absence updates, and EO-010 logging for direct timeline edits.
- Implemented EO-013 capacity calculation engine.
- Added deterministic daily capacity results, employment-rate and working-day support, public-holiday handling, absence capacity reduction, and Timeline consumption for accessible day context.
- Implemented EO-014 team capacity dashboard.
- Added team selection, weekly capacity cards, aggregated capacity table, configurable status thresholds, affected-resource detail area, and universal side-panel integration for employees.
- Implemented EO-016 Microsoft 365 localization integration.
- Removed the in-app language switcher, added host/browser locale resolution with English fallback, and centralized missing-resource fallback handling.
- Refined application layout toward the approved dummy: Teams-style rail/header/search, compact 3-month resource overview controls, weekly staffing/status summary rows, responsive timeline columns, and a right-side absence request panel with half-day handling.
- Implemented EO-100 persistence architecture foundation.
- Added repository interfaces, mock repository implementations, Teams membership identity contracts, planning-only settings records, planning event access, and a planning data service boundary consumed by the timeline and team capacity dashboard.
- Implemented EO-101 SharePoint information architecture.
- Added typed SharePoint list definitions for planning-only data, documented field ownership/reference rules, and aligned vacation balance records so booked and remaining values are calculated rather than persisted.
- Implemented EO-101-A SharePoint information architecture refinement.
- Added typed unique key, index, searchable field, and reference strategy metadata for SharePoint planning lists.
- Implemented EO-102 repository foundation and domain contracts.
- Added repository result/error models, paging contracts, query contracts, team membership provider contract, team planning configuration repository contract, and updated mock providers to implement the new contracts.
- Implemented EO-108 authentication and Microsoft Graph integration foundation.
- Added Microsoft 365 auth contracts, Teams SSO/context provider, encapsulated Graph client, authenticated Graph team membership provider, and permission documentation.
- Implemented EO-103 Microsoft Teams membership provider.
- Added active Graph membership wiring via `VITE_PLANNING_MEMBERSHIP_SOURCE=graph`, Graph paging support, normalized guest/member identities, protected avatar URL mapping, and logger-aware repository composition.
- Implemented EO-104 Microsoft 365 authentication and client foundation.
- Added shared Microsoft 365 client factory, cached auth provider, MSAL adapter contract, SharePoint client foundation, SharePoint site configuration, and localized load-error surfacing through the EO-010 error banner.
- Implemented EO-105 data loading and application bootstrap.
- Added SharePoint read repositories for planning lists, `VITE_PLANNING_DATA_SOURCE=sharepoint`, planning bootstrap loading/error/empty states, retry handling, and consistent snapshot composition before rendering planning views.
- Implemented EO-200 Microsoft 365 approval integration architecture.
- Added vacation-request approval models, policy and Power Automate integration contracts, mock approval repositories, configurable policy seed data, and an approval integration service that delegates workflow execution to Microsoft Approvals via Power Automate.
- Implemented EO-201 approval policies and approval routing configuration.
- Added explicit approval routing rules, policy/routing CRUD contracts, default policy fallback, routing validation, and configuration-error handling without deriving approvers from Microsoft Graph or Entra ID.
- Implemented EO-202 vacation request lifecycle and Microsoft 365 approval submission.
- Added draft save/update/delete operations, explicit submit handling, selected-approver validation, request-level approver and Outlook-sync fields, callback-safe approved/rejected status processing, and a localized vacation request form component.
- Implemented EO-202-A clickable mock approval workflow.
- Added the Approvals workspace prototype with local request preparation, review, submission, Team Lead approve/reject simulation, cancellation, restart, visual states, and German/English localization.
- Implemented EO-206 My Settings.
- Added the personal settings page under `/settings/my`, profile/approval/notification/Outlook/regional settings cards, mock settings API, effective user settings model, save/reset handling, and localized policy-managed controls.
- Implemented EO-203 Outlook calendar synchronization.
- Added request-level Outlook sync state, Calendar Graph adapter, sync service, event queue, retry/status UI components, Calendar scope support, and one-event-per-vacation request handling.
- Implemented EO-204 vacation balances.
- Added the My Absences vacation balance page, authoritative mock balance API, request preview, negative-balance warning, team-admin adjustment form, audit history, and localized German/English balance resources.
- Implemented EO-205 Team Admin Center.
- Added the administration route, managed-team selector, editable default/backup approvers, approval policy controls, read-only team member vacation visibility, permission-validated mock API, and My Settings policy integration.
- Implemented EO-301 performance baseline.
- Added route-based lazy loading, navigation preloading for lazy pages, cached/deduplicated planning bootstrap snapshots, and force-refresh behavior for manual retry.
- Implemented EO-302 deployment baseline.
- Added runtime configuration, release metadata generation, deployment validation scripts, deployment build command, and deployment/rollback documentation.
- Implemented EO-303 monitoring baseline.
- Added sanitized structured monitoring events, lightweight operational metrics, runtime health snapshots, static health artefact validation, and monitoring documentation.
- Implemented EO-304 security hardening baseline.
- Added trusted Graph/SharePoint URL guards, runtime SharePoint URL validation, safe diagnostic error details, CSP/referrer baseline, security validation script, and security documentation.
- Added school-holiday calendar data for St. Gallen and Dübendorf/Zürich.
- Implemented EO-110 SharePoint list provisioning.
- Added an idempotent PnP.PowerShell provisioning script for the six planning lists (fields, indexes, choice values, `TeamId` uniqueness, validate-only drift mode) and provisioning documentation.
- Aligned the typed SharePoint schema with the mock reference implementation: added the `Substitute` and `ApprovalStatus` columns to Absences and the new `PlanningEvents` list for non-absence planning events.
- Documented official Open Data source URLs in code: Stadt St.Gallen JSON endpoint and Stadt Zürich CKAN Datastore JSON endpoint.
- Refactored holiday seed data from individual day entries to maintainable date ranges that expand into daily planner entries.
- Corrected Dübendorf/Zürich 2026 school holidays from the official Stadt Zürich JSON dataset and kept St. Gallen 2026 as a manual fallback until the official St.Gallen Open Data endpoint publishes 2026 records.
- Extended mock-state export/import so `publicHolidays` is included as an editable JSON block for easy browser-local maintenance.
- Added a Team Admin Center action to fetch St. Gallen and Dübendorf/Zürich school holidays for a selected calendar year from the configured Open Data JSON sources and persist them to the local mock calendar.
- Added an M365/Teams-style app mark next to the application title in the header.
- Added visual-only Timeline shading for school holidays and public holidays while ensuring school holidays do not reduce capacity or working-day calculations.
- Clarified in Team Admin Center that new absence entry types are persisted only after clicking “Save changes”.
- Unified Team Admin Center terminology from “entry types” to “absence types”.
- Wired Team Admin configured absence types into absence request forms and timeline labels so custom types such as “Konferenz” appear after saving.
- Reused the Teams-style person profile overlay from Reports when clicking people in the Planning Timeline.
- Added a Team Admin member-level “No approval required” flag for department heads; marked users no longer see the approval request action and saved absences are treated as approved.
- Made Team Admin member employment percentage, vacation balance, and effective approver editable; employment and vacation values now flow into mock planning capacity and balance data.
- Switched the default capacity-relevant public holiday calendar to the official Zurich Open Data calendar and added a Team Admin action to refresh it for a selected year.
- Added a sticky synchronized horizontal scrollbar to the Planning Timeline so users can scroll horizontally without first scrolling to the bottom of the overview.
- Ensured the Zurich default public holiday calendar includes Stephanstag (26 December) as a fixed-date Zurich holiday even when the Open Data source omits it in weekend years.
- Implemented EO-401 App Admin Center and backend provider selection (ADR-003 Phase 2A).
- Implemented EO-207 Live Microsoft 365 Approval Integration.
- Replaced EO-202-A mock approval sidebar with real Power Automate + Microsoft Approvals flow (pull-based decision via SharePoint `VacationRequests` list).
- Added `SharePointVacationRequestRepository`, `PowerAutomateApprovalIntegrationRepository` and configuration-driven `createDefaultApprovalRepositories`.
- Made Approvals workspace mode-aware (`approvalMode=mock` shows simulation sidebar, `m365` hides it and uses real flow from side panel).
- Extended provisioning script and created `docs/approval-flow-setup.md`.
- Updated runtime config visibility, error handling, lifecycle events, localization and all documentation.
- Extended the planning data source model to mock/SharePoint/API, added runtime configuration resolution with fixed precedence (local override, deployment file, build variables, mock default), both-direction overrides, and per-value origin tracking.
- Added the App Admin Center route with effective-configuration display and origin badges, browser-local provider override with validation and reset, per-provider connection tests with status and latency, and export of a deployable config/runtime-config.js.
- Added an API placeholder repository set that surfaces a recoverable bootstrap state until the RPP Web API ships in Phase 2B, plus monitoring and deployment-validation checks for the API configuration.
- Implemented EO-111 SharePoint read repository alignment.
- Aligned the EO-105 SharePoint read repositories with the mock reference implementation: absences now read the provisioned `ApprovalStatus` column instead of assuming approved, a new `SharePointPlanningEventRepository` loads the `PlanningEvents` list, absence durations use the application's working-day calculation instead of calendar days, public holidays map the `Region` column to the holiday location, and Team Admin custom absence types pass through the SharePoint read path unchanged.

## Unreleased / In Progress

- **EO-424 deployment fix + DB permissions**: resolved the `rpp-dev` Azure App Service startup failure (exit code 134). The Managed Identity `rpp-dev` lacked `db_ddladmin` on the Azure SQL database — EF Core migrations could not execute `ALTER TABLE`. Added `ALTER ROLE db_ddladmin ADD MEMBER [rpp-dev]` to grant DDL rights. Applied the pending EO-423 migration (`TeamColor` on `TeamAdminTeams`, `EventColorMode` on `DisplaySettings`).
- **EO-424 missing migration**: generated `EO424_IcsUidAndSource` EF Core migration to add `IcsUid` (nvarchar(255), nullable) and `Source` (nvarchar(50), not null, default `'manual'`) columns to the `Absences` table. These columns existed in the `AbsenceDto` C# model but were never present in the database — the `DataSeeder` crashed with `Invalid column name 'IcsUid'`. Added `AbsenceConfiguration` fluent API mappings and a `IcsUid` index.
- **EO-424 DI scope fix**: `MailboxSyncBackgroundService` (singleton `IHostedService`) was directly injecting `MailboxSyncService` (scoped, depends on `ITokenAcquisition`), causing `Cannot resolve scoped service 'ITokenAcquisition' from root provider` at startup. Replaced the direct dependency with `IServiceScopeFactory` — the background service now creates a scope per sync cycle.
- **Deployment baseline update**: documented the `db_ddladmin` requirement for Azure SQL Managed Identity in `docs/deployment.md` and added a database-permissions checklist to the onboarding playbook.

- Repaired the `RppWebApi.Tests` build (fakes updated to the EO-419 repository signatures and the current controller constructor); the authorization battery passes again (9/9).
- EO-420 round 2 (systematic id-space review): the vacation request team filter now resolves the M365 host-group id via `OwningTeamId` to internal planning team ids (the EO-419 Genehmigungen scoping and the Graph decision pull-sync never matched before); removed the dead host-id-vs-internal-id comparison in the Team Admin initial team selection; static files now ship explicit cache headers (`immutable` for hashed `/assets`, `no-cache` for `index.html`/config/release metadata) so Teams webviews stop serving stale bundles after deployments.
- Implemented EO-420 RC2 stabilization (host-team scoping fixes): `GetTeamMembershipsAsync` now resolves the `X-RPP-Active-TeamId` host-group id via `TeamAdminTeam.OwningTeamId` to internal planning team ids before filtering member assignments (the previous direct id comparison never matched, leaving the timeline empty and the membership guard returning 403 for everyone); the memberships member guard now checks real M365 team membership via Graph instead of the assignment-derived list so freshly connected host teams without structures are not locked out; the Team Admin Center no longer shows the "Unberechtigt" card for owners of a host team without planning structures — they now reach the team-creation card (access denial renders solely from the server-verified `/access` result).
- Added Teams package localization resources for `es`, `fr`, `it`, `pt`, `ru`, and `zh` so the manifest package now covers the expanded locale set alongside `de`, `fa`, `gu`, `ha`, `ko`, `sw`, and `th`.
- Fixed the empty holiday calendar (EO-416 follow-up): the EO-304 CSP `connect-src` blocked the Open Data hosts (`daten.stadt.sg.ch`, `data.stadt-zuerich.ch`), so the Team Admin refresh actions failed in the browser before anything could persist; both hosts are now allowed.
- EO-418 follow-up (personal-scope + header badge): the personal app tab carries no Teams host context, which hid the admin tabs even for owners/administrators — the API now falls back to the configured default team (`Graph:TeamGroupId`) when no `X-RPP-Active-TeamId` is sent, so the personal tab keeps working against the primary host team while team tabs stay explicitly scoped; the `/access` check logs the caller's `wids` claim values for role diagnostics; the navigation row shows the active host team as a badge (team tabs only — personal scope has no team).
- Implemented EO-418/EO-419 (team-scoped instances): `TeamAdminTeam.OwningTeamId` + migration (existing teams backfilled to the RPP host team) with host-scoped Team Admin reads/writes — member-assignment rewrites now touch only the host scope so multi-team users keep their other teams' assignments; the Graph member cache is keyed per team and the Team Admin module caches reset on host-context switches; new `GET /api/planning/access` returns isTeamOwner (Graph ownership of the active team) and isAppAdmin (Entra directory role via wids claim, configurable `AppAdmin:AllowedRoleTemplateIds`); person-scoped writes (absences, vacation requests) require self-or-team-owner; admin tabs are hidden without the role while deep links show denial cards naming the required role; the broken interim App Admin gate was replaced; new app-admin action "Feiertagskalender leeren" resets the tenant holiday calendar.
- Finalized EO-418 with the PO decisions: tenant-global absence types/organisations/holidays vs. M365-team-scoped internal team structures (`OwningTeamId`), 404 for foreign team data, App Admin access via Entra directory role (Teams Administrator / Global Administrator, `wids`-claim check server-side — replaces the 2026-07-18 interim gate that locked everyone out), Team Admin access via M365 team ownership, admin tabs hidden for regular members with a clear "Unberechtigt" page on deep links, and a new App Admin "Feiertagskalender leeren" action.

- Added EO-418 draft: team-scoped app instances with person-scoped absence facts (single-entry absences across multi-team membership, API-enforced team isolation, and active Team context scoping).
- EO-418 implementation progress: active Team context resolution in frontend bootstrap, membership-projection filtering (`members -> userIds -> absences/events`), teamId-scoped memberships API path (frontend -> controller -> repository), and server-side Team Admin membership guards for team-scoped read/write endpoints.
- EO-418 hardening: `POST /api/planning/teamadmin/teams` now requires M365 Team owner authorization in the active source Team context (`sourceTeamId`), team-scoped memberships reads enforce member authorization, and a new `RppWebApi.Tests` battery validates cross-team allow/deny behavior on Team Admin and memberships endpoints.
- EO-419 implementation: the Genehmigungen tab is now scoped to the active M365 Team, with `teamId` threaded through the approvals page, repository layer, and backend vacation-request query/sync path.
- EO-401 / EO-419 access gating: Team Admin Center now only returns teams owned by the current user, and App Admin Center now shows an access-denied state unless the active host team is owned by the current user.
- Team-boundary validation snapshot (2026-07-18): `dotnet build` succeeded, `RppWebApi.Tests` passed (8/8), including Team Admin owner/non-owner and team-scoped vacation request authorization checks.

- Hardened `scripts/provision-sharepoint-lists.ps1` for SharePoint Event Calendar usage: `PublicHolidays`, `PlanningEvents`, and `Absences` now use event-oriented provisioning with built-in field handling.
- Added strict UID-to-People mapping support in SharePoint provisioning (`-EnablePeoplePickerFields`, `-RequirePeoplePickerMappings`) with companion User field validation.
- Resolved SharePoint Events field collision by renaming custom planning event classification field from `EventType` to `PlanningEventType`.
- Updated deployment configuration for Azure Web App target `rpp-api.example.com`:
  - runtime API base URL in `public/config/runtime-config.js`
  - Teams app manifest URLs and valid domain in `teams-app-package/manifest.json`
  - API CORS origins in `RppWebApi/Program.cs` and appsettings `ApiSettings:AllowedOrigins`.
- Built and published RC Teams package artifact: `teams-app-package/rpp-rc1-teams-app.zip`.
- Added EO-207 approval flow blueprint artifact `docs/rpp-approval-flow.json` aligned with the `PowerAutomateApprovalInput/Output` contract and SharePoint `VacationRequests` writeback.
- Added modern managed-package ALM tooling and documentation:
  - `scripts/build-managed-solution.ps1`
  - `docs/managed-package-build.md`.

- Implemented EO-409 repository secret hygiene and local development secret management.
- Hardened `.gitignore` for local env files, local appsettings variants, IDE state, and generated backend artefacts.
- Added `.env.example` as a non-secret reference for local frontend/runtime configuration.
- Added `npm run validate:repo-hygiene` to catch tracked secret-like files and committed `appsettings.json` secrets before sharing or pushing the repository.
- Added a repo-local `pre-commit` hook variant plus `npm run install:git-hooks` so the hygiene check can run automatically before commits.
- Documented the local `.NET User Secrets` workflow and the public-vs-secret configuration boundary in the security and API documentation.
- **EO-408 completed**: Normalized SQL persistence for Team Admin Center (replaces localStorage/mockStatePersistence).
  - Added normalized EF Core models (`TeamAdminTeam`, `TeamAdminMemberAssignment` for Primary/Zusatzposition, `TeamAdminSettings`), configurations, DbContext updates and migration `20260717155540_EO408_TeamAdminNormalizedTables`.
  - Implemented backend endpoints in `PlanningController` (`GET /api/planning/teamadmin/teams`, `GET /details/{teamId}`, `PATCH /details`) + `EfPlanningRepository`.
  - Updated frontend: `teamAdminApi.ts` now calls real API (no more mockStatePersistence for teamAdmin.*), `planningDataService.ts` hardened for backend DTO shape (nested `member`, type guards, GraphUserIdentity compatibility).
  - `mockPlanningRepositories.ts` cleaned (no arbitrary defaults, ["RPP"] only, empty overrides Map).
  - EO-406/EO-407 fully integrated: real Graph members (6 M365 users) + persistent Primary/Zusatzposition assignments; no more "keine planbaren Personen gefunden", no default/master teams, no arbitrary data loss on cache clear.
  - Remaining: create-new-team flow has minor mapping issues (deprioritized per user request).
  - Updated CHANGELOG, ROADMAP, EO-408.md. Follows AGENTS.md (UX first, strong typing, maintainability, localization ready).
  - Ready for review (per Engineering Rule).
- Fixed the empty "Keine planbaren Personen" state on Timeline and Team Capacity with the API data source: a crashing logger call in the API repository made every planning read fail before fetch, and the browser-side Graph membership provider (which requires Teams SSO) no longer overrides API-delivered memberships; the membership fallback default is mock again per ADR-003.
- Completed EO-408 Team Admin Center SQL persistence: teams (create/rename/reorder/organisation/required staffing/delete), team settings, member assignments (primary team, additional positions, employment, vacation balance, approval exemption, effective approver), and absence entry types are now stored via the RPP Web API in the database with real Graph members merged in; the frontend teamAdminApi is fully API-backed with local mirrors for capacity staffing and absence-form entry types.
- Added a 5-minute member cache to the Graph membership service and new teamadmin endpoints (POST/PATCH/DELETE teams, PATCH details) with validation-conflict responses.
- Moved the database connection string and the Entra ID client secret from appsettings.json into .NET user secrets; appsettings now ships empty placeholders.
- Completed EO-407 (reduced scope): the Microsoft Graph team group id and team name moved from code into the Graph:TeamGroupId / Graph:TeamName configuration section.
- Implemented EO-405 authentication end-to-end: the planning API now requires Entra ID bearer tokens ([Authorize] + always-on auth middleware); local development without Teams SSO uses the explicit ApiSettings:RequireAuthentication=false bypass with a startup warning. The frontend attaches the Teams SSO token to planning and team admin API requests when available.
- Reworked the data seeder (EO-403): legacy rows with mock resource-* employee ids are removed on startup and demo absences/balances are seeded for the real Microsoft Graph team members so existing data is visible on the Timeline.
- Removed the mock-phase header chrome for the real Teams app: theme toggle, help, settings and mock avatar are gone; the in-app header and simulated Teams rail render only in mock demo mode, the theme follows the Teams host theme (browser color scheme outside Teams), and clicking a person opens the native Teams profile card (`profile.showProfile`) with the in-app card as browser/mock fallback. Teams manifest v1.0.2 carries the full app name.
- Implemented EO-410 API-based Microsoft 365 approval integration: vacation requests are persisted in SQL via new `/api/planning/vacationrequests` endpoints, `POST .../{id}/start-approval` calls the Power Automate flow server-side (flow URL stays secret), and the flow writes the decision back via `POST /api/approvals/callback` (shared-secret header, fixed-time comparison); an approved decision creates an approved absence row. Frontend: new API-backed approval repositories are active with `approvalMode=m365` + `planningDataSource=api`; the EO-207 SharePoint path stays for the sharepoint data source; anything unconfigured falls back to mock with a logged warning. New blueprint `docs/rpp-approval-flow-eo410.json`, updated `docs/approval-flow-setup.md`, EF migrations `EO410_VacationRequestApprovalFields` + `EO410_AbsenceApprovalLink`.
- EO-410 amendment: default approval provider is now the Microsoft Graph approval solutions API (beta) — `GraphApprovalService` creates Microsoft Approvals directly via delegated OBO (`ApprovalSolution.ReadWrite`), decisions are pull-synced on `GET /api/planning/vacationrequests`, and the Teams Approvals app is the approver surface. No Power Automate and no premium license required; the Power Automate path remains as a configured alternative (`ApprovalFlow:*`). Added `scripts/configure-graph-approvals.ps1` for permission + admin consent.
- RC1 feedback round 1: fixed the 500 on saving new absences (SaveAbsenceAsync is now an upsert — client-generated ids hit Update on non-existing rows), replaced the mock-era approval team/user mapping (real teams were routed to the "no approval required" mock policy) with Team-Admin-backed policy/routing (member effective approver, then team default approver; approval-exempt members skip approval), added visible submit feedback (success/error banner) with awaited persistence and bootstrap-cache invalidation, defaulted new absences to the signed-in Teams user (Timeline + Reports), added the "Meine Anträge" view on the Genehmigungen tab for m365 mode (status list with refresh-triggered Graph decision sync and a deep link to the Teams Approvals app), extended the Timeline range 12 months into the past with automatic positioning on today, and refined small-screen styles.
- RC1 feedback round 2: normalized API absence dates client-side (DateTime serialization broke timeline bar positioning and emptied the date inputs in the edit panel; empty legacy ApprovalStatus now maps to approved), defaulted the absence form end date to one working week after the start date with a never-before-start guard, and diagnosed the failing approval start as a missing Microsoft Graph delegated grant (AADSTS65001: ApprovalSolution.ReadWrite absent from the oauth2PermissionGrant despite requiredResourceAccess).
- Implemented EO-417 RC1 QA Round 4: tolerant Graph approval decision mapping (the literal "Approved" comparison mapped real approve responses to rejected; raw result/response values are now logged), bootstrap-cache invalidation after the decision sync so the Timeline reflects outcomes, approver selection in the absence form honoring the Team Admin "allow user override" policy (selection flows into the Microsoft Approval assignment; disabled with a policy hint otherwise), a compact one-screen form (tighter spacing, two-row comment, entitlement reduced to available/booked, single-row small action buttons with icon delete), Reports fixes (generic joint-planning title, team filter covering primary and additional teams), Team Management organisation dropdown fed by the configured organisations, blank-row tolerance in the Organisations & Locations card, and an Outlook sync status column in "Meine Anträge".
- Implemented EO-416 holiday calendar persistence: new `PublicHolidays` table, `GET /api/planning/holidays` serves the persisted calendar (was an empty stub — holidays were missing entirely in api mode), `GET/PATCH /api/planning/teamadmin/holidays` for the Team Admin Open Data refresh actions, which now write to the database with the api data source and keep the browser-local mock state for demo mode only.
- EO-412 hotfix: on phone portrait the whole app collapsed into a 52px column — the ≤560px media query re-applied the two-column demo-rail grid and outranked the rail-less single-column rule (same specificity, later in file); the no-rail layout now re-asserts its single content column inside the media query. Verified at 375px: navigation and content span the full width.
- Completed EO-412 mobile pass: list view as phone default, native touch panning of the timeline (bar editing stays mouse/pen with tap-to-open and keyboard alternative), 40 px coarse-pointer touch targets, full-width stacked action buttons on small screens; table overflow audit passed.
- Implemented EO-414 server-side Outlook calendar sync (one-way RPP → requester's personal calendar): `OutlookCalendarSyncService` writes one all-day OOF event per vacation request via app-only Graph (`Calendars.ReadWrite`), hooked into the approval lifecycle (optional tentative event on submit, upsert on approval, delete on rejection/cancellation, recreate if the event was removed manually in Outlook); sync state (`GraphEventId`, `OutlookSyncStatus`, error) lives on the request and shows as an Outlook column in "Meine Anträge"; failures never block approvals. Setup via `scripts/configure-outlook-sync.ps1` (application permission + admin consent, Application Access Policy documented) and the `OutlookSync` config section (disabled by default).
- Implemented EO-415 configurable organisations & locations: new `Organisations`/`Locations`/`ProfileValueMappings` tables (seeded with one partner organisation and Dübendorf/St. Gallen/Thun), Team Admin Center card for editing both lists and mapping raw Graph profile values (`companyName`/`officeLocation`) onto them (unmapped values surface automatically), memberships deliver resolved organisation/location names, and the frontend consumes configured values everywhere: `Organization` is no longer a hardcoded union, the resource model carries a location, badges render any configured organisation, and the Reports filters derive their options from the data. The Organisation-A/Organisation-B and Dübendorf/St. Gallen hardcodes are gone (the address heuristic remains only as a mock-data fallback).
- EO-415 follow-up: the Team Management card's organisation dropdown now offers the configured organisations (plus values already assigned to teams) instead of the hardcoded Organisation-A/Organisation-B list; blank rows in the Organisations & Locations card are ignored on save instead of failing with a 409; the shared-planning report title dropped the Organisation-A & Organisation-B wording; the browser-side Graph membership provider passes the raw profile company name through instead of guessing Organisation-A/Organisation-B.
- Implemented EO-413 RC1 Feedback Round 3: verified the team capacity math (the reported numbers were consistent — 6 members × 5 days = 30 person-days nominal, 10 absent = 67%; the "Absent" label showed person-days next to a member count) and relabeled the metrics ("Abwesende Personen" now counts distinct persons, day values are marked as Personentage); Team Capacity lists all Team Admin teams (member-less teams appear neutral instead of critical), the period selector actually filters (it was inert), and the unused three-dot menu is gone; the shared absence form (Timeline + Reports already used the same component) no longer scrolls horizontally (button row wraps, panel body clips overflow) and the "Genehmigung anfordern" button disables during submission to prevent double approvals; the Timeline shows a single horizontal scrollbar (native bar hidden, sticky sync bar kept); the Team Admin "Änderungen speichern" button is disabled without unsaved changes; the person card fallback now shows only real data (email from Team Admin membership, teams, organisation — fabricated phone/assistant/presence values removed) and unsupported native profile cards are logged to monitoring.
