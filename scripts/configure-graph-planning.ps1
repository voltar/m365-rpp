# Grants the Microsoft Graph *application* permissions the RPP Web API needs for planning:
#   GroupMember.Read.All  — /users/{id}/memberOf (personal-scope team picker) + group members/owners
#   Group.Read.All        — group display names and basic group properties
#   User.Read.All         — member displayName / UPN / photos (without this the UI shows "Unknown User")
#
# These are Application permissions (type Role), used with GetAccessTokenForAppAsync
# (client credentials). They are separate from delegated grants such as User.Read or
# ApprovalSolution.ReadWrite (see configure-graph-approvals.ps1).
#
# Field lesson (Host Europe / Voltar, 2026-08-11):
#   - AzureAd__ClientSecret must be the secret *Value*, never the Secret *ID*.
#   - list-grants only shows delegated oauth2PermissionGrants; application roles appear on
#     the service principal's appRoleAssignments (this script verifies both).
#   - After granting User.Read.All, restart Kestrel so the 5-minute Graph member cache drops
#     stale "Unknown User" rows.
#
# Requires: az login as an account that can manage the app registration and grant admin consent.
#
# Usage:
#   .\scripts\configure-graph-planning.ps1
#   .\scripts\configure-graph-planning.ps1 -Profile example
#   .\scripts\configure-graph-planning.ps1 -Profile example -VerifyOnly
#   .\scripts\configure-graph-planning.ps1 -Profile example -SkipConsent

[CmdletBinding()]
param(
    [ValidateSet('azure', 'example')]
    [string] $Profile = 'azure',

    [string] $ConfigPath,

    # Only report which application roles are already granted; do not mutate Entra.
    [switch] $VerifyOnly,

    # Add requiredResourceAccess but do not call admin-consent (portal consent instead).
    [switch] $SkipConsent
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot/lib/Import-RppConfig.ps1"
$rpp = Import-RppConfig -ScriptsRoot $PSScriptRoot -Profile $Profile -ConfigPath $ConfigPath

$appId = $rpp.AppId
$graphResourceAppId = $rpp.GraphResourceAppId

# Well-known Microsoft Graph application role (appRole) ids — stable across tenants.
# Source: Graph service principal appRoles where value matches the permission name.
$requiredAppRoles = @(
    [pscustomobject]@{ Value = 'GroupMember.Read.All'; Id = '62a82d76-70ea-41e2-9197-370581804d09'; Why = 'memberOf + group members/owners for planning and EO-428 team picker' }
    [pscustomobject]@{ Value = 'Group.Read.All';       Id = '98830695-27a2-44f7-8c18-0c3ebc9698f6'; Why = 'group display names (Alle - {name} seed, header badge)' }
    [pscustomobject]@{ Value = 'User.Read.All';        Id = 'df021288-bdef-4463-88db-98f22de89214'; Why = 'displayName/UPN/photos — without this timeline shows Unknown User' }
)

function Get-GraphSpObjectId {
    $spId = az ad sp show --id $graphResourceAppId --query id -o tsv 2>$null
    if (-not $spId) {
        throw "Microsoft Graph service principal ($graphResourceAppId) was not found in this tenant."
    }
    return $spId
}

function Get-RppSpObjectId {
    param([string] $ClientAppId)
    $spId = az ad sp show --id $ClientAppId --query id -o tsv 2>$null
    if (-not $spId) {
        throw "Service principal for app $ClientAppId was not found. Provision the enterprise app (az ad sp create --id $ClientAppId) or open the app once in the portal."
    }
    return $spId
}

function Get-GrantedAppRoleIds {
    param([string] $PrincipalObjectId)

    $json = az rest --method GET `
        --url "https://graph.microsoft.com/v1.0/servicePrincipals/$PrincipalObjectId/appRoleAssignments" `
        -o json 2>$null

    if (-not $json) {
        return @()
    }

    $payload = $json | ConvertFrom-Json
    return @($payload.value | ForEach-Object { $_.appRoleId })
}

Write-Host "Required Graph *application* permissions for RPP planning:"
foreach ($role in $requiredAppRoles) {
    Write-Host ("  - {0,-22} {1}" -f $role.Value, $role.Why)
}
Write-Host ""

if (-not $VerifyOnly) {
    Write-Host "Adding application permissions to app registration $appId ..."
    foreach ($role in $requiredAppRoles) {
        Write-Host "  + $($role.Value) ($($role.Id)=Role)"
        # Idempotent enough: Azure AD accepts re-add; duplicates on requiredResourceAccess are harmless.
        az ad app permission add `
            --id $appId `
            --api $graphResourceAppId `
            --api-permissions "$($role.Id)=Role" | Out-Null
    }

    if (-not $SkipConsent) {
        Write-Host ""
        Write-Host "Granting admin consent (application + delegated)..."
        az ad app permission admin-consent --id $appId
        Write-Host "Admin consent requested. Propagation can take a few seconds."
        Start-Sleep -Seconds 3
    }
    else {
        Write-Host ""
        Write-Host "SkipConsent set — grant admin consent in Entra portal: API permissions → Grant admin consent."
    }
}

Write-Host ""
Write-Host "Verification — app registration requiredResourceAccess (Graph):"
az ad app show --id $appId --query "requiredResourceAccess[?resourceAppId=='$graphResourceAppId'].resourceAccess[]" -o json

Write-Host ""
Write-Host "Verification — granted application roles on the service principal (what client credentials actually get):"
$rppSpId = Get-RppSpObjectId -ClientAppId $appId
$grantedIds = Get-GrantedAppRoleIds -PrincipalObjectId $rppSpId

$missing = @()
foreach ($role in $requiredAppRoles) {
    $ok = $grantedIds -contains $role.Id
    $mark = if ($ok) { 'OK ' } else { 'MISS' }
    Write-Host ("  [{0}] {1}  ({2})" -f $mark, $role.Value, $role.Id)
    if (-not $ok) {
        $missing += $role.Value
    }
}

Write-Host ""
Write-Host "Note: az ad app permission list-grants shows *delegated* grants only."
Write-Host "      Application roles must appear in appRoleAssignments (checked above)."
Write-Host ""
Write-Host "Client secret reminder:"
Write-Host "  Entra → Certificates & secrets shows Secret ID and Value."
Write-Host "  AzureAd__ClientSecret / kestrel.env must use the Value, never the Secret ID."
Write-Host "  After rotating the secret or granting User.Read.All, restart the API process"
Write-Host "  (e.g. sudo systemctl restart kestrel-rpp@rpp-organisation-a) so Graph caches refresh."
Write-Host ""

if ($missing.Count -gt 0) {
    Write-Host "MISSING application role grants: $($missing -join ', ')" -ForegroundColor Yellow
    Write-Host "Re-run without -VerifyOnly, or grant admin consent in the portal, then re-check."
    if ($VerifyOnly) {
        exit 2
    }
    Write-Host "If admin-consent ran but grants are still missing, open Entra → App → API permissions"
    Write-Host "and click 'Grant admin consent' manually (CLI consent can lag or fail silently)."
    exit 2
}

Write-Host "All required Graph application permissions are granted for profile '$($rpp.Profile)'."
Write-Host "Done."
