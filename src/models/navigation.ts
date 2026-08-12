import type { TranslationKey } from "../localization/translations";

export type { Locale } from "../localization/locales";

export type ThemeMode = "light" | "dark";

export type RouteKey =
  | "overview"
  | "teamCapacity"
  | "teamAdmin"
  | "appAdmin"
  | "reports"
  | "approvals"
  | "settings"
  | "info";

export interface AppRoute {
  readonly key: RouteKey;
  readonly path: string;
  readonly labelKey: TranslationKey;
  readonly descriptionKey: TranslationKey;
}
