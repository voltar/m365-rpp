# setup-rpp-windows.ps1
# Setup script for the RPP project on Windows
# Database: Azure SQL (no local SQL Server / Docker required)
# Author: Alex Mueller / example.com

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# StrictMode treats the automatic $LASTEXITCODE as undefined until the first native
# call, so it is seeded here before any helper reads it.
$global:LASTEXITCODE = 0

Write-Host "=============================================="
Write-Host "  RPP Project Setup - Windows"
Write-Host "  (Azure SQL - no Docker required)"
Write-Host "=============================================="
Write-Host ""

# Native commands signal failure through the exit code, not through exceptions, so a
# plain try/catch around them never fires. These helpers make failures visible instead.

function Invoke-Native {
    param(
        [Parameter(Mandatory)][string] $Command,
        [string[]] $Arguments = @()
    )

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'

    try {
        & $Command @Arguments
        return $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Get-ToolVersion {
    param(
        [Parameter(Mandatory)][string] $Command,
        [string[]] $Arguments = @('--version')
    )

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'

    try {
        $output = & $Command @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    catch {
        return $null
    }
    finally {
        $ErrorActionPreference = $previous
    }

    if ($exitCode -ne 0) {
        return $null
    }

    $text = ($output |
        Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } |
        ForEach-Object { [string] $_ }) -join "`n"

    if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
    }

    return $text.Trim()
}

function Get-CommandPath {
    param([Parameter(Mandatory)][string] $Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue

    if (-not $command) {
        return $null
    }

    return $command.Source
}

# $PSScriptRoot is reliable for a script invoked by path; $MyInvocation.MyCommand.Path
# is empty when the script is piped into the shell, which StrictMode then turns into an
# obscure Split-Path failure.
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

if (-not $ScriptDir) {
    Write-Host "ERROR: Could not determine the script directory."
    Write-Host "Run the script by path, for example:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\dev-setup\setup-rpp-windows.ps1"
    exit 1
}

$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "../..")).Path
$BackendDir = Join-Path $ProjectRoot "RppWebApi"
$FrontendDir = $ProjectRoot

Write-Host ">>> Checking system prerequisites..."

# .NET SDK
$dotnetPath = Get-CommandPath -Name 'dotnet'

if (-not $dotnetPath) {
    Write-Host "ERROR: .NET SDK not found."
    Write-Host "Please install .NET 8 SDK (x64):"

    # winget is the fastest route on a managed workstation, where the download page is
    # sometimes blocked but the package manager is not. Only offered when it is present.
    if (Get-CommandPath -Name 'winget') {
        Write-Host "  winget install Microsoft.DotNet.SDK.8"
    }

    Write-Host "  https://dotnet.microsoft.com/download/dotnet/8.0"
    Write-Host "Then open a new terminal so the updated PATH is picked up."
    exit 1
}

$dotnetVersion = Get-ToolVersion -Command 'dotnet'

if (-not $dotnetVersion) {
    # 'dotnet' resolved but produced no version. The two usual causes are worth naming,
    # because the raw failure is silent and easy to misread as a broken script.
    Write-Host "ERROR: 'dotnet' was found but did not report a version."
    Write-Host "  Resolved to: $dotnetPath"
    Write-Host ""
    Write-Host "Usual causes:"
    Write-Host "  1. Only the .NET *runtime* is installed, not the SDK."
    Write-Host "     Check with: dotnet --list-sdks   (an empty list means no SDK)"
    Write-Host "  2. 'dotnet' resolves to the Microsoft Store app execution alias stub"
    Write-Host "     under ...\AppData\Local\Microsoft\WindowsApps\dotnet.exe, which does nothing."
    Write-Host "     Turn it off under Settings > Apps > Advanced app settings >"
    Write-Host "     App execution aliases, or install the real SDK."
    Write-Host ""
    Write-Host "Install the .NET 8 SDK (x64):"

    if (Get-CommandPath -Name 'winget') {
        Write-Host "  winget install Microsoft.DotNet.SDK.8"
    }

    Write-Host "  https://dotnet.microsoft.com/download/dotnet/8.0"
    Write-Host "Then open a new terminal so the updated PATH is picked up."
    exit 1
}

Write-Host "  .NET SDK: $dotnetVersion"

if ($dotnetVersion -notmatch '^8\.') {
    Write-Host "WARNING: .NET 8 is recommended. Found: $dotnetVersion"
}

# Node.js
$nodePath = Get-CommandPath -Name 'node'

if (-not $nodePath) {
    Write-Host "ERROR: Node.js not found."
    Write-Host "Please install Node.js 20 LTS or 22 LTS (x64):"

    if (Get-CommandPath -Name 'winget') {
        Write-Host "  winget install OpenJS.NodeJS.LTS"
        Write-Host ""
        Write-Host "  Note: that installs the current LTS, which may be newer than the version"
        Write-Host "  pinned in .nvmrc. To match the pin exactly, use nvm-windows instead:"
        Write-Host "    winget install CoreyButler.NVMforWindows"
        Write-Host "    nvm install <version from .nvmrc>"
        Write-Host "  This script then activates that version automatically on the next run."
        Write-Host ""
    }

    Write-Host "  https://nodejs.org/"
    Write-Host "Then open a new terminal so the updated PATH is picked up."
    exit 1
}

$nodeVersion = Get-ToolVersion -Command 'node'

if (-not $nodeVersion) {
    Write-Host "ERROR: 'node' was found but did not report a version."
    Write-Host "  Resolved to: $nodePath"
    Write-Host "If this path is under ...\AppData\Local\Microsoft\WindowsApps, it is the"
    Write-Host "Microsoft Store app execution alias stub."

    if (Get-CommandPath -Name 'winget') {
        Write-Host "Install the real Node.js: winget install OpenJS.NodeJS.LTS"
    }

    Write-Host "Or download it from https://nodejs.org/"
    Write-Host "Then open a new terminal so the updated PATH is picked up."
    exit 1
}

Write-Host "  Node.js: $nodeVersion"

# npm
$npmPath = Get-CommandPath -Name 'npm'

if (-not $npmPath) {
    Write-Host "ERROR: npm not found."
    exit 1
}

$npmVersion = Get-ToolVersion -Command 'npm'

if (-not $npmVersion) {
    Write-Host "ERROR: 'npm' was found but did not report a version."
    Write-Host "  Resolved to: $npmPath"
    exit 1
}

Write-Host "  npm: $npmVersion"

Write-Host ""
Write-Host ">>> System check finished."

# Optional: load Node version from .nvmrc via nvm-windows
$nvmrcPath = Join-Path $ProjectRoot ".nvmrc"
$nvmPath = Get-CommandPath -Name 'nvm'

if ((Test-Path $nvmrcPath) -and $nvmPath) {
    $desiredNodeVersion = (Get-Content $nvmrcPath -TotalCount 1).Trim()

    if ($desiredNodeVersion) {
        Write-Host ""
        Write-Host ">>> Activating Node version from .nvmrc ($desiredNodeVersion)..."

        $nvmExit = Invoke-Native -Command 'nvm' -Arguments @('use', $desiredNodeVersion)

        if ($nvmExit -ne 0) {
            Write-Host "WARNING: 'nvm use $desiredNodeVersion' failed - continuing with the current Node version."
        }
        else {
            $activeNodeVersion = Get-ToolVersion -Command 'node'

            if ($activeNodeVersion) {
                Write-Host "  Active Node.js version: $activeNodeVersion"
            }
        }
    }
}

Write-Host ""

# Backend restore
if (Test-Path $BackendDir) {
    Write-Host ">>> Backend: dotnet restore..."
    Push-Location $BackendDir

    try {
        $restoreExit = Invoke-Native -Command 'dotnet' -Arguments @('restore')
    }
    finally {
        Pop-Location
    }

    if ($restoreExit -ne 0) {
        Write-Host ""
        Write-Host "ERROR: 'dotnet restore' failed (exit code $restoreExit)."
        Write-Host "Fix the restore error above and run the script again."
        exit 1
    }

    Write-Host "  Backend restore successful."
}
else {
    Write-Host "WARNING: Backend folder '$BackendDir' not found - skipped."
}

Write-Host ""
Write-Host ">>> Installing/checking dotnet-ef tool..."

$efInstallExit = Invoke-Native -Command 'dotnet' -Arguments @('tool', 'install', '--global', 'dotnet-ef', '--version', '8.0.0')

if ($efInstallExit -ne 0) {
    # Already installed is the common case; try an update, then carry on either way.
    $efUpdateExit = Invoke-Native -Command 'dotnet' -Arguments @('tool', 'update', '--global', 'dotnet-ef', '--version', '8.0.0')

    if ($efUpdateExit -ne 0) {
        Write-Host "WARNING: dotnet-ef could not be installed or updated - continuing."
        Write-Host "  Install it later with: dotnet tool install --global dotnet-ef --version 8.0.0"
    }
    else {
        Write-Host "  dotnet-ef ready."
    }
}
else {
    Write-Host "  dotnet-ef ready."
}

# Frontend install
Write-Host ""

if (Test-Path (Join-Path $FrontendDir "package.json")) {
    Write-Host ">>> Frontend: installing node modules..."
    Push-Location $FrontendDir

    try {
        $installExit = 0

        if (Test-Path (Join-Path $FrontendDir "package-lock.json")) {
            $installExit = Invoke-Native -Command 'npm' -Arguments @('ci')

            if ($installExit -ne 0) {
                Write-Host "WARNING: 'npm ci' failed - falling back to 'npm install'."
                $installExit = Invoke-Native -Command 'npm' -Arguments @('install')
            }
        }
        else {
            $installExit = Invoke-Native -Command 'npm' -Arguments @('install')
        }
    }
    finally {
        Pop-Location
    }

    if ($installExit -ne 0) {
        Write-Host ""
        Write-Host "ERROR: Installing the node modules failed (exit code $installExit)."
        exit 1
    }

    Write-Host "  Frontend install successful."
}
else {
    Write-Host "WARNING: Frontend package.json not found in '$FrontendDir' - skipped."
}

Write-Host ""
Write-Host "=============================================="
Write-Host "  Setup completed!"
Write-Host "=============================================="
Write-Host ""
Write-Host "Project root:         $ProjectRoot"
Write-Host "Backend directory:    $BackendDir"
Write-Host "Frontend directory:   $FrontendDir"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  Backend start:   cd `"$BackendDir`"; dotnet run"
Write-Host "  Frontend start:  cd `"$FrontendDir`"; npm run dev"
Write-Host ""
Write-Host "Set Azure SQL connection string (recommended: User Secrets):"
Write-Host "  cd `"$BackendDir`""
Write-Host "  dotnet user-secrets set `"ConnectionStrings:DefaultConnection`" `"Server=tcp:YOUR-SERVER.database.windows.net,1433;Initial Catalog=YOUR-DB;...`""
Write-Host ""
Write-Host "Important: Allow your current IP in the Azure SQL firewall rules."
