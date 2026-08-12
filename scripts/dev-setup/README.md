# RPP Dev Setup Scripts

Diese Skripte richten die lokale Entwicklungsumgebung fuer das Projekt ein.

Sie pruefen:
- .NET SDK
- Node.js und npm
- optional nvm/.nvmrc

Sie fuehren aus:
- dotnet restore im Backend
- Installation/Update von dotnet-ef (global)
- npm ci (mit Fallback auf npm install) im Frontend

Die Skripte erkennen die Projektstruktur automatisch:
- Backend: RppWebApi
- Frontend: Repository-Root

## Welches Skript fuer welches Betriebssystem?

- macOS Intel: setup-rpp-mac-intel.sh
- macOS Apple Silicon (M1/M2/M3/M4): setup-rpp-mac-apple-silicon.sh
- Linux: setup-rpp-linux.sh
- Windows PowerShell: setup-rpp-windows.ps1

## Ausfuehrung

Aus dem Repository-Root:

macOS Intel:
- bash scripts/dev-setup/setup-rpp-mac-intel.sh

macOS Apple Silicon:
- bash scripts/dev-setup/setup-rpp-mac-apple-silicon.sh

Linux:
- bash scripts/dev-setup/setup-rpp-linux.sh

Windows (PowerShell):
- powershell -ExecutionPolicy Bypass -File scripts/dev-setup/setup-rpp-windows.ps1

## Voraussetzungen

Empfohlen:
- .NET SDK 8.x
- Node.js 22 (siehe .nvmrc)

Optional:
- nvm (macOS/Linux) oder nvm-windows

## Nach dem Setup

Backend starten:
- cd RppWebApi
- dotnet run

Frontend starten:
- npm run dev

## Azure SQL Hinweis

Connection String nicht in appsettings committen.
Nutze User Secrets:

- cd RppWebApi
- dotnet user-secrets set "ConnectionStrings:DefaultConnection" "Server=tcp:DEIN-SERVER.database.windows.net,1433;Initial Catalog=DEINE-DB;..."

Und in Azure SQL die Firewall-Regel fuer deine aktuelle IP freigeben.

## Troubleshooting

Wenn das .NET SDK fehlt:
- winget install Microsoft.DotNet.SDK.8
- Danach ein neues Terminal oeffnen, damit der aktualisierte PATH greift.
- Alternativ: https://dotnet.microsoft.com/download/dotnet/8.0

Wenn Node.js fehlt:
- winget install OpenJS.NodeJS.LTS
- Achtung: das installiert die aktuelle LTS, die neuer sein kann als die in .nvmrc
  gepinnte Version (aktuell 22). Wer die Pin-Version genau treffen will, nimmt
  nvm-windows: winget install CoreyButler.NVMforWindows, dann nvm install 22.
- Alternativ: https://nodejs.org/

Wenn nvm use fehlschlaegt:
- Node manuell aktivieren und Skript erneut starten.

Wenn npm ci fehlschlaegt:
- Das Skript faellt automatisch auf npm install zurueck.

Wenn dotnet-ef nicht installiert werden kann:
- Setup laeuft weiter, Tool spaeter manuell installieren:
- dotnet tool install --global dotnet-ef --version 8.0.0

Windows: "dotnet wurde gefunden, meldet aber keine Version"

Das Kommando dotnet liegt in der PATH, liefert bei --version aber nichts.
Zwei haeufige Ursachen:

1. Es ist nur die .NET Runtime installiert, nicht das SDK.
   Pruefen mit: dotnet --list-sdks
   Eine leere Ausgabe bedeutet: kein SDK vorhanden.
   Abhilfe: .NET 8 SDK (x64) installieren,
   https://dotnet.microsoft.com/download/dotnet/8.0

2. dotnet zeigt auf den App-Ausfuehrungsalias aus dem Microsoft Store unter
   ...\AppData\Local\Microsoft\WindowsApps\dotnet.exe. Dieser Platzhalter tut nichts.
   Pruefen mit: (Get-Command dotnet).Source
   Abhilfe: Einstellungen > Apps > Erweiterte App-Einstellungen >
   App-Ausfuehrungsaliase, Eintrag fuer dotnet deaktivieren - oder das echte SDK
   installieren.

Nach der Installation ein neues Terminal oeffnen, damit die geaenderte PATH wirkt.

Windows: "Die Datei kann nicht geladen werden, da die Ausfuehrung von Skripts
deaktiviert ist"

Das Skript wie im Abschnitt Ausfuehrung mit -ExecutionPolicy Bypass starten.
