import type { Logger } from "../core/logging";
import type { Locale } from "../models/navigation";
import { isSupportedLocale } from "./locales";

interface TeamsContextLike {
  readonly app?: {
    readonly locale?: string;
    readonly getContext?: () => Promise<{ readonly app?: { readonly locale?: string }; readonly locale?: string }>;
  };
  readonly context?: {
    readonly locale?: string;
  };
}

interface M365Window extends Window {
  readonly microsoftTeams?: TeamsContextLike;
  readonly _spPageContextInfo?: {
    readonly currentUICultureName?: string;
    readonly currentCultureName?: string;
  };
}

export function resolveInitialLocale(logger?: Logger): Locale {
  return resolveLocaleFromCandidates(
    [
      getTeamsLocale(),
      getSharePointLocale(),
      document.documentElement.lang,
      ...navigator.languages,
      navigator.language
    ],
    logger
  );
}

export async function resolveHostLocale(logger?: Logger): Promise<Locale> {
  const teamsLocale = await getAsyncTeamsLocale(logger);

  return resolveLocaleFromCandidates(
    [
      teamsLocale,
      getTeamsLocale(),
      getSharePointLocale(),
      document.documentElement.lang,
      ...navigator.languages,
      navigator.language
    ],
    logger
  );
}

function resolveLocaleFromCandidates(candidates: readonly (string | undefined)[], logger?: Logger): Locale {
  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate, logger);

    if (locale) {
      return locale;
    }
  }

  return "en";
}

function normalizeLocale(value: string | undefined, logger?: Logger): Locale | undefined {
  if (!value) {
    return undefined;
  }

  if (!/^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/i.test(value)) {
    logger?.warn("Invalid locale code ignored.", {
      source: "localization",
      component: "localizationService",
      operation: "normalizeLocale",
      details: { value }
    });
    return undefined;
  }

  const normalizedLocale = value.toLowerCase().replace(/_/g, "-");

  if (isSupportedLocale(normalizedLocale)) {
    return normalizedLocale;
  }

  const language = normalizedLocale.split("-")[0];

  return isSupportedLocale(language) ? language : undefined;
}

function getTeamsLocale(): string | undefined {
  const hostWindow = window as M365Window;

  return hostWindow.microsoftTeams?.app?.locale ?? hostWindow.microsoftTeams?.context?.locale;
}

async function getAsyncTeamsLocale(logger?: Logger): Promise<string | undefined> {
  try {
    const context = await (window as M365Window).microsoftTeams?.app?.getContext?.();

    return context?.app?.locale ?? context?.locale;
  } catch (error) {
    logger?.warn("Unable to resolve Microsoft Teams locale.", {
      source: "localization",
      component: "localizationService",
      operation: "getAsyncTeamsLocale",
      details: { error }
    });
    return undefined;
  }
}

function getSharePointLocale(): string | undefined {
  const pageContext = (window as M365Window)._spPageContextInfo;

  return pageContext?.currentUICultureName ?? pageContext?.currentCultureName;
}
