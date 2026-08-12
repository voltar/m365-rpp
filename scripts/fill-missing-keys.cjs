const fs = require("fs");
const p = require("path");
const d = "src/localization";

// Read the canonical key set from de.ts (all keys)
const deContent = fs.readFileSync(p.join(d, "de.ts"), "utf-8");
const deKeys = [...deContent.matchAll(/^\s+(\w+):/gm)].map(m => m[1]);

// Read en.ts to get English fallback values
const enContent = fs.readFileSync(p.join(d, "en.ts"), "utf-8");

// Build a map of key -> English value from en.ts
const enValues = {};
for (const key of deKeys) {
  const regex = new RegExp(`^\\s+${key}:\\s*"([^"]*)"`, "m");
  const match = enContent.match(regex);
  if (match) enValues[key] = match[1];
}

// All locale files that use ...en spread (not base files, not de-ch which uses ...de)
const spreadFiles = fs.readdirSync(d)
  .filter(f => f.endsWith(".ts") && f !== "de.ts" && f !== "en.ts" && f !== "de-ch.ts"
    && f !== "translations.ts" && f !== "localizationService.ts");

for (const file of spreadFiles) {
  const fp = p.join(d, file);
  let content = fs.readFileSync(fp, "utf-8");

  // Find which keys are already present
  const existingKeys = new Set([...content.matchAll(/^\s+(\w+):/gm)].map(m => m[1]));

  // Find missing keys
  const missing = deKeys.filter(k => !existingKeys.has(k));
  if (missing.length === 0) {
    console.log(`✅ ${file}: complete (0 missing)`);
    continue;
  }

  // Build entries for missing keys using EN fallback
  const entries = missing.map(k => `  ${k}: "${enValues[k] || ""}",`).join("\n");

  // Insert before } satisfies
  const closingIndex = content.lastIndexOf("} satisfies");
  if (closingIndex === -1) {
    console.warn(`⚠️  ${file}: no closing brace found, skipping`);
    continue;
  }

  content = content.slice(0, closingIndex) + entries + "\n" + content.slice(closingIndex);
  fs.writeFileSync(fp, content);
  console.log(`📝 ${file}: ${missing.length} keys added`);
}

console.log("\nDone!");
