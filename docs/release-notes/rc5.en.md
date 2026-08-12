---
title: What's new in RPP RC5
lang: en
audience: user
kb_version: RC5 (4.0.5)
updated: 2026-07-30
---

# What's new in RPP RC5

This overview describes what has changed for users in the currently shipped release.

## New calendar view

The planning timeline on the **Overview** page has a third form of presentation: **Calendar (month)**. It shows one month as a classic grid with a calendar-week column, in the style of the Outlook and Teams calendars. Absences appear as compact bars; if not all entries fit into a day, **+n more** appears. You page between months with the arrows, and **Today** jumps back to the current date.

The existing **Bars (Gantt)** and **List** views remain unchanged.

## A clearer timeline

- The controls for period, grouping and view have moved into a compact toolbar in the title row.
- The legend for public and school holidays is now a slim row at the bottom.
- Rows show profile photos instead of just initials.
- The vacation figures **E** (entitlement), **B** (booked) and **R** (remaining days) have explanatory tooltips. Whether they are shown is set by the team in the Team Admin Center.
- The timeline is noticeably faster with many people and long periods.

## From the Outlook appointment back into the app

An Outlook appointment created by RPP now contains an **Open in RPP** link. It leads directly to the matching absence in the timeline. If the absence no longer exists, you land on **My requests**.

## More configuration options for teams

Team owners can now do the following in the **Team Admin Center**:

- Manage **absence types** themselves — add custom types and define per type whether it requires approval and whether it consumes the vacation balance. Changes appear in the absence form immediately.
- **Manage teams** — create, rename and delete teams and set their display order independently of alphabetical sorting.
- Map **organisations and locations** — assign the values from the Microsoft 365 profile to the organisations and locations configured in RPP.
- Choose **event colours** — colour bars by absence type or by team.
- Record the **required staffing** per team, from which the critical weeks in Team capacity are derived.
- Update public holiday and school holiday calendars.

## Known limitations

- If a vacation request exceeds the available balance, RPP warns but does not block submission.
- Approvals are still decided exclusively in the Microsoft Teams "Approvals" app. There is no approval inbox, no reminders and no delegation in RPP.
