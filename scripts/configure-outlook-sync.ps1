# EO-414: grants the RPP app registration the Microsoft Graph APPLICATION permission
# Calendars.ReadWrite (app-only) including admin consent, so the RPP Web API can write
# vacation events into requesters' personal calendars (one-way RPP -> Outlook).
#
# IMPORTANT (least privilege): app-only Calendars.ReadWrite covers ALL mailboxes by default.
# Restrict it to the planning team members with an Exchange Online Application Access Policy
# (run once as Exchange admin, requires the ExchangeOnlineManagement module):
#
#   Connect-ExchangeOnline
#   New-DistributionGroup -Name "RPP Kalender-Sync" -Type Security -Members user1@...,user2@...
#   New-ApplicationAccessPolicy -AppId $appId `
#     -PolicyScopeGroupId "RPP Kalender-Sync" -AccessRight RestrictAccess `
#     -Description "RPP darf nur Kalender der Planungsmitglieder schreiben"
#   Test-ApplicationAccessPolicy -AppId $appId -Identity user1@...
#
# After granting, enable the sync via app setting: OutlookSync__Enabled=true
# Requires: az login as an account that can manage the app registration and grant admin consent.
#
# Why this script does NOT use "az ad app permission admin-consent":
#   That command is flaky (sometimes tries to open a browser/dialog that never appears in
#   IDE terminals) and rewrites the whole consent surface - which has already dropped
#   delegated scopes such as ApprovalSolution.ReadWrite (EO-410). Instead we:
#     1) declare Calendars.ReadWrite on the app registration (requiredResourceAccess)
#     2) create the appRoleAssignment on the service principal via Microsoft Graph REST
#   Delegated grants are left untouched. Verification reads appRoleAssignments (not list-grants).
#
# Usage:
#   .\scripts\configure-outlook-sync.ps1
#   .\scripts\configure-outlook-sync.ps1 -Profile example
#   .\scripts\configure-outlook-sync.ps1 -Profile example -VerifyOnly
#   .\scripts\configure-outlook-sync.ps1 -Profile example -SkipConsent

[CmdletBinding()]
param(
    [ValidateSet('azure', 'example')]
    [string] $Profile = 'azure',

    [string] $ConfigPath,

    # Only report whether Calendars.ReadWrite is already granted; do not mutate Entra.
    [switch] $VerifyOnly,

    # Add requiredResourceAccess but do not create the appRoleAssignment (portal consent instead).
    [switch] $SkipConsent
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot/lib/Import-RppConfig.ps1"
$rpp = Import-RppConfig -ScriptsRoot $PSScriptRoot -Profile $Profile -ConfigPath $ConfigPath

$appId = $rpp.AppId
$graphResourceAppId = $rpp.GraphResourceAppId  # Microsoft Graph

# Stable Microsoft Graph application role id for Calendars.ReadWrite (Application).
# Source: Graph SP appRoles where value == 'Calendars.ReadWrite'.
$calendarsReadWriteRoleId = 'ef54d2bf-783f-4e0f-bca1-3210c0444d99'

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

function Test-CalendarsReadWriteGranted {
    param([string] $PrincipalObjectId)
    $grantedIds = Get-GrantedAppRoleIds -PrincipalObjectId $PrincipalObjectId
    return ($grantedIds -contains $calendarsReadWriteRoleId)
}

function Add-CalendarsReadWriteAssignment {
    param(
        [string] $PrincipalObjectId,
        [string] $GraphSpObjectId
    )

    # Graph body must be a file for az rest --body @file (inline JSON is shell-hostile on Windows).
    $bodyPath = [System.IO.Path]::GetTempFileName()
    try {
        $body = @{
            principalId = $PrincipalObjectId
            resourceId  = $GraphSpObjectId
            appRoleId   = $calendarsReadWriteRoleId
        } | ConvertTo-Json -Compress

        # Windows PowerShell 5.1 has no utf8NoBOM; Graph rejects a UTF-8 BOM on JSON bodies.
        [System.IO.File]::WriteAllText($bodyPath, $body, [System.Text.UTF8Encoding]::new($false))

        # appRoleAssignedTo on the resource (Graph) SP; equivalent to granting admin consent for one role.
        # --body "@path" is the az rest file form (works on Windows; inline JSON is shell-hostile).
        az rest --method POST `
            --url "https://graph.microsoft.com/v1.0/servicePrincipals/$GraphSpObjectId/appRoleAssignedTo" `
            --headers "Content-Type=application/json" `
            --body "@$bodyPath" `
            -o none
    }
    finally {
        Remove-Item -LiteralPath $bodyPath -Force -ErrorAction SilentlyContinue
    }
}

function Show-PortalConsentHint {
    param([string] $ClientAppId)

    $tenantId = az account show --query tenantId -o tsv 2>$null
    Write-Host ""
    Write-Host "No browser/dialog is required by this script. If the Graph grant is still missing,"
    Write-Host "open Entra -> App registrations -> the RPP app -> API permissions -> Grant admin consent,"
    Write-Host "or open this admin-consent URL in a normal browser session (Global Admin):"
    if ($tenantId) {
        Write-Host "  https://login.microsoftonline.com/$tenantId/adminconsent?client_id=$ClientAppId"
    }
    else {
        Write-Host "  https://login.microsoftonline.com/common/adminconsent?client_id=$ClientAppId"
    }
}

Write-Host "Target Graph *application* permission: Calendars.ReadWrite ($calendarsReadWriteRoleId)"
Write-Host "  Why: EO-414 one-way RPP -> personal calendar write-back (app-only token)"
Write-Host ""

$rppSpId = Get-RppSpObjectId -ClientAppId $appId
$graphSpId = Get-GraphSpObjectId

if (-not $VerifyOnly) {
    Write-Host "Adding Calendars.ReadWrite to app registration requiredResourceAccess..."
    # Idempotent enough: Azure AD accepts re-add; duplicate Role entries are harmless.
    az ad app permission add `
        --id $appId `
        --api $graphResourceAppId `
        --api-permissions "$calendarsReadWriteRoleId=Role" | Out-Null

    if (-not $SkipConsent) {
        if (Test-CalendarsReadWriteGranted -PrincipalObjectId $rppSpId) {
            Write-Host "Calendars.ReadWrite app role is already assigned on the service principal."
        }
        else {
            Write-Host "Creating appRoleAssignment via Microsoft Graph (no browser/dialog)..."
            try {
                Add-CalendarsReadWriteAssignment -PrincipalObjectId $rppSpId -GraphSpObjectId $graphSpId
                Write-Host "appRoleAssignment created."
            }
            catch {
                Write-Warning "Graph appRoleAssignment failed: $($_.Exception.Message)"
                Write-Warning "Your account needs Application Administrator (or Global Admin) rights."
                Show-PortalConsentHint -ClientAppId $appId
                throw
            }

            # Brief propagation wait before verify.
            Start-Sleep -Seconds 2
        }
    }
    else {
        Write-Host "SkipConsent set - requiredResourceAccess updated only."
        Show-PortalConsentHint -ClientAppId $appId
    }
}

Write-Host ""
Write-Host "Verification - app registration requiredResourceAccess (Graph, Role entries):"
az ad app show --id $appId `
    --query "requiredResourceAccess[?resourceAppId=='$graphResourceAppId'] | [0].resourceAccess[?type=='Role']" `
    -o json

Write-Host ""
Write-Host "Verification - granted application roles on the service principal"
Write-Host "(this is what client-credentials tokens actually receive; list-grants is delegated-only):"
$granted = Test-CalendarsReadWriteGranted -PrincipalObjectId $rppSpId
$mark = if ($granted) { 'OK  ' } else { 'MISS' }
Write-Host ("  [{0}] Calendars.ReadWrite  ({1})" -f $mark, $calendarsReadWriteRoleId)

Write-Host ""
Write-Host "Delegated grants (must still include ApprovalSolution.ReadWrite - EO-410):"
az ad app permission list-grants --id $appId --query "[].scope" -o json

Write-Host ""
if (-not $granted) {
    Write-Host "MISSING: Calendars.ReadWrite is not granted on the service principal." -ForegroundColor Yellow
    Show-PortalConsentHint -ClientAppId $appId
    if ($VerifyOnly) {
        exit 2
    }
    exit 2
}

Write-Host "Calendars.ReadWrite is granted for profile '$($rpp.Profile)'."
Write-Host ""
Write-Host "Next steps:"
Write-Host "  (1) Application Access Policy (see script header) - least privilege over mailboxes"
Write-Host "  (2) Enable the sync:"
Write-Host "        Azure:      az webapp config appsettings set -g RPP-DEV -n rpp-dev --settings OutlookSync__Enabled=true"
Write-Host "        HostEurope: set OutlookSync__Enabled=true on the kestrel unit, then restart the service"
Write-Host "Done."