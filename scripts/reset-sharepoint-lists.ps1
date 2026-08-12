#Requires -Version 7.0
<#
.SYNOPSIS
    Deletes the RPP planning lists from a SharePoint Online site so they can be provisioned fresh.

.DESCRIPTION
    EO-430 assumes a green-field site: a customer's lists are empty when the installation is
    ordered. The development tenant is the exception — it was provisioned under earlier schemas and
    carries columns that cannot be repaired in place, because SharePoint cannot retype a column and
    cannot remove one the list template owns. Deleting and re-provisioning is the shortest path
    there, and only there.

    THIS DELETES DATA. Every item in every RPP list goes with the list. Lists land in the site
    recycle bin, so a mistake is recoverable for the retention period, but nothing here is a backup.

    The list names are read from provision-sharepoint-lists.ps1 rather than repeated, so this script
    cannot fall behind the schema it is meant to reset.

    Runs as a dry run by default. Nothing is deleted without -Execute.

.PARAMETER SiteUrl
    Full URL of the target site. Falls back to SharePointSiteUrl in rpp-config.psd1.

.PARAMETER ClientId
    Entra ID application client id for PnP authentication. Falls back to rpp-config.psd1 / RPP_APP_ID.

.PARAMETER DeviceLogin
    Use device-code login instead of interactive browser login.

.PARAMETER UseCurrentConnection
    Reuse an existing Connect-PnPOnline connection.

.PARAMETER Execute
    Actually delete. Without it the script only reports what it would delete.

.EXAMPLE
    ./reset-sharepoint-lists.ps1 -UseCurrentConnection
    Dry run: lists what would be deleted and how many items each holds.

.EXAMPLE
    ./reset-sharepoint-lists.ps1 -UseCurrentConnection -Execute
    Deletes the lists, then re-run provision-sharepoint-lists.ps1 to recreate them.
#>
[CmdletBinding()]
param(
    [string] $SiteUrl,

    [string] $ClientId,

    [switch] $DeviceLogin,

    [switch] $UseCurrentConnection,

    [switch] $Execute
)

$ErrorActionPreference = "Stop"

$configPath = Join-Path $PSScriptRoot "rpp-config.psd1"
if (Test-Path $configPath) {
    $config = Import-PowerShellDataFile -Path $configPath
    if (-not $ClientId) { $ClientId = if ($env:RPP_APP_ID) { $env:RPP_APP_ID } else { $config.AppId } }
    if (-not $SiteUrl) { $SiteUrl = $config.SharePointSiteUrl }
}

if (-not $SiteUrl) {
    Write-Error "Provide -SiteUrl or set SharePointSiteUrl in rpp-config.psd1."
    exit 1
}

if (-not (Get-Module -ListAvailable -Name "PnP.PowerShell")) {
    Write-Error "PnP.PowerShell is not installed. Run: Install-Module PnP.PowerShell -Scope CurrentUser"
    exit 1
}

if (-not $UseCurrentConnection -and -not $ClientId) {
    Write-Error "Provide -ClientId for authentication or use -UseCurrentConnection."
    exit 1
}

# --- List names, read from the provisioning script ---------------------------
# A second copy of the names would drift the first time a list is added. List-level definitions are
# the only place a bare `Name = "..."` sits alone on its line; field definitions carry `; Type` after
# it on the same line.

$provisioningScript = Join-Path $PSScriptRoot "provision-sharepoint-lists.ps1"

if (-not (Test-Path $provisioningScript)) {
    Write-Error "Cannot find provision-sharepoint-lists.ps1 next to this script. The list names are read from it."
    exit 1
}

$listNames = Select-String -Path $provisioningScript -Pattern '^\s*Name\s*=\s*"([^"]+)"\s*$' |
    ForEach-Object { $_.Matches[0].Groups[1].Value } |
    Select-Object -Unique

if ($listNames.Count -lt 10) {
    Write-Error "Read only $($listNames.Count) list names from provision-sharepoint-lists.ps1, which cannot be right. Refusing to run rather than deleting an arbitrary subset."
    exit 1
}

Write-Host "Read $($listNames.Count) list names from provision-sharepoint-lists.ps1." -ForegroundColor Cyan

# --- Connect -----------------------------------------------------------------

Write-Host "Connecting to SharePoint site: $SiteUrl" -ForegroundColor Cyan

if ($UseCurrentConnection) {
    Write-Host "  Using existing PnP connection (-UseCurrentConnection)" -ForegroundColor Gray
}
elseif ($DeviceLogin) {
    Connect-PnPOnline -Url $SiteUrl -ClientId $ClientId -DeviceLogin
}
else {
    Connect-PnPOnline -Url $SiteUrl -ClientId $ClientId -Interactive
}

$web = Get-PnPWeb
Write-Host "Connected to: $($web.Url)" -ForegroundColor Green
Write-Host ("Mode: {0}" -f ($Execute ? "DELETE" : "dry run - nothing will be deleted")) -ForegroundColor $(if ($Execute) { "Red" } else { "Cyan" })
Write-Host ""

# --- Survey ------------------------------------------------------------------

$present = @()
$totalItems = 0

foreach ($listName in $listNames) {
    $list = Get-PnPList -Identity $listName -ErrorAction SilentlyContinue

    if (-not $list) {
        Write-Host "  [ABSENT ] $listName" -ForegroundColor DarkGray
        continue
    }

    $present += $listName
    $totalItems += $list.ItemCount

    Write-Host ("  [PRESENT] {0} ({1} item(s))" -f $listName, $list.ItemCount) -ForegroundColor Yellow
}

Write-Host ""

if ($present.Count -eq 0) {
    Write-Host "No RPP lists on this site. Nothing to do." -ForegroundColor Green
    return
}

Write-Host ("{0} list(s) holding {1} item(s) in total." -f $present.Count, $totalItems) -ForegroundColor Cyan

if (-not $Execute) {
    Write-Host ""
    Write-Host "Dry run. Re-run with -Execute to delete these lists, then run provision-sharepoint-lists.ps1." -ForegroundColor Cyan
    return
}

# --- Delete ------------------------------------------------------------------
# Typed confirmation rather than a yes/no prompt: the site URL has to be read and retyped, so the
# wrong tenant cannot be wiped by a reflex keystroke.

Write-Host ""
Write-Host "About to DELETE $($present.Count) list(s) and $totalItems item(s) from:" -ForegroundColor Red
Write-Host "  $($web.Url)" -ForegroundColor Red
Write-Host "Lists go to the site recycle bin. This is not a backup." -ForegroundColor Red
Write-Host ""
$confirmation = Read-Host "Type the site URL to confirm"

if ($confirmation.TrimEnd('/') -ne $web.Url.TrimEnd('/')) {
    Write-Host "Confirmation did not match. Nothing deleted." -ForegroundColor Green
    return
}

$deleted = 0

foreach ($listName in $present) {
    try {
        Remove-PnPList -Identity $listName -Force -ErrorAction Stop
        Write-Host "  [DELETED] $listName" -ForegroundColor Green
        $deleted++
    }
    catch {
        # Reported and carried on: one list refusing to go is not a reason to leave the rest in a
        # half-reset state the next provisioning run cannot reason about.
        Write-Host "  [FAILED ] $listName - $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "$deleted of $($present.Count) list(s) deleted." -ForegroundColor Cyan
Write-Host "Next: ./provision-sharepoint-lists.ps1 -SiteUrl $SiteUrl -UseCurrentConnection" -ForegroundColor Cyan
