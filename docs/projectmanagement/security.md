# Security Baseline

EO-304 establishes the Version 1.0 application security baseline. The application remains a Microsoft Teams / Microsoft 365 app: identity, tenant authentication, conditional access, MFA, and admin consent are delegated to Microsoft Entra ID and the Microsoft Teams/SPFx host.

## Implemented Baseline

- Authentication is isolated behind `Microsoft365AuthProvider`; UI components never request or store access tokens.
- Microsoft Graph and SharePoint access stay inside `src/infrastructure/microsoft365/`.
- Runtime configuration accepts SharePoint site URLs only over HTTPS and only for `*.sharepoint.com` hosts.
- Local backend secrets stay outside source control through `.NET User Secrets`; versioned `appsettings.json` files keep placeholders only.
- Frontend runtime configuration remains a public configuration surface and must not contain secrets.
- Graph calls are restricted to `https://graph.microsoft.com`.
- SharePoint calls are restricted to the configured SharePoint site origin.
- Repository and logging diagnostics sanitize sensitive keys such as tokens, secrets, passwords, cookies, credentials, API keys, and authorization headers.
- Raw exception objects are reduced to safe name/message details before they are stored on application errors or repository errors.
- `index.html` defines a CSP/referrer baseline for static hosting scenarios.
- `npm run validate:security` checks source and built artefacts for the security baseline.
- `npm run validate:repo-hygiene` checks tracked files for common secret-hygiene violations before sharing or pushing the repository.

## Local Secret Workflow

The complete secret architecture — repository placeholders, local User Secrets, Azure App Service settings, and why deploy artefacts are secret-free — is documented in [secret-management.md](secret-management.md). For local development the rules are:

1. Keep SQL connection strings, Entra client secrets, and comparable confidential values in `.NET User Secrets` for the API project.
2. Keep `RppWebApi/appsettings.json` free of real secrets; committed values must remain placeholders only.
3. Treat `public/config/runtime-config.js` and all `VITE_*` variables as browser-visible configuration, not as a secret store.
4. Use `.env.example` as the committed reference and keep real `.env`, `.env.local`, and similar files untracked.
5. Run `npm run validate:repo-hygiene` before the first push of a new branch or repository copy.
6. Run `npm run install:git-hooks` after repository initialization to enable the repo-local `pre-commit` validation hook.

## Required Hosting Headers

SPFx/Teams hosting must enforce the same or stricter headers at the hosting layer. The CSP meta tag is a development/static baseline and does not replace production headers.

Recommended production headers:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://graph.microsoft.com https://*.sharepoint.com; connect-src 'self' https://graph.microsoft.com https://*.sharepoint.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors https://teams.microsoft.com https://*.teams.microsoft.com https://*.sharepoint.com
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

## Boundaries

EO-304 does not implement tenant-wide security controls, WAF rules, SOC monitoring, penetration testing, external vulnerability scanning, or compliance certification. These remain deployment and operations responsibilities.
