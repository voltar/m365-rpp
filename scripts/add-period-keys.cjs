const fs = require("fs");
const p = require("path");
const d = "src/localization";

// All locale files that inherit from EN (not the base files)
const locales = [
  "am","ar","bho","bn","en","es","fa","fr","gu","ha","hi","id","it","ja","jv","kn","ko","ml","mr","my",
  "nl","om","pa","pcm","pl","pt","ru","sw","ta","te","th","tr","uk","ur","vi","yue","zh"
];

// The two new keys from EO-422 that were missing in de.ts
const newKeys = {
  timelinePeriodWeek: {
    en: "Week", es: "Semana", fr: "Semaine", it: "Settimana", zh: "周",
    ja: "週", ko: "주", ar: "أسبوع", pt: "Semana", ru: "Неделя",
    nl: "Week", pl: "Tydzień", tr: "Hafta", vi: "Tuần", th: "สัปดาห์", id: "Minggu",
  },
  timelinePeriodMonth: {
    en: "Month", es: "Mes", fr: "Mois", it: "Mese", zh: "月",
    ja: "月", ko: "월", ar: "شهر", pt: "Mês", ru: "Месяц",
    nl: "Maand", pl: "Miesiąc", tr: "Ay", vi: "Tháng", th: "เดือน", id: "Bulan",
  }
};

for (const locale of locales) {
  const filePath = p.join(d, `${locale}.ts`);
  let content = fs.readFileSync(filePath, "utf-8");

  // Find the closing brace
  const closingIndex = content.lastIndexOf("} satisfies Record<keyof typeof de, string>;");
  if (closingIndex === -1) {
    console.warn(`⚠️  ${locale}: Could not find closing brace`);
    continue;
  }

  // Build entries for the two new keys
  const weekVal = newKeys.timelinePeriodWeek[locale] || newKeys.timelinePeriodWeek.en;
  const monthVal = newKeys.timelinePeriodMonth[locale] || newKeys.timelinePeriodMonth.en;

  const entries = `  timelinePeriodWeek: "${weekVal}",\n  timelinePeriodMonth: "${monthVal}",\n`;

  content = content.slice(0, closingIndex) + entries + content.slice(closingIndex);
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`✅ ${locale}: timelinePeriodWeek + timelinePeriodMonth added`);
}

console.log("\nDone!");
