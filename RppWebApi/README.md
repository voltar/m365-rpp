# RPP Web API (Phase 2B)

Full backend for the M365 Resource & Presence Planning application.

## Quick Start

```bash
cd RppWebApi
dotnet run
```

API runs on:

- HTTP: http://localhost:5004
- HTTPS: https://localhost:5005
- Swagger: https://localhost:5005/swagger (when developer tools are enabled)

## Planning store (`Planning:Provider`)

Deployment configuration (ADR-002 / ADR-007). **No silent default in code** when the value is missing.

| Value | Engine / store |
| --- | --- |
| `sql` | SQL Server / Azure SQL + EF migrations (default in shipped `appsettings.json`) |
| `postgres` | PostgreSQL + EF (`UseNpgsql`); aliases `postgresql`, `npgsql` |
| `sharepoint` | SharePoint lists (EO-430; incomplete writes gated) |
| `mock` | In-memory demo data |

### SQL Server

```bash
dotnet user-secrets set "Planning:Provider" "sql" --project .\RppWebApi.csproj
dotnet user-secrets set "ConnectionStrings:DefaultConnection" "Server=...;Database=...;User Id=...;Password=...;Encrypt=True;" --project .\RppWebApi.csproj
```

Startup runs `Database.Migrate()`.

### PostgreSQL (EO-458)

**API + Postgres in Docker** (recommended local smoke path; see `docs/distribution/Docker-development-setup.md`):

```bash
# repo root — builds with release.json (EO-427) and defaults Planning:Provider=postgres
docker compose -f docker-compose.api.yml up -d --build
curl -i http://localhost:5004/health
```

**Postgres only**, API via `dotnet run` on the host:

```bash
docker compose -f docker-compose.postgres.yml up -d

dotnet user-secrets set "Planning:Provider" "postgres" --project .\RppWebApi.csproj
dotnet user-secrets set "ConnectionStrings:DefaultConnection" "Host=127.0.0.1;Port=5432;Database=rpp;Username=rpp;Password=rpp" --project .\RppWebApi.csproj
```

Startup creates tables from the current model when the database is empty. In-place dual EF migration history for PostgreSQL is a follow-up (ADR-007); non-prod recreate is acceptable until then.

### Other secrets

```bash
dotnet user-secrets set "AzureAd:ClientSecret" "..." --project .\RppWebApi.csproj
dotnet user-secrets list --project .\RppWebApi.csproj
```

Keep `ClientSecret` and `DefaultConnection` empty in committed `appsettings*.json`.

## Health

`GET /health` reports `planningStore` (`sql` | `postgres` | …), `backendProvider`, and database host/name when relational.

## Frontend

The SPA talks only to the API (`planningDataSource: "api"`). It does not choose SQL vs PostgreSQL.

---

Part of **M365 Ressourcen & Präsenzplanung**. Follows AGENTS.md, ADR-002, ADR-007.
