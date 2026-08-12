const fs = require("fs");
const p = require("path");
const d = "src/localization";

const data = {
  en: { timelinePeriodWeek: "Week", timelinePeriodMonth: "Month" },
  fr: { timelinePeriodWeek: "Semaine", timelinePeriodMonth: "Mois" },
  it: { timelinePeriodWeek: "Settimana", timelinePeriodMonth: "Mese" },
  zh: { timelinePeriodWeek: "周", timelinePeriodMonth: "月" },
};

for (const [locale, keys] of Object.entries(data)) {
  const fp = p.join(d, `${locale}.ts`);
  let c = fs.readFileSync(fp, "utf-8");
  const i = c.lastIndexOf("} satisfies");
  if (i === -1) { console.warn("skip " + locale); continue; }
  const entries = Object.entries(keys).map(([k, v]) => `  ${k}: "${v}",`).join("\n");
  c = c.slice(0, i) + entries + "\n" + c.slice(i);
  fs.writeFileSync(fp, c);
  console.log("OK " + locale);
}
