import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { evaluateRuntimeConfig } from "./lib/release.mjs";

const workspaceRoot = process.cwd();
const distPath = join(workspaceRoot, "dist");
const errors = [];

assertFile("index.html");
assertDirectory("assets");
assertFile("config/runtime-config.js");
assertFile("release.json");
assertFile("health.json");
validateAssets();
validateLocalePreloads();
validateResponseCompression();
validateRuntimeConfig();
validateReleaseMetadata();
validateHealthResource();

if (errors.length > 0) {
  console.error("Deployment validation failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log("Deployment validation passed.");
}

function assertFile(relativePath) {
  if (!existsSync(join(distPath, relativePath))) {
    errors.push(`Missing required deployment artefact: ${relativePath}`);
  }
}

function assertDirectory(relativePath) {
  if (!existsSync(join(distPath, relativePath))) {
    errors.push(`Missing required deployment directory: ${relativePath}`);
  }
}

function validateAssets() {
  const assetsPath = join(distPath, "assets");

  if (!existsSync(assetsPath)) {
    return;
  }

  const files = readdirSync(assetsPath);
  const hasJavaScript = files.some((file) => file.endsWith(".js"));
  const hasCss = files.some((file) => file.endsWith(".css"));

  if (!hasJavaScript) {
    errors.push("Deployment assets do not contain JavaScript chunks.");
  }

  if (!hasCss) {
    errors.push("Deployment assets do not contain CSS chunks.");
  }
}

function validateLocalePreloads() {
  const indexPath = join(distPath, "index.html");

  if (!existsSync(indexPath)) {
    return;
  }

  const indexHtml = readFileSync(indexPath, "utf8");
  const modulePreloadCount = (indexHtml.match(/rel=["']modulepreload["']/g) ?? []).length;
  // Per-locale UI bundles only (not shared localization-* infrastructure chunks).
  const localeCodes = [
    "am", "ar", "bn", "bho", "de", "de-ch", "en", "es", "fa", "fr", "gu", "ha", "hi", "id",
    "it", "ja", "jv", "kn", "ko", "ml", "mr", "my", "nl", "om", "pa", "pcm", "pl", "pt", "ru",
    "sw", "ta", "te", "th", "tr", "uk", "ur", "vi", "yue", "zh"
  ];
  const localePattern = new RegExp(
    `/assets/localization-(${localeCodes.join("|")})-[^"'\\s>]+\\.js`,
    "g"
  );
  const preloadedLocales = [...indexHtml.matchAll(localePattern)].map((match) => match[1]);
  const unexpectedLocales = preloadedLocales.filter((locale) => locale !== "en");

  // English is a static import of en.ts (often folded into localization-translations-*).
  // The gate forbids eagerly preloading any other locale; en preload is optional.
  if (unexpectedLocales.length > 0) {
    errors.push(
      `Initial module graph eagerly preloads locale bundles: ${unexpectedLocales.join(", ")}. ` +
        "Only the static English fallback may ride the initial graph (EO-452)."
    );
  }

  const hasEnglishFallback =
    preloadedLocales.includes("en") ||
    /\/assets\/localization-translations-[^"'\\s>]+\.js/.test(indexHtml) ||
    /from\s*["'].*localization\/en/.test(indexHtml) ||
    existsSync(join(distPath, "assets")) &&
      readdirSync(join(distPath, "assets")).some(
        (file) => file.startsWith("localization-en-") || file.startsWith("localization-translations-")
      );

  if (!hasEnglishFallback) {
    errors.push(
      "Could not verify the static English locale fallback (localization-en or localization-translations chunk)."
    );
  }

  // Shared infrastructure preloads (runtime, fluentui, vendor, teams, …) plus translations.
  if (modulePreloadCount > 18) {
    errors.push(
      `Initial module graph contains ${modulePreloadCount} module preloads; expected at most 18 after lazy localization.`
    );
  }
}

function validateResponseCompression() {
  const programPath = join(workspaceRoot, "RppWebApi", "Program.cs");

  if (!existsSync(programPath)) {
    errors.push("Could not validate API response compression because RppWebApi/Program.cs is missing.");
    return;
  }

  const program = readFileSync(programPath, "utf8");
  const registrationIndex = program.indexOf("AddResponseCompression");
  const middlewareIndex = program.indexOf("UseResponseCompression");
  const staticFilesIndex = program.indexOf("UseStaticFiles");

  if (registrationIndex < 0 || middlewareIndex < 0) {
    errors.push("RppWebApi must register and enable response compression.");
  } else if (staticFilesIndex >= 0 && middlewareIndex > staticFilesIndex) {
    errors.push("Response compression middleware must run before static-file middleware.");
  }
}

function validateRuntimeConfig() {
  const configPath = join(distPath, "config", "runtime-config.js");

  if (!existsSync(configPath)) {
    return;
  }

  // Evaluate rather than match on text: the stamped file is generated with JSON quoting, so the
  // former `planningDataSource: "api"` substring checks would silently never match again (EO-427).
  let config;

  try {
    config = evaluateRuntimeConfig(readFileSync(configPath, "utf8"));
  } catch (error) {
    errors.push(`Runtime configuration could not be evaluated: ${error.message}`);
    return;
  }

  if (config.planningDataSource === "sharepoint" && !config.sharePointSiteUrl) {
    errors.push("SharePoint data source requires sharePointSiteUrl in runtime configuration.");
  }

  if (config.planningDataSource === "api" && !config.apiBaseUrl) {
    errors.push("API data source requires apiBaseUrl in runtime configuration.");
  }
}

function validateReleaseMetadata() {
  const releasePath = join(distPath, "release.json");

  if (!existsSync(releasePath)) {
    return;
  }

  try {
    const releaseMetadata = JSON.parse(readFileSync(releasePath, "utf8"));
    ["application", "packageVersion", "releaseVersion", "sourceRevision", "builtAt"].forEach((field) => {
      if (!releaseMetadata[field]) {
        errors.push(`Release metadata is missing ${field}.`);
      }
    });
  } catch {
    errors.push("Release metadata is not valid JSON.");
  }
}

function validateHealthResource() {
  const healthPath = join(distPath, "health.json");

  if (!existsSync(healthPath)) {
    return;
  }

  try {
    const health = JSON.parse(readFileSync(healthPath, "utf8"));

    if (health.status !== "healthy") {
      errors.push("Static health resource must report healthy status.");
    }
  } catch {
    errors.push("Static health resource is not valid JSON.");
  }
}
