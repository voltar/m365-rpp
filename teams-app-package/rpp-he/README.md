# RPP BetaV2 — Teams sideload (Host Europe)

Display name in Teams: **RPP BetaV2** (not RC5/RC7).  
Current package version: **4.0.9** (Friends & Family final) → `../rpp-he.zip`.

| | Azure package | This package |
|---|---|---|
| Name | RPP RC7 (or catalog name) | **RPP BetaV2** |
| Teams app `id` | `d65eba27-…0bce` | `badf6676-…7153` (stable — bump version only) |
| `contentUrl` | Azure App Service | `https://rpp.example.com` |
| Data | typically Azure SQL | PostgreSQL |
| Version | see `release.json` / RC ZIP | **4.0.9** in `manifest.json` |

## Install

Upload `../rpp-he.zip` via Teams → Apps → Upload a custom app, or Developer Portal → Apps → Import app.  
Keep the app **id**; only raise **version** so Teams updates in place.

**ZIP layout (critical):** `manifest.json`, `color.png`, `outline.png` and locale JSON must sit at the **root of the zip**, not inside a nested `rpp-he/` folder. Nested packages produce:

> Provided add-in package was not understood. Please make sure that the file being submitted is a valid Office add-in package.

Rebuild from repo root (`make-zip.py` puts folder **contents** at the zip root):

```powershell
python scripts/make-zip.py teams-app-package/rpp-he teams-app-package/rpp-he
# → teams-app-package/rpp-he.zip
```

Or Explorer: open `rpp-he/` → select `manifest.json`, icons, locale JSON → compress. Do **not** zip the `rpp-he` folder as a whole (that nests paths and breaks the portal).

If an older sideload still shows "RPP RC5", remove that app and upload this zip again (locale files previously overrode the name).
