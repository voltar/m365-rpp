#Requires -Version 5.1
<#
.SYNOPSIS
  Build the Host Europe package and deploy it to rpp.example.com (Kestrel).

.DESCRIPTION
  1) npm run package:api -- --env hosteurope
  2) scp ./publish/RppWebApi/* → app root (does not delete kestrel.env)
  3) systemctl restart kestrel-rpp@rpp-organisation-a
  4) optional /health check

  Defaults match the Organisation-A public demo on Host Europe:
    deploy@YOUR_SERVER_IP:/var/www/vhosts/example.com/apps/rpp-organisation-a/

.EXAMPLE
  .\scripts\deploy-hosteurope.ps1

.EXAMPLE
  .\scripts\deploy-hosteurope.ps1 -SkipBuild
  # only upload + restart (publish/ already built)

.EXAMPLE
  .\scripts\deploy-hosteurope.ps1 -Remote "other@1.2.3.4"
#>
[CmdletBinding()]
param(
    # SSH target — Host Europe Organisation-A demo (override with -Remote if needed)
    [string] $Remote = "deploy@YOUR_SERVER_IP",

    # App root on the server (instance rpp-organisation-a)
    [string] $AppRoot = "/var/www/vhosts/example.com/apps/rpp-organisation-a",

    # systemd unit
    [string] $Service = "kestrel-rpp@rpp-organisation-a",

    # Skip npm package:api when publish/ is already fresh
    [switch] $SkipBuild,

    # Skip scp (build + restart only — rarely useful)
    [switch] $SkipUpload,

    # Do not restart Kestrel after upload
    [switch] $SkipRestart,

    # Open /health after deploy
    [switch] $HealthCheck
)

$ErrorActionPreference = "Stop"

function Write-Step([string] $Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$publishDir = Join-Path $repoRoot "publish\RppWebApi"
if (-not $SkipBuild) {
    Write-Step "package:api --env hosteurope"
    npm run package:api -- --env hosteurope
    if ($LASTEXITCODE -ne 0) {
        throw "npm run package:api failed with exit code $LASTEXITCODE"
    }
}
else {
    Write-Step "SkipBuild — using existing publish output"
}

if (-not (Test-Path $publishDir)) {
    throw "Publish folder not found: $publishDir — run without -SkipBuild first."
}

# Never ship a local kestrel.env over the server secrets file.
$localEnv = Join-Path $publishDir "kestrel.env"
if (Test-Path $localEnv) {
    Write-Host "Removing local publish/kestrel.env so server secrets are not overwritten." -ForegroundColor Yellow
    Remove-Item $localEnv -Force
}

if (-not $SkipUpload) {
    Write-Step "scp → ${Remote}:${AppRoot}/"
    # Trailing path: contents of RppWebApi into app root (keeps kestrel.env on server).
    scp -r "$publishDir\*" "${Remote}:${AppRoot}/"
    if ($LASTEXITCODE -ne 0) {
        throw "scp failed with exit code $LASTEXITCODE"
    }
}

if (-not $SkipRestart) {
    Write-Step "systemctl restart $Service"
    ssh $Remote "sudo systemctl restart $Service && sudo systemctl is-active $Service"
    if ($LASTEXITCODE -ne 0) {
        throw "ssh restart failed with exit code $LASTEXITCODE"
    }
}

if ($HealthCheck) {
    Write-Step "GET https://rpp.example.com/health"
    try {
        $response = Invoke-WebRequest -Uri "https://rpp.example.com/health" -UseBasicParsing -TimeoutSec 30
        Write-Host "HTTP $($response.StatusCode)" -ForegroundColor Green
        Write-Host $response.Content
    }
    catch {
        Write-Host "Health check failed: $_" -ForegroundColor Yellow
        Write-Host "Check: ssh $Remote 'sudo journalctl -u $Service -n 80 --no-pager'"
    }
}

Write-Host ""
Write-Host "Deploy finished." -ForegroundColor Green
Write-Host "  Remote : $Remote"
Write-Host "  App    : $AppRoot"
Write-Host "  Unit   : $Service"
Write-Host "  Site   : https://rpp.example.com"
Write-Host ""
Write-Host "Logs: ssh $Remote 'sudo journalctl -u $Service -n 80 --no-pager'"
