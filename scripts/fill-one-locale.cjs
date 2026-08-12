// Fill missing keys in a single locale file with English fallback values.
// Usage: node scripts/fill-one-locale.cjs <locale>
// Example: node scripts/fill-one-locale.cjs ja

const fs = require("fs");
const p = require("path");
const d = "src/localization";

const locale = process.argv[2];
if (!locale) {
  console.error("Usage: node scripts/fill-one-locale.cjs <locale>");
  console.error("Example: node scripts/fill-one-locale.cjs ja");
  process.exit(1);
}

const file = `${locale}.ts`;
const fp = p.join(d, file);

if (!fs.existsSync(fp)) {
  console.error(`File not found: ${fp}`);
  process.exit(1);
}

// Read the canonical key set from de.ts
const deContent = fs.readFileSync(p.join(d, "de.ts"), "utf-8");
const deKeys = [...deContent.matchAll(/^\s+(\w+):/gm)].map(m => m[1]);

// Read en.ts for fallback values
const enContent = fs.readFileSync(p.join(d, "en.ts"), "utf-8");
const enValues = {};
for (const key of deKeys) {
  const regex = new RegExp(`^\\s+${key}:\\s*"([^"]*)"`, "m");
  const match = enContent.match(regex);
  if (match) enValues[key] = match[1];
}

// Read the target locale file
let content = fs.readFileSync(fp, "utf-8");

// Find existing keys
const existingKeys = new Set([...content.matchAll(/^\s+(\w+):/gm)].map(m => m[1]));

// Find missing keys
const missing = deKeys.filter(k => !existingKeys.has(k));
if (missing.length === 0) {
  console.log(`✅ ${locale}: already complete (0 missing)`);
  process.exit(0);
}

// Build entries for missing keys using EN fallback
const entries = missing.map(k => `  ${k}: "${enValues[k] || ""}",`).join("\n");

// Insert before } satisfies
const closingIndex = content.lastIndexOf("} satisfies");
if (closingIndex === -1) {
  console.error(`Could not find closing brace in ${file}`);
  process.exit(1);
}

content = content.slice(0, closingIndex) + entries + "\n" + content.slice(closingIndex);
fs.writeFileSync(fp, content);
console.log(`✅ ${locale}: ${missing.length} keys added (EN fallback)`);
