---
title: Neuerungen in RPP RC5
lang: de
audience: user
kb_version: RC5 (4.0.5)
updated: 2026-07-30
---

# Neuerungen in RPP RC5

Diese Übersicht beschreibt, was sich für Benutzerinnen und Benutzer im aktuell ausgelieferten Stand geändert hat.

## Neue Kalenderansicht

Die Planungstimeline auf der Seite **Übersicht** hat eine dritte Darstellungsform: **Kalender (Monat)**. Sie zeigt einen Monat als klassisches Raster mit Kalenderwochen-Spalte, im Stil des Outlook- und Teams-Kalenders. Abwesenheiten erscheinen als kompakte Balken; passen an einem Tag nicht alle Einträge, erscheint **+n weitere**. Zwischen den Monaten blättern Sie mit den Pfeilen, mit **Heute** springen Sie zurück zum aktuellen Datum.

Die bisherigen Ansichten **Balken (Gantt)** und **Liste** bleiben unverändert erhalten.

## Übersichtlichere Timeline

- Die Bedienelemente für Zeitraum, Gruppierung und Ansicht sind in eine kompakte Werkzeugleiste in der Titelzeile gewandert.
- Die Legende für Feiertage und Schulferien steht neu als schmale Zeile am unteren Rand.
- In den Zeilen erscheinen Profilfotos statt nur der Initialen.
- Die Ferien-Kennzahlen **A** (Anspruch), **G** (Gebucht) und **R** (Resttage) haben erklärende Tooltips. Ob sie angezeigt werden, legt das Team im Team Admin Center fest.
- Die Timeline reagiert bei vielen Personen und langen Zeiträumen spürbar schneller.

## Vom Outlook-Termin zurück in die App

Ein aus RPP erzeugter Outlook-Termin enthält neu den Link **In RPP öffnen**. Er führt direkt zur zugehörigen Abwesenheit in der Timeline. Existiert die Abwesenheit nicht mehr, landen Sie auf **Meine Anträge**.

## Mehr Konfigurationsmöglichkeiten für Teams

Team-Besitzer können im **Team Admin Center** neu:

- **Abwesenheitstypen** selbst verwalten — eigene Typen ergänzen und pro Typ festlegen, ob er genehmigungspflichtig ist und ob er das Ferienguthaben belastet. Änderungen erscheinen sofort im Abwesenheitsformular.
- **Teams verwalten** — Teams erstellen, umbenennen, löschen und ihre Anzeigereihenfolge unabhängig von der alphabetischen Sortierung festlegen.
- **Organisationen und Standorte** zuordnen — die Werte aus dem Microsoft-365-Profil den in RPP konfigurierten Organisationen und Standorten zuweisen.
- **Ereignisfarben** wählen — Balken nach Abwesenheitstyp oder nach Team einfärben.
- Die **Mindestbesetzung** je Team hinterlegen, aus der sich die kritischen Wochen in der Team-Kapazität ergeben.
- Feiertags- und Schulferienkalender aktualisieren.

## Bekannte Einschränkungen

- Überschreitet ein Ferienantrag das verfügbare Guthaben, warnt RPP, blockiert das Einreichen aber nicht.
- Genehmigungen werden weiterhin ausschliesslich in der Microsoft-Teams-App «Approvals» entschieden. Es gibt in RPP keinen Genehmigungs-Posteingang, keine Erinnerungen und keine Delegation.
