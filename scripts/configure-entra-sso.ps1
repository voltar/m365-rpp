# Configures the Entra app registration for Teams SSO.
# Adds: Application ID URI, the access_as_user scope, and preauthorized Teams/M365 client apps.
# Idempotent: running it again overwrites with the same desired state.
# Requires: az login as an account that can manage the app registration.
#
# App registration details come from scripts/rpp-config*.psd1 (public identifiers only).
#
# Usage:
#   .\scripts\configure-entra-sso.ps1                      # Azure / default (rpp-config.psd1)
#   .\scripts\configure-entra-sso.ps1 -Profile example    # Host Europe (rpp-config-example.psd1)
#   .\scripts\configure-entra-sso.ps1 -ConfigPath .\scripts\rpp-config-example.psd1
#
# Optional env overrides after profile load: RPP_APP_ID, RPP_OBJECT_ID, RPP_API_DOMAIN

[CmdletBinding()]
param(
    [ValidateSet('azure', 'example')]
    [string] $Profile = 'azure',

    [string] $ConfigPath
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot/lib/Import-RppConfig.ps1"
$rpp = Import-RppConfig -ScriptsRoot $PSScriptRoot -Profile $Profile -ConfigPath $ConfigPath

$appId = $rpp.AppId
$objectId = $rpp.ObjectId
$identifierUri = $rpp.IdentifierUri
$scopeId = [guid]::NewGuid().ToString()

# Reuse the existing scope id if access_as_user already exists (keeps preauthorizations stable)
$existing = az ad app show --id $appId --query "api.oauth2PermissionScopes[?value=='access_as_user'].id | [0]" -o tsv 2>$null
if ($existing) { $scopeId = $existing; Write-Host "Reusing existing scope id $scopeId" }

# Teams SSO requires the domain form: api://<app-domain>/<client-id> (must match the
# Teams manifest webApplicationInfo.resource and the frontend apiAccessTokenScopes).
$patch1 = @{
    identifierUris = @($identifierUri)
    api = @{
        oauth2PermissionScopes = @(
            @{
                id = $scopeId
                value = "access_as_user"
                type = "User"
                isEnabled = $true
                adminConsentDisplayName = "Access RPP Web API as the signed-in user"
                adminConsentDescription = "Allows Teams to call the RPP Web API on behalf of the signed-in user."
                userConsentDisplayName = "Access RPP Web API on your behalf"
                userConsentDescription = "Allows the app to call the RPP Web API on your behalf."
            }
        )
    }
} | ConvertTo-Json -Depth 5

$patch2 = @{
    api = @{
        preAuthorizedApplications = @(
            @{ appId = $rpp.TeamsMobileAppId; delegatedPermissionIds = @($scopeId) }  # Teams Desktop/Mobile
            @{ appId = $rpp.TeamsWebAppId; delegatedPermissionIds = @($scopeId) }     # Teams Web
            @{ appId = $rpp.M365WebAppId; delegatedPermissionIds = @($scopeId) }      # Microsoft 365 Web
            @{ appId = $rpp.M365DesktopAppId; delegatedPermissionIds = @($scopeId) }  # Microsoft 365 Desktop
        )
    }
} | ConvertTo-Json -Depth 5

$tmp1 = Join-Path $env:TEMP "rpp-sso-patch1.json"
$tmp2 = Join-Path $env:TEMP "rpp-sso-patch2.json"
$patch1 | Set-Content $tmp1 -Encoding utf8
$patch2 | Set-Content $tmp2 -Encoding utf8

Write-Host "PATCH 1: Application ID URI + access_as_user scope..."
az rest --method PATCH --url "https://graph.microsoft.com/v1.0/applications/$objectId" --body "@$tmp1"

Write-Host "PATCH 2: preauthorized client applications..."
az rest --method PATCH --url "https://graph.microsoft.com/v1.0/applications/$objectId" --body "@$tmp2"

Remove-Item $tmp1, $tmp2 -Force

Write-Host ""
Write-Host "Verification:"
az ad app show --id $appId --query "{identifierUris:identifierUris, scopes:api.oauth2PermissionScopes[].value, preAuthorized:api.preAuthorizedApplications[].appId}" -o json
Write-Host ""
Write-Host "Done. Reload the RPP Teams tab (Ctrl+R). Profile was '$($rpp.Profile)'."
