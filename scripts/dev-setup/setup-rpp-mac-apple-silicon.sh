#!/bin/bash
# setup-rpp-mac-apple-silicon.sh
# Setup-Skript für das RPP-Projekt auf Mac Apple Silicon (M1/M2/M3/M4)
# Datenbank: Azure SQL (kein lokaler SQL Server / Docker nötig)
# Autor: Alex Mueller / example.com

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/RppWebApi"
FRONTEND_DIR="$PROJECT_ROOT"

echo "=============================================="
echo "  RPP Projekt Setup – Mac Apple Silicon"
echo "  (Azure SQL – kein Docker nötig)"
echo "=============================================="
echo ""

# --------------------------------------------------
# 1. System-Voraussetzungen prüfen
# --------------------------------------------------
echo ">>> Prüfe System-Voraussetzungen..."

# Architektur prüfen
ARCH=$(uname -m)
if [[ "$ARCH" != "arm64" ]]; then
  echo "WARNUNG: Dieses Skript ist für Apple Silicon (arm64) gedacht."
  echo "  Aktuelle Architektur: $ARCH"
  echo "  Für Intel-Macs bitte setup-rpp-mac-intel.sh verwenden."
  echo ""
fi

# .NET SDK
if ! command -v dotnet &> /dev/null; then
  echo "FEHLER: .NET SDK nicht gefunden."
  echo "Bitte .NET 8 SDK (Arm64) installieren:"
  echo "  https://dotnet.microsoft.com/download/dotnet/8.0"
  echo "  → macOS Arm64 Installer wählen"
  exit 1
fi

DOTNET_VERSION=$(dotnet --version)
echo "  .NET SDK: $DOTNET_VERSION"

if [[ ! "$DOTNET_VERSION" =~ ^8\. ]]; then
  echo "WARNUNG: Es wird .NET 8 empfohlen. Gefunden: $DOTNET_VERSION"
fi

# Prüfen ob native Arm64 oder Rosetta
DOTNET_INFO=$(dotnet --info 2>/dev/null | grep -i "RID\|OS Architecture" || true)
echo "  $DOTNET_INFO"

# Node.js
if ! command -v node &> /dev/null; then
  echo "FEHLER: Node.js nicht gefunden."
  echo "Bitte Node.js 20 LTS oder 22 LTS (Arm64) installieren:"
  echo "  https://nodejs.org/  → macOS Arm64 wählen"
  echo "  oder via Homebrew: brew install node@20"
  exit 1
fi

NODE_VERSION=$(node --version)
echo "  Node.js: $NODE_VERSION"

# npm
if ! command -v npm &> /dev/null; then
  echo "FEHLER: npm nicht gefunden."
  exit 1
fi
echo "  npm: $(npm --version)"

echo ""
echo ">>> System-Check abgeschlossen."
echo ""

# Optional: Node-Version aus .nvmrc laden
if [ -f "$PROJECT_ROOT/.nvmrc" ] && [ -d "$HOME/.nvm" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" || true
  if command -v nvm >/dev/null 2>&1; then
    echo ""
    echo ">>> Aktiviere Node-Version aus .nvmrc..."
    nvm use >/dev/null || echo "WARNUNG: nvm use fehlgeschlagen, verwende aktuelle Node-Version."
    echo "  Aktive Node.js Version: $(node --version)"
  fi
fi

# --------------------------------------------------
# 3. Backend restore
# --------------------------------------------------
if [ -d "$BACKEND_DIR" ]; then
  echo ">>> Backend: dotnet restore..."
  cd "$BACKEND_DIR"
  dotnet restore
  echo "  Backend restore erfolgreich."
else
  echo "WARNUNG: Backend-Ordner '$BACKEND_DIR' nicht gefunden – übersprungen."
fi

# EF Core Tools global installieren (falls noch nicht vorhanden)
echo ""
echo ">>> Installiere/Prüfe dotnet-ef Tools..."
dotnet tool install --global dotnet-ef --version 8.0.0 2>/dev/null || \
dotnet tool update --global dotnet-ef --version 8.0.0 2>/dev/null || true
echo "  dotnet-ef bereit."

# --------------------------------------------------
# 4. Frontend install
# --------------------------------------------------
echo ""
if [ -d "$FRONTEND_DIR" ]; then
  echo ">>> Frontend: Node-Module installieren..."
  cd "$FRONTEND_DIR"
  if [ -f "package-lock.json" ]; then
    npm ci || npm install
  else
    npm install
  fi
  echo "  Frontend install erfolgreich."
else
  echo "WARNUNG: Frontend-Ordner '$FRONTEND_DIR' nicht gefunden – übersprungen."
fi

# --------------------------------------------------
# Fertig
# --------------------------------------------------
echo ""
echo "=============================================="
echo "  Setup abgeschlossen!"
echo "=============================================="
echo ""
echo "Projekt-Root:       $PROJECT_ROOT"
echo "Backend-Verzeichnis: $BACKEND_DIR"
echo "Frontend-Verzeichnis: $FRONTEND_DIR"
echo ""
echo "Nächste Schritte:"
echo "  Backend starten:   cd $BACKEND_DIR && dotnet run"
echo "  Frontend starten:  cd $FRONTEND_DIR && npm run dev"
echo ""
echo "Azure SQL Connection String setzen (empfohlen über User Secrets):"
echo "  cd $BACKEND_DIR"
echo "  dotnet user-secrets set \"ConnectionStrings:DefaultConnection\" \\"
echo "    \"Server=tcp:DEIN-SERVER.database.windows.net,1433;Initial Catalog=DEINE-DB;...\""
echo ""
echo "Wichtig: In Azure SQL die Firewall-Regel für deine aktuelle IP freigeben."
echo ""
echo "Hinweis Apple Silicon:"
echo "  Stelle sicher, dass du die Arm64-Versionen von .NET SDK und Node.js"
echo "  installiert hast (nicht die x64/Rosetta-Varianten)."
echo ""
