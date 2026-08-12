# Docker Development Setup

Lokales Docker-Setup für die RPP Web API und optional PostgreSQL.

## Ziel

- .NET SDK nur im Build-Container
- Laufzeit in einem schlanken ASP.NET-Runtime-Container
- Assembly-Version aus `release.json` (EO-427) auch im Image
- Relationaler Planning-Store wählbar (`Planning:Provider`, ADR-007 / EO-458)

## Relevante Dateien

| Datei | Rolle |
| --- | --- |
| `RppWebApi/Dockerfile` | Multi-stage Build (Context = **Repo-Root**) |
| `.dockerignore` | schlanker Build-Context am Repo-Root |
| `docker-compose.api.yml` | API-Container + eingebundenes Postgres |
| `docker-compose.postgres.yml` | nur PostgreSQL (für `dotnet run` auf dem Host) |

## Voraussetzungen

- Docker Engine
- Docker Compose (`docker compose`)

## API + PostgreSQL lokal starten

Im Repository-Root:

```bash
docker compose -f docker-compose.api.yml up -d --build
```

Das startet:

1. `rpp-postgres` (Postgres 16, User/DB/Passwort `rpp`, Port `5432`)
2. `rpp-webapi` (HTTP `http://localhost:5004` → Container-Port `8080`)

Defaults in Compose:

| Variable | Default |
| --- | --- |
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `ASPNETCORE_URLS` | `http://+:8080` |
| Port-Mapping | `5004:8080` |
| `ApiSettings__RequireAuthentication` | `false` (nur lokaler Smoke-Test) |
| `Planning__Provider` | `postgres` |
| `ConnectionStrings__DefaultConnection` | `Host=rpp-postgres;Port=5432;Database=rpp;Username=rpp;Password=rpp` |

Die API wartet auf den Postgres-Healthcheck, legt bei leerer DB das Schema an (`CreateTables`, EO-458) und bedient danach die Planning-Endpunkte.

## Health-Check

```bash
curl -i http://localhost:5004/health
```

Erwartet: `HTTP/1.1 200 OK`. Die Antwort enthält u. a. `planningStore` (`postgres` / `sql` / …) und die Assembly-Version aus `release.json`.

## Stoppen

```bash
docker compose -f docker-compose.api.yml down
```

Volumes (Postgres-Daten) bleiben standardmässig erhalten. Mit Daten löschen:

```bash
docker compose -f docker-compose.api.yml down -v
```

## Nur PostgreSQL (API per `dotnet run`)

```bash
docker compose -f docker-compose.postgres.yml up -d

cd RppWebApi
dotnet user-secrets set "Planning:Provider" "postgres"
dotnet user-secrets set "ConnectionStrings:DefaultConnection" "Host=127.0.0.1;Port=5432;Database=rpp;Username=rpp;Password=rpp"
dotnet run
```

## Engine / Connection überschreiben

### Anderer Provider oder externer Connection String

PowerShell:

```powershell
$env:RPP_PLANNING_PROVIDER = "sql"
$env:RPP_DEFAULT_CONNECTION = "Server=<server>;Database=<db>;User Id=<user>;Password=<password>;TrustServerCertificate=True;Encrypt=True;"
docker compose -f docker-compose.api.yml up -d --build
```

bash:

```bash
export RPP_PLANNING_PROVIDER=sql
export RPP_DEFAULT_CONNECTION='Server=<server>;Database=<db>;User Id=<user>;Password=<password>;TrustServerCertificate=True;Encrypt=True;'
docker compose -f docker-compose.api.yml up -d --build
```

| Env-Var | Compose-Ziel |
| --- | --- |
| `RPP_PLANNING_PROVIDER` | `Planning__Provider` (`sql` \| `postgres` \| `mock` \| …) |
| `RPP_DEFAULT_CONNECTION` | `ConnectionStrings__DefaultConnection` |

Hinweis: Compose startet Postgres weiterhin mit (Health-Dependency). Für reines SQL Server ohne lokalen Postgres den Container nach dem Start stoppen oder ein eigenes Compose-File nutzen — für den Alltags-Dev-Pfad ist Postgres der Default.

### Image manuell bauen

Context **muss** das Repo-Root sein (wegen `release.json`):

```bash
docker build -f RppWebApi/Dockerfile -t rpp-webapi:local .
```

Ein Build mit Context `./RppWebApi` schlägt fehl (EO-427: Version nicht auflösbar).

## Hinweise

- Ohne erreichbare Datenbank und mit relationalem Provider starten Schema-Setup und Planning-Calls nicht zuverlässig; `/health` kann trotzdem `healthy` melden.
- Auth-Bypass (`RequireAuthentication=false`) ist nur für lokale Container-Tests gedacht — nie in produktiven Deployments.
- Secrets und Connection Strings gehören in Env-Vars oder Secret Stores, nicht in committed `appsettings*.json`.
- Frontend (Vite): `http://localhost:5173` mit `planningDataSource: "api"` gegen `http://localhost:5004`.
