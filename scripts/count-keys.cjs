const fs = require("fs");
const p = require("path");
const d = "src/localization";

const de = fs.readFileSync(p.join(d, "de.ts"), "utf-8");
const total = (de.match(/^\s+\w+:/gm) || []).length;

const locales = ["ja","ko","ar","pt","ru","nl","pl","tr","vi","th","id","es","fr","it","zh"];
console.log("Total keys in de.ts: " + total + "\n");
console.log("Locale  | Own keys | EN fallback | Coverage");
console.log("-".repeat(52));

for (const locale of locales) {
  const c = fs.readFileSync(p.join(d, locale + ".ts"), "utf-8");
  const own = (c.match(/^\s+\w+:\s*"/gm) || []).length;
  const fb = total - own;
  const pct = Math.round(own / total * 100);
  console.log(locale.padEnd(7) + "| " + String(own).padStart(8) + " | " + String(fb).padStart(11) + " | " + pct + "%");
}
