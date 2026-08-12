import type { Logger } from "../core/logging";
import type { Locale } from "./locales";
import { en } from "./en";

export type TranslationKey = keyof typeof en;
export type Translator = (key: TranslationKey) => string;

type TranslationResources = Record<TranslationKey, string>;
type LocaleLoader = () => Promise<TranslationResources>;

const localeLoaders: Record<Exclude<Locale, "en">, LocaleLoader> = {
  am: () => import("./am").then((module) => module.am),
  ar: () => import("./ar").then((module) => module.ar),
  bn: () => import("./bn").then((module) => module.bn),
  bho: () => import("./bho").then((module) => module.bho),
  de: () => import("./de").then((module) => module.de),
  "de-ch": () => import("./de-ch").then((module) => module.deCh),
  es: () => import("./es").then((module) => module.es),
  fa: () => import("./fa").then((module) => module.fa),
  fr: () => import("./fr").then((module) => module.fr),
  gu: () => import("./gu").then((module) => module.gu),
  ha: () => import("./ha").then((module) => module.ha),
  hi: () => import("./hi").then((module) => module.hi),
  id: () => import("./id").then((module) => module.id),
  it: () => import("./it").then((module) => module.it),
  ja: () => import("./ja").then((module) => module.ja),
  jv: () => import("./jv").then((module) => module.jv),
  kn: () => import("./kn").then((module) => module.kn),
  ko: () => import("./ko").then((module) => module.ko),
  ml: () => import("./ml").then((module) => module.ml),
  mr: () => import("./mr").then((module) => module.mr),
  my: () => import("./my").then((module) => module.my),
  nl: () => import("./nl").then((module) => module.nl),
  om: () => import("./om").then((module) => module.om),
  pa: () => import("./pa").then((module) => module.pa),
  pcm: () => import("./pcm").then((module) => module.pcm),
  pl: () => import("./pl").then((module) => module.pl),
  pt: () => import("./pt").then((module) => module.pt),
  ru: () => import("./ru").then((module) => module.ru),
  sw: () => import("./sw").then((module) => module.sw),
  ta: () => import("./ta").then((module) => module.ta),
  te: () => import("./te").then((module) => module.te),
  th: () => import("./th").then((module) => module.th),
  tr: () => import("./tr").then((module) => module.tr),
  uk: () => import("./uk").then((module) => module.uk),
  ur: () => import("./ur").then((module) => module.ur),
  vi: () => import("./vi").then((module) => module.vi),
  yue: () => import("./yue").then((module) => module.yue),
  zh: () => import("./zh").then((module) => module.zh)
};

const loadedLocales = new Map<Locale, TranslationResources>([["en", en]]);
const pendingLocales = new Map<Locale, Promise<TranslationResources>>();

export async function loadLocale(locale: Locale, logger?: Logger): Promise<void> {
  if (locale === "en" || loadedLocales.has(locale)) {
    return;
  }

  const existingLoad = pendingLocales.get(locale);
  if (existingLoad) {
    await existingLoad;
    return;
  }

  const loader = localeLoaders[locale];
  const pendingLoad = loader()
    .then((resources) => {
      loadedLocales.set(locale, resources);
      return resources;
    })
    .catch((error: unknown) => {
      logger?.warn("Unable to load locale. Falling back to English.", {
        source: "localization",
        component: "translations",
        operation: "loadLocale",
        details: { locale, error }
      });
      return en;
    })
    .finally(() => pendingLocales.delete(locale));

  pendingLocales.set(locale, pendingLoad);
  await pendingLoad;
}

export const createTranslator = (locale: Locale, logger?: Logger): Translator => {
  const resources = loadedLocales.get(locale) ?? en;

  return (key: TranslationKey): string => {
    const localizedValue = resources[key];

    if (localizedValue) {
      return localizedValue;
    }

    logger?.warn("Missing localized resource. Falling back to English.", {
      source: "localization",
      component: "translations",
      operation: "createTranslator",
      details: { locale, key }
    });

    return en[key];
  };
};
