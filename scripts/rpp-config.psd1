@{
    # =========================================================================
    # RPP PowerShell Scripts – Shared Configuration
    # Profile: azure  (default)  →  .\configure-entra-sso.ps1
    # Sibling: swisskmu          →  .\configure-entra-sso.ps1 -Profile swisskmu
    # =========================================================================
    # All values below are PUBLIC IDENTIFIERS (not secrets).
    # Secrets (client secrets, connection strings) must NEVER appear here.
    # See: docs/secret-management.md
    # =========================================================================

    # Entra App Registration (Azure Web App / Azure SQL edition)
    AppId    = '1de7afde-9862-45b3-b632-0b25210f7d97'
    ObjectId = '2d357c89-b32e-4ce1-8c76-fdd1df38bc6d'

    # RPP Web API domain (used to construct the Teams SSO identifier URI)
    ApiDomain = 'rpp-dev-bmdkd3hmhqc9fjgd.switzerlandnorth-01.azurewebsites.net'

    # SharePoint Online (default site; scripts may override via parameters)
    SharePointSiteUrl = 'https://voltarsystemsgmbh.sharepoint.com/sites/rpp'

    # Microsoft Graph well-known AppId (constant across all tenants)
    GraphResourceAppId = '00000003-0000-0000-c000-000000000000'

    # Preauthorized Microsoft 365 / Teams client AppIds (constant across all tenants)
    TeamsMobileAppId      = '1fec8e78-bce4-4aaf-ab1b-5451cc387264'
    TeamsWebAppId         = '5e3ce6c0-2b1f-4285-8d4b-75ee78787346'
    M365WebAppId          = '4765445b-32c6-49b0-83e6-1d93765276ca'
    M365DesktopAppId      = '0ec893e0-5785-4de6-99da-4ed124e5296c'
}
