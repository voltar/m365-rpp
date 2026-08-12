# Shared loader for scripts/rpp-config*.psd1 (public identifiers only, no secrets).
# Dot-source from configure-*.ps1, then call Import-RppConfig.
#
# Profiles (file name convention):
#   azure     -> scripts/rpp-config.psd1              (Azure Web App / Azure SQL)
#   example  -> scripts/rpp-config-example.psd1    (Host Europe / rpp.example.com)
#
# Optional overrides (still supported after load):
#   RPP_APP_ID, RPP_OBJECT_ID, RPP_API_DOMAIN

function Resolve-RppConfigPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $ScriptsRoot,

        [ValidateSet('azure', 'example')]
        [string] $Profile = 'azure',

        [string] $ConfigPath
    )

    if ($ConfigPath) {
        if (-not (Test-Path -LiteralPath $ConfigPath)) {
            throw "Config file not found: $ConfigPath"
        }
        return (Resolve-Path -LiteralPath $ConfigPath).Path
    }

    $fileName = if ($Profile -eq 'example') { 'rpp-config-example.psd1' } else { 'rpp-config.psd1' }
    $path = Join-Path $ScriptsRoot $fileName
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Config file for profile '$Profile' not found: $path"
    }
    return $path
}

function Import-RppConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $ScriptsRoot,

        [ValidateSet('azure', 'example')]
        [string] $Profile = 'azure',

        [string] $ConfigPath
    )

    $resolvedPath = Resolve-RppConfigPath -ScriptsRoot $ScriptsRoot -Profile $Profile -ConfigPath $ConfigPath
    $config = Import-PowerShellDataFile -Path $resolvedPath

    $appId = if ($env:RPP_APP_ID) { $env:RPP_APP_ID } else { $config.AppId }
    $objectId = if ($env:RPP_OBJECT_ID) { $env:RPP_OBJECT_ID } else { $config.ObjectId }
    $apiDomain = if ($env:RPP_API_DOMAIN) { $env:RPP_API_DOMAIN } else { $config.ApiDomain }

    if (-not $appId) { throw "AppId missing in $resolvedPath (or set RPP_APP_ID)." }
    if (-not $objectId) { throw "ObjectId missing in $resolvedPath (or set RPP_OBJECT_ID)." }
    if (-not $apiDomain) { throw "ApiDomain missing in $resolvedPath (or set RPP_API_DOMAIN)." }

    $inferredProfile = if ($ConfigPath) {
        'custom'
    } else {
        $Profile
    }

    Write-Host "RPP config profile : $inferredProfile"
    Write-Host "RPP config file    : $resolvedPath"
    Write-Host "Entra AppId        : $appId"
    Write-Host "Entra ObjectId     : $objectId"
    Write-Host "API domain         : $apiDomain"
    Write-Host "Application ID URI : api://$apiDomain/$appId"
    Write-Host ""

    return [pscustomobject]@{
        Profile      = $inferredProfile
        ConfigPath   = $resolvedPath
        Raw          = $config
        AppId        = $appId
        ObjectId     = $objectId
        ApiDomain    = $apiDomain
        IdentifierUri = "api://$apiDomain/$appId"
        GraphResourceAppId = $config.GraphResourceAppId
        TeamsMobileAppId   = $config.TeamsMobileAppId
        TeamsWebAppId      = $config.TeamsWebAppId
        M365WebAppId       = $config.M365WebAppId
        M365DesktopAppId   = $config.M365DesktopAppId
        SharePointSiteUrl  = $config.SharePointSiteUrl
    }
}
