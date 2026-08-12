# EO-410 (Graph provider): grants the RPP app registration the delegated Microsoft Graph
# permission ApprovalSolution.ReadWrite (beta approval solutions API) including admin consent.
# The RPP Web API exchanges the Teams SSO token via OBO for this scope to create Microsoft
# Approvals directly - no Power Automate and no premium license required.
# Requires: az login as an account that can manage the app registration and grant admin consent.
#
# Usage:
#   .\scripts\configure-graph-approvals.ps1
#   .\scripts\configure-graph-approvals.ps1 -Profile example

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
$graphResourceAppId = $rpp.GraphResourceAppId  # Microsoft Graph

Write-Host "Resolving ApprovalSolution.ReadWrite permission id from the Microsoft Graph service principal..."
$permissionId = az ad sp show --id $graphResourceAppId --query "oauth2PermissionScopes[?value=='ApprovalSolution.ReadWrite'].id | [0]" -o tsv

if (-not $permissionId) {
    throw "ApprovalSolution.ReadWrite was not found on the Microsoft Graph service principal (is the beta permission available in this tenant?)."
}

Write-Host "Adding delegated permission $permissionId (ApprovalSolution.ReadWrite) to app $appId..."
az ad app permission add --id $appId --api $graphResourceAppId --api-permissions "$permissionId=Scope"

Write-Host "Granting admin consent..."
az ad app permission admin-consent --id $appId

Write-Host ""
Write-Host "Verification (delegated Graph permissions of the app):"
az ad app show --id $appId --query "requiredResourceAccess[?resourceAppId=='$graphResourceAppId'].resourceAccess[]" -o json

Write-Host ""
Write-Host "Done. The RPP Web API can now create Microsoft Approvals via Graph (GraphApprovals:Enabled=true)."
