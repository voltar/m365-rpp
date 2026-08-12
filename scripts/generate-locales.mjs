import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { translate } from "@vitalets/google-translate-api";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const localizationDir = path.join(projectRoot, "src", "localization");
const enFilePath = path.join(localizationDir, "en.ts");
const checkpointFilePath = path.join(projectRoot, "scripts", ".locale-translation-checkpoint.json");

const localeTargets = [
  { locale: "es", sourceLang: "es", file: "es.ts" },
  { locale: "fr", sourceLang: "fr", file: "fr.ts" },
  { locale: "it", sourceLang: "it", file: "it.ts" },
  { locale: "zh", sourceLang: "zh-CN", file: "zh.ts" },
  { locale: "ko", sourceLang: "ko", file: "ko.ts" },
  { locale: "fa", sourceLang: "fa", file: "fa.ts" },
  { locale: "sw", sourceLang: "sw", file: "sw.ts" },
  { locale: "ha", sourceLang: "ha", file: "ha.ts" },
  { locale: "th", sourceLang: "th", file: "th.ts" },
  { locale: "gu", sourceLang: "gu", file: "gu.ts" },
  { locale: "kn", sourceLang: "kn", file: "kn.ts" },
  { locale: "jv", sourceLang: "jv", file: "jv.ts" },
  { locale: "pa", sourceLang: "pa", file: "pa.ts" },
  { locale: "am", sourceLang: "am", file: "am.ts" },
  { locale: "bho", sourceLang: "bho", file: "bho.ts" },
  { locale: "pl", sourceLang: "pl", file: "pl.ts" },
  { locale: "uk", sourceLang: "uk", file: "uk.ts" },
  { locale: "ml", sourceLang: "ml", file: "ml.ts" },
  { locale: "om", sourceLang: "om", file: "om.ts" },
  { locale: "nl", sourceLang: "nl", file: "nl.ts" },
  { locale: "my", sourceLang: "my", file: "my.ts" },
  { locale: "hi", sourceLang: "hi", file: "hi.ts" },
  { locale: "ar", sourceLang: "ar", file: "ar.ts" },
  { locale: "bn", sourceLang: "bn", file: "bn.ts" },
  { locale: "pt", sourceLang: "pt", file: "pt.ts" },
  { locale: "ru", sourceLang: "ru", file: "ru.ts" },
  { locale: "ur", sourceLang: "ur", file: "ur.ts" },
  { locale: "id", sourceLang: "id", file: "id.ts" },
  { locale: "ja", sourceLang: "ja", file: "ja.ts" },
  { locale: "pcm", sourceLang: "en", file: "pcm.ts" },
  { locale: "mr", sourceLang: "mr", file: "mr.ts" },
  { locale: "te", sourceLang: "te", file: "te.ts" },
  { locale: "tr", sourceLang: "tr", file: "tr.ts" },
  { locale: "ta", sourceLang: "ta", file: "ta.ts" },
  { locale: "yue", sourceLang: "zh-TW", file: "yue.ts" },
  { locale: "vi", sourceLang: "vi", file: "vi.ts" }
];

const BATCH_SIZE = Number.parseInt(process.env.LOCALE_BATCH_SIZE ?? "20", 10);
const BATCH_DELAY_MS = Number.parseInt(process.env.LOCALE_BATCH_DELAY_MS ?? "1400", 10);
const RETRY_MAX = 5;
const RETRY_DELAY_MS = Number.parseInt(process.env.LOCALE_RETRY_DELAY_MS ?? "3000", 10);
const LANGUAGE_PAUSE_MS = Number.parseInt(process.env.LOCALE_LANGUAGE_PAUSE_MS ?? "15000", 10);
const START_INDEX = Number.parseInt(process.env.LOCALE_START_INDEX ?? "0", 10);

const keyValueRegex = /^  ([a-zA-Z0-9]+): "((?:[^"\\]|\\.)*)",?$/;
const USE_GOOGLE_API = (process.env.LOCALE_USE_GOOGLE_API ?? "0") === "1";

function parseEnglishEntries(source) {
  const entries = [];
  for (const line of source.split("\n")) {
    const match = line.match(keyValueRegex);
    if (!match) {
      continue;
    }

    const key = match[1];
    const raw = match[2];
    const value = raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    entries.push({ key, value });
  }
  return entries;
}

function escapeTsString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function shouldKeepEnglish(value) {
  return /^EO-\d+/i.test(value) || /^https?:\/\//i.test(value);
}

async function translateEntries(entries, targetLanguage) {
  const translated = {};

  if (!USE_GOOGLE_API) {
    for (const { key, value } of entries) {
      translated[key] = value;
    }

    return translated;
  }

  for (const { key, value } of entries) {
    if (!value.trim() || shouldKeepEnglish(value)) {
      translated[key] = value;
    }
  }

  const translatableEntries = entries.filter(({ value }) => value.trim() && !shouldKeepEnglish(value));
  const totalBatches = Math.ceil(translatableEntries.length / BATCH_SIZE);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const batch = translatableEntries.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);
    const sourceTexts = batch.map((entry) => entry.value);
    const translatedTexts = await translateBatchWithRetry(sourceTexts, targetLanguage, batchIndex + 1, totalBatches);

    batch.forEach((entry, index) => {
      translated[entry.key] = translatedTexts[index] ?? entry.value;
    });

    await delay(BATCH_DELAY_MS);
  }

  return translated;
}

async function translateBatchWithRetry(texts, targetLanguage, batchNumber, totalBatches) {
  for (let attempt = 1; attempt <= RETRY_MAX; attempt += 1) {
    try {
      const result = await translate(texts, { to: targetLanguage });
      const resolved = Array.isArray(result) ? result.map((item) => item.text) : [result.text];
      const normalized = resolved.slice(0, texts.length);

      while (normalized.length < texts.length) {
        normalized.push(texts[normalized.length]);
      }

      console.log(`[${targetLanguage}] Batch ${batchNumber}/${totalBatches} translated (attempt ${attempt}).`);
      return normalized;
    } catch (error) {
      const message = String(error);
      const isRateLimited = /Too Many Requests|429/i.test(message);
      const retryDelayMs = isRateLimited ? Math.min(120000, RETRY_DELAY_MS * attempt * 3) : RETRY_DELAY_MS * attempt;

      if (attempt === RETRY_MAX) {
        console.warn(`[${targetLanguage}] Batch ${batchNumber}/${totalBatches} fallback after ${attempt} attempts: ${message}`);
        return texts;
      }

      console.warn(`[${targetLanguage}] Batch ${batchNumber}/${totalBatches} retry ${attempt}/${RETRY_MAX}: ${message}`);
      await delay(retryDelayMs);
    }
  }

  return texts;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readCheckpoint() {
  try {
    const raw = await fs.readFile(checkpointFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      completedLocales: Array.isArray(parsed.completedLocales) ? parsed.completedLocales : [],
      updatedAt: parsed.updatedAt ?? null
    };
  } catch {
    return { completedLocales: [], updatedAt: null };
  }
}

async function writeCheckpoint(completedLocales) {
  const payload = {
    completedLocales,
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(checkpointFilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function buildLocaleFile(localeName, translated) {
  const lines = [
    'import type { de } from "./de";',
    "",
    `export const ${localeName} = {`
  ];

  for (const [key, value] of Object.entries(translated)) {
    lines.push(`  ${key}: "${escapeTsString(value)}",`);
  }

  lines.push("} satisfies Record<keyof typeof de, string>;");
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const source = await fs.readFile(enFilePath, "utf8");
  const entries = parseEnglishEntries(source);
  const checkpoint = await readCheckpoint();
  const completedLocales = new Set(checkpoint.completedLocales);

  if (entries.length === 0) {
    throw new Error("No localization entries parsed from en.ts");
  }

  for (let index = START_INDEX; index < localeTargets.length; index += 1) {
    const target = localeTargets[index];

    if (completedLocales.has(target.locale)) {
      console.log(`Skipping ${target.file} (already completed).`);
      continue;
    }

    console.log(`Starting ${target.file} (${index + 1}/${localeTargets.length})`);
    const translated = await translateEntries(entries, target.sourceLang);
    const content = buildLocaleFile(target.locale, translated);
    const outputPath = path.join(localizationDir, target.file);
    await fs.writeFile(outputPath, content, "utf8");
    completedLocales.add(target.locale);
    await writeCheckpoint(Array.from(completedLocales));
    console.log(`Generated ${target.file}`);

    await delay(LANGUAGE_PAUSE_MS);
  }

  console.log("Locale generation finished.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
