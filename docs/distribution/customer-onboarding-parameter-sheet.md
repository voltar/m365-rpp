# Customer Onboarding Parameter Sheet

Revision: **EO-500R** (2026-07-20).

Use this sheet for every tenant onboarding. Keep it tenant-specific and store it with the deployment handover package.

## Tenant Identity

| Field | Placeholder / Example | Notes |
| --- | --- | --- |
| Tenant name | `<customer tenant name>` | Human-readable customer name |
| Tenant ID | `<entra-tenant-id>` | Entra tenant GUID |
| Primary environment | `dev` / `test` / `prod` | Deployment target |
| Business owner | `<customer owner>` | Customer-side product owner |

## Application Registration Values

| Field | Placeholder / Example | Notes |
| --- | --- | --- |
| RPP API client ID | `<api-client-id>` | Used in Azure AD / Teams SSO. Also set as `AppId` in `scripts/rpp-config.psd1`. |
| Entra app Object ID | `<entra-app-object-id>` | Object ID of the app registration. Set as `ObjectId` in `scripts/rpp-config.psd1`. |
| RPP API audience | `api://<api-host-domain>/<api-client-id>` | Domain-form Application ID URI — Teams SSO requires this form; must match the URI exposed in Entra. `<api-host-domain>` goes into `ApiDomain` in `scripts/rpp-config.psd1`. |
| Teams tab client ID | `<tab-client-id>` | If separate from the API app |
| Teams package id | `<manifest-id>` | `teams-app-package/manifest.json -> id` |
| API delegated scope | `api://<api-host-domain>/<api-client-id>/access_as_user` | Used by runtime config (`apiAccessTokenScopes`) |

## Hosting and Runtime

| Field | Placeholder / Example | Notes |
| --- | --- | --- |
| Web App resource group | `<resource-group>` | Azure App Service target group |
| Web App name | `<app-service-name>` | Backend deployment target |
| API base URL | `https://<app-service-name>.azurewebsites.net` | Must be HTTPS in non-local envs |
| Frontend origin | `https://<app-service-name>.azurewebsites.net` | CORS origin |
| Runtime config file | `public/config/runtime-config.js` | Deployment default or exported config |

## SharePoint

| Field | Placeholder / Example | Notes |
| --- | --- | --- |
| SharePoint site URL | `https://<tenant>.sharepoint.com/sites/<site>` | Required for `sharepoint` provider. Set as `SharePointSiteUrl` in `scripts/rpp-config.psd1`. |
| Site owner | `<site owner>` | Needed for list provisioning |
| Provisioning principal | `<client-id or user>` | PnP.PowerShell login identity. Set as `AppId` in `scripts/rpp-config.psd1` if using app-only auth. |

## Approval Flow

| Field | Placeholder / Example | Notes |
| --- | --- | --- |
| Approval mode | `mock` / `m365` | Must match runtime config |
| Power Automate flow URL | `<logic-app-or-flow-url>` | Required for EO-207 style handover |
| Callback secret | `<shared-secret>` | Store outside source control |
| Teams Approvals owner | `<owner>` | Operational owner for approvals |

## Outlook Sync Deep Link (EO-421)

| Field | Placeholder / Example | Notes |
| --- | --- | --- |
| Teams app catalog ID | `<teams-app-catalog-id>` | `OutlookSync:TeamsAppId` app setting — the id of the installed Teams app (manifest `id`, or the catalog id after upload). Empty disables the "In RPP öffnen" link in synced Outlook events |
| Tab entity ID | `rpp-planning` | `OutlookSync:TabEntityId` app setting — static tab `entityId` from the Teams manifest; only change when the manifest changes |

## Operational Contacts

| Field | Placeholder / Example | Notes |
| --- | --- | --- |
| Primary support contact | `<support-contact>` | First-line contact |
| Escalation contact | `<escalation-contact>` | For failed deployment or auth issues |
| Secret rotation owner | `<owner>` | Responsible for credential updates |
| Release approver | `<approver>` | Customer-side release gate |
