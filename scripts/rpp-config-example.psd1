@{
    # =========================================================================
    # RPP PowerShell Scripts — Shared Configuration
    # Profile: example  →  .\configure-entra-sso.ps1 -Profile example
    # Sibling: azure    →  .\configure-entra-sso.ps1   (rpp-config.psd1)
    # =========================================================================
    # All values below are PUBLIC IDENTIFIERS (not secrets).
    # Secrets (client secrets, connection strings) must NEVER appear here.
    # See: docs/projectmanagement/secret-management.md
    # =========================================================================

    # Entra App Registration (replace with your second environment's app)
    AppId    = '00000000-0000-0000-0000-000000000003'
    ObjectId = '00000000-0000-0000-0000-000000000013'

    # RPP Web API domain (used to construct the Teams SSO identifier URI)
    ApiDomain = 'rpp.example.com'

    # SharePoint Online (default site; scripts may override via parameters)
    SharePointSiteUrl = 'https://contoso.sharepoint.com/sites/rpp'

    # Microsoft Graph well-known AppId (constant across all tenants)
    GraphResourceAppId = '00000003-0000-0000-c000-000000000000'

    # Preauthorized Microsoft 365 / Teams client AppIds (constant across all tenants)
    TeamsMobileAppId      = '1fec8e78-bce4-4aaf-ab1b-5451cc387264'
    TeamsWebAppId         = '5e3ce6c0-2b1f-4285-8d4b-75ee78787346'
    M365WebAppId          = '4765445b-32c6-49b0-83e6-1d93765276ca'
    M365DesktopAppId      = '0ec893e0-5785-4de6-99da-4ed124e5296c'
}
