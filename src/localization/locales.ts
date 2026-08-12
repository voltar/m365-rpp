export const uiLocaleByLanguage = {
  am: "am-ET",
  ar: "ar-SA",
  bn: "bn-BD",
  bho: "bho-IN",
  de: "de-CH",
  "de-ch": "de-CH",
  en: "en-GB",
  es: "es-ES",
  fa: "fa-IR",
  fr: "fr-CH",
  gu: "gu-IN",
  ha: "ha-Latn-NG",
  hi: "hi-IN",
  id: "id-ID",
  it: "it-CH",
  ja: "ja-JP",
  jv: "jv-ID",
  kn: "kn-IN",
  ko: "ko-KR",
  ml: "ml-IN",
  mr: "mr-IN",
  my: "my-MM",
  nl: "nl-NL",
  om: "om-ET",
  pa: "pa-IN",
  pcm: "en-NG",
  pl: "pl-PL",
  pt: "pt-PT",
  ru: "ru-RU",
  sw: "sw-KE",
  ta: "ta-IN",
  te: "te-IN",
  th: "th-TH",
  tr: "tr-TR",
  uk: "uk-UA",
  ur: "ur-PK",
  vi: "vi-VN",
  yue: "yue-HK",
  zh: "zh-CN"
} as const;

export type Locale = keyof typeof uiLocaleByLanguage;

const supportedLocaleSet = new Set<string>(Object.keys(uiLocaleByLanguage));

export function isSupportedLocale(value: string): value is Locale {
  return supportedLocaleSet.has(value);
}
