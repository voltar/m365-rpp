# Help Assistant — Wissensbasis (Kuration und Ingest)

Begleitdokument. Beschreibt, was in die Wissensbasis des RPP Help Assistant gehört, wie sie gepflegt wird und was bewusst draussen bleibt.

Dieses Dokument liegt absichtlich **nicht** in einem der Ingest-Ordner.

## Ingest-Umfang

Der Foundry Agent lädt:

```
/docs/user/
/docs/faq/
/docs/glossary/
/docs/release-notes/
```

Alles andere ist ausgeschlossen (Quellcode, EOs, Architektur, Deploy, Secrets, …).

## Audience / Rollen-Scoping

| `audience` im Frontmatter | Wer darf den Inhalt nutzen |
|---|---|
| `user` (Standard) | Alle Rollen |
| `team-owner` | Nur `teamLead` und `appAdmin` im Hilfe-Kontext |

- **Mock-Hilfe:** filtert Einträge und verweigert Owner-only-Treffer für `employee`.
- **Foundry:** Kontextanweisung im Backend (`FoundryHelpAssistantService`) verpflichtet den Agenten, `audience: team-owner`-Wissen nur bei Rolle `teamLead` / `appAdmin` zu verwenden. Dateien bleiben im gemeinsamen Store; die Rolle steuert die Nutzung, nicht der Dateipfad allein.
- Team-Owner-Doku: `docs/user/team-admin.de.md` / `team-admin.en.md`.

`userRole` kommt aus dem Client: `employee` | `teamLead` | `appAdmin` (Owner des aktiven M365-Teams → `teamLead`).

## Bestand (kuratiert 4.0.7 Friends & Family)

| Ordner | Datei | audience | DE | EN |
|---|---|---|:--:|:--:|
| `/docs/user` | `getting-started` | user | ✓ | ✓ |
| | `timeline` | user | ✓ | ✓ |
| | `absences` | user | ✓ | ✓ |
| | `approvals` | user | ✓ | ✓ |
| | `capacity` | user | ✓ | ✓ |
| | `outlook-sync` | user | ✓ | ✓ |
| | `teams-and-roles` | user | ✓ | ✓ |
| | `settings` | user | ✓ | ✓ |
| | `reports` | user | ✓ | ✓ |
| | `team-admin` | **team-owner** | ✓ | ✓ |
| `/docs/faq` | `general-questions` | user | ✓ | ✓ |
| `/docs/glossary` | `rpp-terms` | user | ✓ | ✓ |
| `/docs/release-notes` | `4.0.9-friends-family` (final) | user | ✓ | ✓ |
| | `friends-family` (Kurzverweis) | user | ✓ | ✓ |
| | `rc5` (historisch) | user | ✓ | ✓ |

## Redaktionsregeln

- Benutzersprache, Oberflächenbegriffe aus Locales (DE/EN).
- Primäres Team / Default Team; Weitere Teams / Zusatzpositionen; A/G/R bzw. E/B/R.
- Schwellen und Mindestbesetzung als konfigurierbare Regeln, nicht als Gesetz.
- Ferien-Saldo und Kapazität immer berechnet.
- Keine Betriebsgeheimnisse, keine internen URLs (`rpp_page` = Navigationsname).

## Frontmatter

```yaml
---
title: …
lang: de
audience: user          # oder team-owner
rpp_page: Übersicht
kb_version: 4.0.7 (Friends & Family)
updated: 2026-08-12
---
```

## Pflege

- Nach UI-/Regeländerungen Texte anpassen, `kb_version`/`updated` setzen.
- Foundry Vector Store **manuell neu indexieren** (v1).
- DE und EN gleichwertig.

## Abnahme

- Einstiegsfragen EO-450 §1.
- Owner-Fragen nur als Owner beantwortbar; als employee: kein Admin-How-to, klarer Hinweis auf Owner-Rolle.
- Negativtests: Code/Betrieb → «weiss ich nicht».
