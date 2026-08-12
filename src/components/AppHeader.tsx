import type { TranslationKey } from "../localization/translations";

interface AppHeaderProps {
  readonly t: (key: TranslationKey) => string;
}

// Demo-only chrome: inside the real Teams client the host tab bar carries the app
// title, so this header is rendered only alongside the simulated Teams rail.
export function AppHeader({ t }: AppHeaderProps) {
  return (
    <header className="appHeader">
      <div className="brandCluster">
        <div className="appLogo" aria-label={t("appLogoAlt")} role="img">
          <div className="appLogoTile appLogoTilePrimary">R</div>
          <div className="appLogoTile appLogoTilePresence" />
          <div className="appLogoTile appLogoTilePlanning" />
          <div className="appLogoOrbit" />
        </div>
        <div className="brandText">
          <h1>{t("appTitle")}</h1>
        </div>
      </div>
    </header>
  );
}
