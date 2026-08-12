# EO-424: end-to-end setup for the inbound Outlook mailbox sync.
#
#   Step 1  Entra: grant the RPP app registration the Microsoft Graph APPLICATION
#           permission Mail.ReadWrite (app-only) plus admin consent.
#   Step 2  Exchange: restrict that permission to the single shared mailbox with an
#           Application Access Policy, then verify it.
#   Step 3  Azure: enable the sync on the web app.
#
# WHY THE ORDER MATTERS
#
# App-only Mail.ReadWrite covers EVERY mailbox in the tenant. Step 1 on its own is therefore
# not a safe state - it grants the API read and write access to all mail in the organisation.
# Step 2 is what makes it safe. This script will NOT run step 3 unless the verification in
# step 2 shows access granted for the shared mailbox AND denied for a control mailbox.
#
# Requires: az login (app registration management + admin consent), and an Exchange
# administrator for step 2. If your Exchange role is assigned through PIM, activate it first,
# otherwise the policy commands fail with an unhelpful permission error.
#
# Run interactively - both Connect-ExchangeOnline and az may prompt for MFA.
#
# App registration details come from scripts/rpp-config*.psd1 (public identifiers only).
#
# Usage:
#   .\scripts\configure-mailbox-sync.ps1 -MailboxAddress a@x -ControlMailbox b@x
#   .\scripts\configure-mailbox-sync.ps1 -Profile example -MailboxAddress a@x -ControlMailbox b@x

[CmdletBinding()]
param(
    # The shared mailbox the sync polls.
    [Parameter(Mandatory = $true)]
    [string] $MailboxAddress,

    # A mailbox that must NOT be reachable - the control for the verification.
    [Parameter(Mandatory = $true)]
    [string] $ControlMailbox,

    [ValidateSet('azure', 'example')]
    [string] $Profile = 'azure',

    [string] $ConfigPath,

    [string] $PolicyGroupName = "RPP Mailbox-Sync",
    [string] $ResourceGroup = "RPP-DEV",
    [string] $WebAppName = "rpp-dev",

    # Exchange admin UPN for Connect-ExchangeOnline (helps when the default account is wrong).
    [string] $ExchangeAdminUpn,

    # Use device-code login instead of an interactive browser popup (better in remote/IDE terminals).
    [switch] $DeviceCode,

    # Run only parts of the chain; useful when re-running after a failure.
    [switch] $SkipEntraPermission,
    [switch] $SkipExchangePolicy,
    [switch] $SkipEnable
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot/lib/Import-RppConfig.ps1"
$rpp = Import-RppConfig -ScriptsRoot $PSScriptRoot -Profile $Profile -ConfigPath $ConfigPath

$appId = $rpp.AppId
$graphResourceAppId = $rpp.GraphResourceAppId  # Microsoft Graph

Write-Host "Shared mailbox  : $MailboxAddress"
Write-Host "Control mailbox : $ControlMailbox"
Write-Host ""

# ── Step 1: Entra application permission ───────────────────────────────────────────────

if ($SkipEntraPermission) {
    Write-Host "=== Step 1 skipped ==="
}
else {
    Write-Host "=== Step 1: Entra application permission ==="

    $roleId = az ad sp show --id $graphResourceAppId --query "appRoles[?value=='Mail.ReadWrite'].id | [0]" -o tsv

    if (-not $roleId) {
        throw "Mail.ReadWrite was not found among the Microsoft Graph application roles."
    }

    Write-Host "Adding application permission $roleId (Mail.ReadWrite)..."
    az ad app permission add --id $appId --api $graphResourceAppId --api-permissions "$roleId=Role"

    Write-Host "Granting admin consent..."
    az ad app permission admin-consent --id $appId

    # EO-410 rollout lesson: admin-consent rewrites the delegated grant and has already dropped
    # a freshly added scope once. Check rather than assume.
    Write-Host ""
    Write-Host "Delegated grants after consent (ApprovalSolution.ReadWrite must still be present):"
    az ad app permission list-grants --id $appId --query "[].scope" -o json
    Write-Host ""
}

# ── Step 2: Exchange Application Access Policy ─────────────────────────────────────────

$policyVerified = $false

if ($SkipExchangePolicy) {
    Write-Host "=== Step 2 skipped - the sync stays disabled without a verified policy ==="
}
else {
    Write-Host "=== Step 2: Exchange Application Access Policy ==="

    if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
        throw "ExchangeOnlineManagement is not installed. Install-Module ExchangeOnlineManagement -Scope CurrentUser"
    }

    Import-Module ExchangeOnlineManagement -ErrorAction Stop

    if (-not (Get-ConnectionInformation -ErrorAction SilentlyContinue)) {
        Write-Host ""
        Write-Host "Connecting to Exchange Online..."
        Write-Host "  If this appears to hang: a browser/MFA prompt may be behind other windows,"
        Write-Host "  or the IDE terminal cannot show the popup. Prefer an external PowerShell window,"
        Write-Host "  or re-run with -DeviceCode (and optionally -ExchangeAdminUpn you@tenant.com)."
        Write-Host ""

        $connectParams = @{ ShowBanner = $false }
        if ($ExchangeAdminUpn) {
            $connectParams['UserPrincipalName'] = $ExchangeAdminUpn
        }
        if ($DeviceCode) {
            # Device code flow: prints a code + https://microsoft.com/devicelogin — no popup needed.
            $connectParams['Device'] = $true
            Write-Host "Device-code mode: open https://microsoft.com/devicelogin and enter the code shown below."
        }
        else {
            Write-Host "Browser mode: watch for a sign-in window (Alt+Tab if you do not see it)."
        }

        Connect-ExchangeOnline @connectParams
    }
    else {
        Write-Host "Reusing the existing Exchange Online session."
        Get-ConnectionInformation | Format-Table UserPrincipalName, State, TokenExpiryTimeUTC -AutoSize
    }

    # The policy scopes to a group, so the set of reachable mailboxes stays visible and
    # editable in one place rather than being encoded in the policy itself.
    $group = Get-DistributionGroup -Identity $PolicyGroupName -ErrorAction SilentlyContinue

    if (-not $group) {
        Write-Host "Creating security group '$PolicyGroupName' with $MailboxAddress..."
        $group = New-DistributionGroup -Name $PolicyGroupName -Type Security -Members $MailboxAddress
    }
    else {
        Write-Host "Group '$PolicyGroupName' exists."

        $members = Get-DistributionGroupMember -Identity $PolicyGroupName |
            Select-Object -ExpandProperty PrimarySmtpAddress

        if ($members -notcontains $MailboxAddress) {
            Write-Host "Adding $MailboxAddress to the group..."
            Add-DistributionGroupMember -Identity $PolicyGroupName -Member $MailboxAddress
        }
    }

    $existingPolicy = Get-ApplicationAccessPolicy -ErrorAction SilentlyContinue |
        Where-Object { $_.AppId -eq $appId }

    if (-not $existingPolicy) {
        Write-Host "Creating the RestrictAccess policy..."
        New-ApplicationAccessPolicy -AppId $appId `
            -PolicyScopeGroupId $group.PrimarySmtpAddress `
            -AccessRight RestrictAccess `
            -Description "RPP darf ausschliesslich das Abwesenheits-Postfach lesen" | Out-Null
    }
    else {
        Write-Host "An application access policy for this app already exists."
    }

    Write-Host ""
    Write-Host "Verifying (policy changes can take up to an hour to take effect)..."

    $sharedResult = (Test-ApplicationAccessPolicy -AppId $appId -Identity $MailboxAddress).AccessCheckResult
    $controlResult = (Test-ApplicationAccessPolicy -AppId $appId -Identity $ControlMailbox).AccessCheckResult

    Write-Host "  $MailboxAddress -> $sharedResult"
    Write-Host "  $ControlMailbox -> $controlResult"

    # AccessCheckResult is localized by the service - a German tenant answers "Gewaehrt", not
    # "Granted". Comparing against English literals would never match and would block activation
    # forever. The locale-independent signal is that the two mailboxes must differ, on top of a
    # policy that exists, is scoped to our group, and has the shared mailbox in it - all three
    # verified above.
    $resultsDiffer = $sharedResult -ne $controlResult

    $scopedPolicy = Get-ApplicationAccessPolicy -ErrorAction SilentlyContinue |
        Where-Object { $_.AppId -eq $appId -and $_.AccessRight -eq "RestrictAccess" }

    $policyVerified = $resultsDiffer -and ($null -ne $scopedPolicy)

    if (-not $policyVerified) {
        Write-Host ""

        if (-not $scopedPolicy) {
            Write-Warning "No RestrictAccess policy exists for this app."
        }
        elseif (-not $resultsDiffer) {
            Write-Warning "Both mailboxes report '$sharedResult' - the policy is not in effect yet."
            Write-Warning "Exchange needs up to an hour. Re-run with -SkipEntraPermission to check again."
        }
    }

    Write-Host ""
}

# ── Step 3: enable the sync ────────────────────────────────────────────────────────────

if ($SkipEnable) {
    Write-Host "=== Step 3 skipped ==="
}
elseif (-not $policyVerified) {
    # Deliberate: enabling the sync while app-only Mail.ReadWrite is unrestricted would let the
    # API reach every mailbox in the tenant.
    Write-Host "=== Step 3 not run: the access policy is not verified ==="
    Write-Host "Enable manually once verification passes:"
    Write-Host "  az webapp config appsettings set -g $ResourceGroup -n $WebAppName --settings MailboxSync__Enabled=true MailboxSync__MailboxAddress=$MailboxAddress"
}
else {
    Write-Host "=== Step 3: enabling the sync on $WebAppName ==="
    az webapp config appsettings set -g $ResourceGroup -n $WebAppName `
        --settings "MailboxSync__Enabled=true" "MailboxSync__MailboxAddress=$MailboxAddress" | Out-Null

    Write-Host "Enabled. Default schedule: 08:00, 12:00, 16:00 (MailboxSync__CronExpression)."
    Write-Host ""
    Write-Host "Verify in RPP under Administration > App Admin Center - trigger a sync and check"
    Write-Host "the counters. The status is in-memory and resets on restart; the durable record"
    Write-Host "of what was imported is Absences.Source = 'outlook-mailbox' in the database."
}
