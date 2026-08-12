# Software Development Cycle (Phase 0 bis 6)

Dieses Dokument beschreibt den generischen Entwicklungszyklus eines Software-Increments und ergänzt die projektspezifischen Governance- und Architekturvorgaben, ersetzt sie jedoch nicht.

> Für dieses Repository bleiben `AGENTS.md`, `/home/runner/work/M365-RPP-TeamsApp/M365-RPP-TeamsApp/docs/ADMIN Scale.md`, die Engineering Orders sowie die Architekturdokumentation massgeblich.

| Phase | Bezeichnung | Fokus | Hauptziel | Haupt-Zielgruppe |
|---|---|---|---|---|
| **0** | **Analyse & Zieldefinition** | Problem, Scope & Rahmenbedingungen (technologieagnostisch) | Build-vs-Buy, Anforderungskriterien (NFRs) & frühe Sicherheitsplanung | PM, Stakeholder, Architekt, Security |
| **1** | **Clickable Mockup** | Browserbasierter UX/UI-Prototyp | Visuelles & klickbares Feedback im Browser | UX/UI-Designer, Frontend-Entwickler, Key Stakeholder |
| **2** | **Solution Architecture & System Design** | Architektur, Tech-Wahl, APIs & Datenmodell | Technisches Blueprint, Festlegung von Programmiersprache & Infrastruktur | Software Architekt, Lead Developer, DevOps |
| **3** | **Dev Version / Alpha** | Kernentwicklung & Engineering | Erste lauffähige Version der Kernfunktionen | Interne Entwickler & QA |
| **4** | **Testphase (Friends & Family / Beta)** | Stufenweiser Praxistest | Aufdecken von Bedienungs-, Logik- und Performanceproblemen | Interne Teams, Beta-Community, QA |
| **5** | **Release Candidate** | Qualitätsfreigabe, Härtung & Code Freeze | Finale Security-Audits, Bugfixes & Rollback-Plan | QA-Lead, Release Management, Security |
| **6** | **Release / Produktion** | Go-Live, Betrieb & Monitoring | Stabiler Betrieb, Telemetrie & kontinuierliche Verbesserung | Endnutzer, Operations & DevOps |

---

## Phase 0 – Analyse & Zieldefinition

**Was passiert hier:** Noch kein Design und kein Code. Es wird geklärt, welches Problem gelöst werden soll, wer die Nutzer sind und wie sie heute arbeiten. Zusätzlich werden Rahmenbedingungen wie Betrieb, Datenschutz, Compliance, Sicherheitsanforderungen und bestehende Systeme betrachtet. Ebenso wird geprüft, ob bereits eine Standardlösung existiert oder eine Eigenentwicklung sinnvoll ist.

**Ziel:** Eine belastbare Entscheidungsgrundlage schaffen. Festgelegt werden Erfolgskriterien, Scope, Nicht-Ziele sowie funktionale und nichtfunktionale Anforderungen – ohne sich bereits auf konkrete Technologien oder Programmiersprachen festzulegen.

## Phase 1 – Clickable Mockup (Prototyping & Design)

**Was passiert hier:** Es entsteht ein interaktiver, browserbasierter Klick-Prototyp. Statt ausschliesslich statischer Designwerkzeuge wird die Benutzeroberfläche als einfache Web-Anwendung umgesetzt, sodass Navigation, Abläufe und Benutzerführung realistisch ausprobiert werden können. Für Webanwendungen eignet sich beispielsweise **Vite** aufgrund seiner schnellen Entwicklungszyklen besonders gut.

**Ziel:** Konzept und Benutzerführung (UX) direkt im Browser erlebbar machen, früh Feedback einholen und Stakeholder einbinden, bevor Zeit in Backend-Logik und Infrastruktur investiert wird. Erste funktionale Anforderungen an Schnittstellen und Layouts werden sichtbar und können gemeinsam validiert werden. Gerade für dieses Produkt ist die frühe UX-Validierung zentral, weil operative Klarheit und Verständlichkeit Vorrang haben.

## Phase 2 – Solution Architecture & System Design

**Was passiert hier:** Auf Basis der in Phase 1 gewonnenen Erkenntnisse erfolgt die technische Modellierung nach dem Prinzip der späten Technologieentscheidung (*Last Responsible Moment*). Erst jetzt werden Programmiersprachen, Frameworks, Datenbanken und Infrastruktur ausgewählt. Zusätzlich werden APIs, Datenmodell, Sicherheitsarchitektur, Deployment-Modell, CI/CD-Pipeline sowie Betriebs- und Integrationskonzepte definiert. Wichtige Architekturentscheidungen werden dokumentiert.

**Ziel:** Ein vollständiges technisches Blueprint erstellen, das Skalierbarkeit, Wartbarkeit, Performance, Sicherheit und den späteren Betrieb berücksichtigt und als Grundlage für die Implementierung dient.

## Phase 3 – Dev Version / Alpha (Entwicklung)

**Was passiert hier:** Umsetzung des Konzepts in der gewählten Architektur und Programmiersprache. Neben der eigentlichen Entwicklung entstehen automatisierte Unit-Tests, Integrationstests, Build-Prozesse sowie kleine technische Versuche, mit denen offene Architektur- oder Technologiefragen früh überprüft werden. Ebenfalls werden grundlegende Engineering-Praktiken wie Logging, Observability-Vorbereitung, Testdatenstrategien, Code Reviews und Continuous Integration von Beginn an mit aufgebaut und angewendet.

**Ziel:** Implementierung der Kernfunktionen. Die Version ist bewusst noch unvollständig und primär für interne Entwickler- und Qualitätstests bestimmt.

## Phase 4 – Testphase (Friends & Family & Beta)

**Was passiert hier:** Die Anwendung wird schrittweise einem grösseren Benutzerkreis zur Verfügung gestellt – zunächst intern (Friends & Family), anschliessend einer erweiterten Beta-Gruppe. Neben funktionalen Tests werden Usability, Performance, Stabilität, Barrierefreiheit sowie das Verhalten auf unterschiedlichen Geräten und Browsern überprüft.

**Ziel:** Praxistest unter realen Bedingungen. Im Vordergrund steht die Validierung mit echten Nutzerinnen und Nutzern, um Bedienungsfehler, logische Schwächen, Performanceprobleme und Stabilitätsmängel früh zu erkennen und zu beheben.

## Phase 5 – Release Candidate (Qualitätsfreigabe)

**Was passiert hier:** Alle geplanten Funktionen sind implementiert. Es gilt Feature Freeze – neue Funktionen werden nicht mehr aufgenommen. Kurz vor der Veröffentlichung folgt der Code Freeze, bei dem nur noch kritische Fehler behoben werden. Parallel erfolgen finale Security-Audits, Penetrationstests sowie die Überprüfung des Notfall- und Rollback-Konzepts.

**Ziel:** Letzte technische Qualitäts- und Sicherheitsfreigabe vor der Produktion. Im Fokus steht nicht mehr die Nutzererprobung, sondern die kontrollierte Härtung, Stabilisierung und formale Freigabe für den Produktivbetrieb.

## Phase 6 – Release / Produktion (Go-Live)

**Was passiert hier:** Die Anwendung wird offiziell veröffentlicht und den Endanwendern bereitgestellt. Im laufenden Betrieb übernehmen Monitoring, Telemetrie, Incident Management, Patch-Management, Kapazitätsplanung sowie Kostenüberwachung die Sicherstellung eines stabilen Betriebs.

**Ziel:** Stabiler Produktivbetrieb mit Wartung, Support und kontinuierlicher Verbesserung. Erkenntnisse aus Monitoring, Telemetrie und Nutzerverhalten fliessen direkt zurück in Phase 0 und bilden die Grundlage für den nächsten Entwicklungszyklus. Monitoring und Telemetrie dienen dabei nicht nur dem Betrieb, sondern auch der Verbesserung von operativer Sichtbarkeit, Nutzung und Produktqualität.

## Querschnittsaktivitäten (gelten für alle Phasen)

Diese Aktivitäten begleiten den gesamten Software Development Cycle und sind **keine eigenständigen Phasen**.

| Aktivität | Phase 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|-----------|:-------:|:--:|:--:|:--:|:--:|:--:|:--:|
| Security | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Dokumentation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Qualitätsmanagement | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Testing | Planung | UX | Testdesign | Unit & Integration | System & Beta | Regression | Monitoring |
| DevOps | Planung | – | CI/CD | Build | Deployment | Release | Betrieb |
| Risikoanalyse | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Anmerkungen

- **Der Zyklus ist ein Kreis, keine Linie:** Phase 6 ist kein Endpunkt, sondern der Rücksprung nach Phase 0.
- **Phase 0 wird nicht nur einmal durchlaufen:** Während Entwicklung und Test widerlegt die Praxis regelmässig Annahmen aus der Analyse – dann geht es dorthin zurück.
- **Browserbasierte Prototypen statt statischer Mockups:** Ein klickbarer Prototyp ermöglicht realistischeres UX-Feedback und verkürzt den Übergang zur eigentlichen Entwicklung. Für Webanwendungen bietet sich beispielsweise Vite als besonders schnelles Werkzeug an.
- **Späte Technologieentscheidung (*Last Responsible Moment*):** Die Wahl der Programmiersprache, Frameworks und Datenbanken erfolgt bewusst erst in Phase 2, nachdem Geschäftsprozesse und Benutzerführung verstanden wurden.
- **Frühzeitige Sicherheits- und Qualitätsplanung:** IT-Sicherheit, Datenschutz und Teststrategie werden bereits ab Phase 0 berücksichtigt und ziehen sich als Querschnittsaktivitäten durch den gesamten Entwicklungszyklus.
- **Telemetrie ersetzt Bauchgefühl:** Erkenntnisse aus Monitoring und Observability liefern objektive Daten für den nächsten Entwicklungszyklus.
- **Feature Freeze ≠ Code Freeze:** Feature Freeze beendet die Entwicklung neuer Funktionen, Code Freeze beschränkt Änderungen auf notwendige Korrekturen kritischer Fehler.
- **Gültigkeitsbereich:** Das Modell eignet sich besonders für Produkte mit versionierten Releases (Desktop-, Mobile- und Store-Apps). Bei kontinuierlich ausgelieferten Web-Anwendungen können Feature Flags sowie Canary- oder Ring-Deployments klassische Beta-Phasen teilweise ersetzen.
- **Einordnung im Repository:** Dieses Phasenmodell beschreibt den Reife- und Lieferzyklus eines Software-Increments. Sprintplanung, Roadmap und die Regel „nur ein aktiver Engineering Order gleichzeitig“ bleiben davon unberührt und gelten weiterhin separat als projektspezifische Steuerung.
