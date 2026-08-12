# Factsheet: M365 Ressourcen & Präsenzplanung (RPP)

**Classification:** Public source overview  
**Maintainer:** Voltar  
**License:** MIT

---

## Short description

RPP is a native Microsoft Teams tab application for operational resource, presence and capacity
planning. It combines timeline views, team capacity, absences, approvals, reporting and team
administration in one Fluent UI surface.

**Purpose:** cross-organisation operational visibility (for example Organisation-A and
Organisation-B in demo data), less coordination overhead, and a reliable view of teams, roles,
absences, maintenance windows and capacity risk.

RPP is **not** a holiday calendar, SharePoint list customisation, Planner clone or Microsoft Project
replacement. It is an **operations planning platform**.

---

## Stack

| Layer | Technology |
|---|---|
| Client | React 18, TypeScript, Vite, Fluent UI v9, Teams JS SDK |
| API | ASP.NET Core 8, EF Core |
| Data | SQL Server or PostgreSQL (or SharePoint / mock per installation) |
| Identity | Microsoft Entra ID, Microsoft Graph |

---

## Demo organisations

Mock and sample configuration use generic names:

- **Organisation-A**
- **Organisation-B**

Replace them with your own organisations in Team Admin / org configuration for a real deployment.

---

## Further reading

- [Product vision](product-vision.md)
- [Secret management](secret-management.md)
- [Architecture](../architecture/architecture.md)
- [Customer onboarding playbook](../distribution/customer-onboarding-playbook.md)
