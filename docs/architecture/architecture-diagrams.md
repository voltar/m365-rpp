# Architecture Diagrams (Mermaid)

Diese Seite bündelt die wichtigsten Mermaid-Diagramme für Applikation, Architektur und Datenflüsse der M365 RPP Teams App.

## 1) Gesamtarchitektur und Datenflüsse

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Segoe UI, Arial, sans-serif","primaryColor":"#0F6CBD","primaryTextColor":"#FFFFFF","primaryBorderColor":"#115EA3","secondaryColor":"#EFF6FC","tertiaryColor":"#F3F2F1","lineColor":"#8A8886","textColor":"#242424","background":"#FFFFFF"}}}%%
flowchart LR
  subgraph U["Benutzerkontext"]
    User["Mitarbeitende / Team Leads / Admins"]
    Teams["Microsoft Teams (Tab Host)"]
  end

  subgraph FE["Frontend (Vite + React + TypeScript + Fluent UI)"]
    AppShell["App Shell & Workspace Navigation"]
    Features["Feature Pages (Planning, Approvals, Reports, Settings)"]
    Services["Application Services"]
    Repos["Repository Interfaces"]
    Composition["Runtime Composition (mock/sharepoint/api/graph)"]
    Capacity["Capacity Engine"]
    I18n["Localization (DE/EN)"]
  end

  subgraph BE["Backend (ASP.NET Core Web API)"]
    Api["Planning & Approval APIs"]
    Auth["Entra ID / Teams SSO Validation"]
    Domain["Domain Services"]
    Ef["EF Core Repository"]
  end

  subgraph EXT["Datenquellen und M365 Integrationen"]
    Sql["SQL Server"]
    Spo["SharePoint Lists"]
    Graph["Microsoft Graph"]
    Flow["Power Automate"]
  end

  User --> Teams --> AppShell
  AppShell --> Features --> Services --> Repos --> Composition
  Services --> Capacity
  AppShell --> I18n

  Composition -->|mock mode| Services
  Composition -->|sharepoint mode| Spo
  Composition -->|api mode| Api
  Composition -->|graph membership| Graph

  Api --> Auth
  Api --> Domain --> Ef --> Sql
  Domain --> Graph
  Domain --> Flow
  Flow -->|Approval Callback| Api

  classDef accent fill:#0F6CBD,stroke:#115EA3,color:#FFFFFF,stroke-width:1px;
  classDef surface fill:#EFF6FC,stroke:#C7E0F4,color:#242424,stroke-width:1px;
  classDef neutral fill:#F3F2F1,stroke:#D1D1D1,color:#242424,stroke-width:1px;

  class Teams,AppShell,Features accent;
  class Services,Repos,Composition,Capacity,I18n,Api,Auth,Domain,Ef surface;
  class Sql,Spo,Graph,Flow,User neutral;
```

## 2) Sequence: Planung laden

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Segoe UI, Arial, sans-serif","primaryColor":"#0F6CBD","primaryTextColor":"#FFFFFF","primaryBorderColor":"#115EA3","secondaryColor":"#EFF6FC","tertiaryColor":"#F3F2F1","lineColor":"#8A8886","textColor":"#242424","background":"#FFFFFF"}}}%%
sequenceDiagram
  autonumber
  actor U as Benutzer
  participant T as Microsoft Teams
  participant FE as React App
  participant S as Planning Services
  participant R as Repository Layer
  participant C as Runtime Composition
  participant API as RPP Web API
  participant DB as SQL Server
  participant G as Microsoft Graph
  participant SPO as SharePoint

  U->>T: Öffnet RPP Tab
  T->>FE: Lädt App + Teams Kontext
  FE->>S: Bootstrap Planung
  S->>R: Snapshot anfordern
  R->>C: Provider auswählen

  alt api mode
    C->>API: GET /api/planning/*
    API->>DB: Planungsdaten lesen
    API->>G: Membership ergänzen
    DB-->>API: Daten
    G-->>API: Membership
    API-->>C: RepositoryResult Snapshot
  else sharepoint mode
    C->>SPO: Listen lesen
    C->>G: Membership lesen
    SPO-->>C: Planungsdaten
    G-->>C: Membership
  else mock mode
    C->>C: Mockdaten laden
  end

  C-->>R: Snapshot
  R-->>S: Snapshot
  S->>S: Capacity berechnen
  S-->>FE: ViewModel ready
  FE-->>U: Timeline + Team Capacity
```

## 3) Sequence: Vacation Approval auslösen

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Segoe UI, Arial, sans-serif","primaryColor":"#0F6CBD","primaryTextColor":"#FFFFFF","primaryBorderColor":"#115EA3","secondaryColor":"#EFF6FC","tertiaryColor":"#F3F2F1","lineColor":"#8A8886","textColor":"#242424","background":"#FFFFFF"}}}%%
sequenceDiagram
  autonumber
  actor U as Benutzer
  participant FE as React App
  participant S as Approval Service
  participant R as Approval Repository
  participant C as Approval Provider
  participant API as RPP Web API
  participant PA as Power Automate
  participant MSA as Microsoft Approvals

  U->>FE: Submit Vacation Request
  FE->>S: submitVacationRequest()
  S->>R: Richtlinie + Routing prüfen
  R->>C: approvalMode auflösen

  alt m365 mode
    C->>API: POST /api/approval/request
    API->>PA: Start Flow
    PA->>MSA: Create Approval
    MSA-->>PA: Decision
    PA-->>API: Callback approved/rejected
    API-->>C: Aktualisierter Status
  else mock mode
    C->>C: Simulierter Entscheid
  end

  C-->>R: VacationRequest Status
  R-->>S: Domain Result
  S-->>FE: UI Refresh
  FE-->>U: Status sichtbar
```

## 4) C4 Context

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Segoe UI, Arial, sans-serif","primaryColor":"#0F6CBD","primaryTextColor":"#FFFFFF","primaryBorderColor":"#115EA3","secondaryColor":"#EFF6FC","tertiaryColor":"#F3F2F1","lineColor":"#8A8886","textColor":"#242424","background":"#FFFFFF"}}}%%
C4Context
  title M365 RPP Teams App - System Context

  Person(user, "Mitarbeitende", "Planen Abwesenheiten und Verfügbarkeiten")
  Person(lead, "Team Leads / Admins", "Steuern Policies, Teams und Freigaben")

  System(rpp, "M365 RPP Teams App", "Ressourcen-, Präsenz- und Kapazitätsplanung")

  System_Ext(teams, "Microsoft Teams", "Host der Tab-Applikation")
  System_Ext(entra, "Entra ID", "Authentifizierung und SSO")
  System_Ext(graph, "Microsoft Graph", "Team-Membership und Identitäten")
  System_Ext(spo, "SharePoint Online", "Planungsdaten im SPO-Modus")
  System_Ext(pa, "Power Automate", "Approval Workflows")
  System_Ext(sql, "SQL Server", "Planungsdaten im API-Modus")

  Rel(user, teams, "Öffnet Tab")
  Rel(lead, teams, "Nutzt Team- und Approval-Features")
  Rel(teams, rpp, "Hostet App und liefert Kontext")
  Rel(rpp, entra, "Nutzt SSO")
  Rel(rpp, graph, "Liest Membership/Identität")
  Rel(rpp, spo, "Liest/Schreibt Planungsdaten (sharepoint mode)")
  Rel(rpp, pa, "Startet und empfängt Approval-Events")
  Rel(rpp, sql, "Nutzt Daten über API (api mode)")
```

## 5) C4 Container

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Segoe UI, Arial, sans-serif","primaryColor":"#0F6CBD","primaryTextColor":"#FFFFFF","primaryBorderColor":"#115EA3","secondaryColor":"#EFF6FC","tertiaryColor":"#F3F2F1","lineColor":"#8A8886","textColor":"#242424","background":"#FFFFFF"}}}%%
C4Container
  title M365 RPP Teams App - Container

  Person(user, "Benutzer")

  Container_Boundary(fe, "Frontend (Teams Tab)") {
    Container(spa, "React SPA", "React + TypeScript + Fluent UI", "UI und Interaktionen")
    Container(appSvc, "Application Services", "TypeScript", "Planung, Approval, Capacity")
    Container(repo, "Repository Layer", "TypeScript", "Vertragsbasierter Datenzugriff")
    Container(comp, "Runtime Composition", "TypeScript", "Provider-Auswahl mock/sharepoint/api/graph")
  }

  Container_Boundary(be, "Backend") {
    Container(api, "RPP Web API", "ASP.NET Core", "Planning- und Approval-Endpunkte")
    Container(domain, "Domain Services", "C#", "Businessregeln und Integrationen")
    Container(ef, "EF Core Repository", "C#", "Persistenz")
  }

  ContainerDb(sql, "SQL Server", "Relationale Datenbank", "Planungsdaten")
  System_Ext(graph, "Microsoft Graph", "Membership/Identität")
  System_Ext(spo, "SharePoint", "Planungslisten")
  System_Ext(pa, "Power Automate", "Approval Flows")
  System_Ext(teams, "Microsoft Teams", "Tab Host")

  Rel(user, teams, "Öffnet App")
  Rel(teams, spa, "Host + Kontext")
  Rel(spa, appSvc, "Ruft Services auf")
  Rel(appSvc, repo, "Nutzt Repositories")
  Rel(repo, comp, "Lädt Provider")
  Rel(comp, spo, "SharePoint Modus")
  Rel(comp, graph, "Graph Membership")
  Rel(comp, api, "API Modus")
  Rel(api, domain, "Delegiert Businesslogik")
  Rel(domain, ef, "Liest/schreibt Daten")
  Rel(ef, sql, "SQL")
  Rel(domain, graph, "Graph Integrationen")
  Rel(domain, pa, "Approval Workflows")
  Rel(pa, api, "Approval Callback")
```
