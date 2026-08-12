import { Button } from "@fluentui/react-components";
import type { AppRoute, RouteKey } from "../models/navigation";
import type { TranslationKey } from "../localization/translations";

interface TopNavigationProps {
  readonly routes: readonly AppRoute[];
  readonly activeRouteKey: RouteKey;
  readonly onNavigate: (path: string) => void;
  readonly onPreload?: (route: AppRoute) => void;
  readonly t: (key: TranslationKey) => string;
}

export function TopNavigation({ routes, activeRouteKey, onNavigate, onPreload, t }: TopNavigationProps) {
  return (
    <nav className="topNavigation" aria-label={t("primaryNavigation")}>
      {routes.map((route) => (
        <Button
          appearance={route.key === activeRouteKey ? "primary" : "subtle"}
          className="topNavigationItem"
          key={route.key}
          onFocus={() => onPreload?.(route)}
          onMouseEnter={() => onPreload?.(route)}
          onClick={() => onNavigate(route.path)}
        >
          {t(route.labelKey)}
        </Button>
      ))}
    </nav>
  );
}
