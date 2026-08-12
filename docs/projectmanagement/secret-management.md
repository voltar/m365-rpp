# Secret Management

How RPP keeps secrets out of the repository and out of every build artefact, and where the real values actually live. Established by EO-409 (repository secret hygiene); this document adds the end-to-end picture including deployment.

## The principle

The versioned [RppWebApi/appsettings.json](../../RppWebApi/appsettings.json) is intentionally non-functional on its own: every confidential value ships as an empty placeholder (`ClientSecret: ""`, `ConnectionStrings:DefaultConnection: ""`, `ApprovalFlow:CallbackSecret: ""`). Everything else in that file — TenantId, ClientId, Audience URI, group GUIDs — is a public **identifier**, not a secret, and may be versioned.

The real values are supplied at runtime from a source outside the repository. ASP.NET Core merges configuration sources in order, later sources overriding earlier ones:

```text
appsettings.json  →  .NET User Secrets (local dev only)  →  environment variables (Azure)
   placeholders          %APPDATA%\Microsoft\UserSecrets\           App Service settings
```

## Layer 1 – Repository: placeholders only

- Confidential values are empty strings in versioned appsettings.
- `public/config/runtime-config.js` and the Teams app package contain only public identifiers (client IDs, URLs, manifest IDs). There is never a client secret in the browser or in the Teams package — SSO tokens are issued to the user by Entra at runtime.
- Guards: `npm run validate:repo-hygiene` (and the pre-commit hook installed via `npm run install:git-hooks`) fails on non-empty `ClientSecret`/`DefaultConnection` in tracked appsettings, committed secret-like local files, or credential material in browser runtime config. `npm run build:deployment` additionally runs `validate:deployment` and `validate:security`.

## Layer 2 – Local development: .NET User Secrets

The API project declares a `UserSecretsId` in `RppWebApi.csproj`. Values set via `dotnet user-secrets` are stored under `%APPDATA%\Microsoft\UserSecrets\<UserSecretsId>\secrets.json` — outside the repository folder — and are merged over the appsettings placeholders when running locally (including `dotnet ef` commands).

```powershell
dotnet user-secrets set "ConnectionStrings:DefaultConnection" "<connection-string>" --project RppWebApi/RppWebApi.csproj
dotnet user-secrets set "AzureAd:ClientSecret" "<client-secret>" --project RppWebApi/RppWebApi.csproj
dotnet user-secrets list --project RppWebApi/RppWebApi.csproj
```

See [RppWebApi/README.md](../../RppWebApi/README.md) for the full local setup.

> **User Secrets are only loaded in the `Development` environment — and they currently point at the deployed database.** The stored `ConnectionStrings:DefaultConnection` targets `rpp-app-dev-server.database.windows.net` / `rpp-db-dev` with a DDL-capable login (`rpp_migration`). Any local run in `Development` — `dotnet run`, `dotnet ef`, or a local start of the published artefact — therefore operates against the **shared** database and applies pending migrations to it. Point the secret at a local database before doing schema work locally, or run with `ASPNETCORE_ENVIRONMENT=Production` (User Secrets are then not loaded, so the app has no connection string and skips migrations). Demo-data seeding additionally requires `ApiSettings:SeedDevelopmentData=true`, which defaults to `false`.

## Layer 3 – Azure: App Service environment variables

In the Azure Web App (Environment variables → App settings), the same keys are set with `__` as the section separator:

- `ConnectionStrings__DefaultConnection`
- `AzureAd__ClientSecret`
- `ApprovalFlow__CallbackSecret` (only when the Power Automate approval path is used)

Environment variables load **after** appsettings.json, so the placeholders are overridden — the same mechanism as user secrets locally, just sourced from the App Service configuration.

## Layer 3b – Host Europe: per-instance `kestrel.env`

Kestrel on Host Europe does **not** use Azure App Service settings. The systemd template unit `kestrel-rpp@.service` loads:

```text
EnvironmentFile=/var/www/vhosts/example.com/apps/%i/kestrel.env
```

For the Organisation-A / Voltar public host that is `/var/www/vhosts/example.com/apps/rpp-organisation-a/kestrel.env` (unit `kestrel-rpp@rpp-organisation-a`). The same secret keys apply (`AzureAd__ClientSecret`, `ConnectionStrings__DefaultConnection`, …). File mode should be `600`.

Do not commit `kestrel.env`. Prefer merging keys with
[`scripts/configure-hosteurope-kestrel-env.sh`](../../scripts/configure-hosteurope-kestrel-env.sh)
(run on the server) so connection strings are not wiped when rotating Entra. Full procedure:
[kestrel-hosteurope.md §4.1](../deploy/kestrel-hosteurope.md#41-kestrelenv--example-entra-scripted).

## Why deployments are secret-free

- The deploy zip (see [deployment.md](../deploy/deployment.md)) contains only the publish output — i.e. the placeholder appsettings. There is nothing confidential available to package.
- `az webapp deploy` (with or without `--clean true`) replaces only the files under wwwroot. App Service settings are stored separately and survive every deployment unchanged.
- Consequence: builds and deployments can be executed by anyone (including automation) without ever seeing or handling a secret value.

## The actual secrets, and rotation

The system has effectively three secrets:

| Secret | Where it lives | Rotation |
| --- | --- | --- |
| SQL / Postgres connection string | User Secrets (local) / `ConnectionStrings__DefaultConnection` (Azure App Service or Host Europe `kestrel.env`) | Rotate the DB credential, then update every store that uses it |
| Entra client secret (`AzureAd:ClientSecret`) | User Secrets (local) / `AzureAd__ClientSecret` (Azure App Service and/or Host Europe `kestrel.env` per edition) | Create the new secret in the matching Entra app registration, update the store(s) for that edition, then delete the old secret |
| Approval callback secret (`ApprovalFlow:CallbackSecret`) | Azure App Setting + Power Automate flow config | Only for the legacy Power Automate path; rotate in both places atomically |

Rotation ownership is recorded per tenant in the [customer onboarding parameter sheet](../distribution/customer-onboarding-parameter-sheet.md) (operational contacts).
