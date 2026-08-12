# AGENTS.md

# M365 Ressourcen & Präsenzplanung

Version: 2.0
Project Owner: Voltar
Application: Microsoft Teams
Technology: vite, React, TypeScript, Fluent UI, ASP.NET Core API, Kubernetes
License: MIT

---

Engineering guidance

Prefer small, reviewable changes. Keep feature work and low-level refinement separate when practical.
Historical Engineering Order (EO) numbers may appear in comments and the changelog as navigation aids;
they are not a required process for external contributors.


# Mission

Develop a professional Microsoft 365 application for enterprise resource,
presence and capacity planning.

This is NOT a SharePoint customization.

This is NOT a Power Apps prototype.

This project shall feel like a native Microsoft Teams application.

Every design and implementation decision must support this vision.

---

# Product Vision

The application shall become the central planning platform for

- Vacation
- Home Office
- On Call
- Standby
- Training
- Maintenance Windows
- Projects
- Rollouts
- Skill Coverage
- Team Capacity
- Organisation-A / Organisation-B collaboration

The goal is operational visibility.

Not simply absence management.

---

# Primary Design Principles

Priority order

1. User Experience
2. Simplicity
3. Maintainability
4. Scalability
5. Performance

If there is a conflict between architecture and user experience,
prefer the better user experience.

---

# UI Principles

The application must look like an official Microsoft product.

Always use

- Fluent UI
- Microsoft Design Language
- clean spacing
- modern typography
- responsive layout

Avoid

- SharePoint default look
- old Office styling
- excessive dialogs
- unnecessary clicks

---

# Localization

Localization is mandatory.

Never hardcode UI strings.

Supported languages

- German
- English

Use localization resources from Sprint 1.

Other languages are supported, but only by triggering a build language script (as defined in later Engineering Orders)

---

# Data Model

The data model is more important than the UI.

Never assume

Employee -> one Team

Instead

Employee -> many Teams

Employee -> many Skills

Employee -> many Roles

Support

- Primary Team
- Secondary Team
- Critical Role

---

# Organisation Model

The application must support cross-tenant organizations such as ...

- Organisation-A
- Organisation-B

without hardcoded dependencies.

Organisation, locations and teams must be configurable.

---

# Future Modules

Architecture must allow future modules without redesign.

Examples

- Outlook Synchronisation
- Power BI
- Microsoft Graph
- Power Automate
- Planner
- Teams Presence
- ky2help Integration

---

# Code Quality

Prefer

small components

strong typing

interfaces

services

composition

readability

Avoid

magic strings

duplicate code

large components

tight coupling

---

# React

Prefer

Functional Components

Hooks

Context where appropriate

Reusable Controls

Avoid

Class Components

Deep Prop Drilling

---

# TypeScript

Strict mode.

No "any" unless absolutely unavoidable.

Prefer

interfaces

readonly

enums

utility types

---

# SharePoint

Sprint 1

NO backend.

Only mock data.

Sprint 2

Introduce SharePoint Lists.

Never mix UI logic with SharePoint access.

Always use service classes.

Future Sprints

 Backend in database


---

# Dummy Data

Mock data shall simulate

- multiple organisations
- multiple teams
- vacation
- training
- maintenance
- projects
- standby
- school holidays

The UI must always look realistic.

---

# Architecture

Target Architecture

Teams

↓

SPFx or vite

↓

React

↓

Services

↓

Database via API or SharePoint Lists

↓

Microsoft Graph

↓

Power Automate (optional)

↓

Power BI (optional)

---

# Performance

Virtualize long lists.

Avoid unnecessary renders.

Prefer lazy loading.

Never optimise prematurely.

---

# Accessibility

Respect Fluent UI accessibility.

Keyboard navigation.

High contrast support.

Screen reader compatibility where practical.

---

# Documentation

Every Sprint shall update

README

CHANGELOG

ROADMAP

Architecture documentation

---

# Git

Use meaningful commits.

Examples

feat:

fix:

refactor:

docs:

test:

style:

---

# Coding Philosophy

Write code as if Microsoft engineers will review it.

Readable code is more important than clever code.

Always optimise for long-term maintainability.

---

# Product Philosophy

This application is an Operations Planning Platform.

It is NOT a vacation calendar.

Every new feature should improve operational awareness.

---

# Definition of Done

A feature is complete only if

✓ UI is polished

✓ Responsive

✓ Localized

✓ Typed

✓ Documented

✓ No duplicated logic

✓ Works inside Microsoft Teams

✓ Ready for next sprint

---

# Motto

Build something that users believe Microsoft should have delivered.


