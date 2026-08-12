/**
 * Static regression checks for release packaging alignment (EO-427 + deploy checklist).
 * Runs without a built dist/ — safe for pre-commit / CI smoke.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateRuntimeConfig, readReleaseVersion } from "../scripts/lib/release.mjs";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));

function readText(relativePath) {
  return readFileSync(join(workspaceRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function localizationKeys(source) {
  const keys = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s+([A-Za-z0-9_]+):\s*"/);
    if (match) {
      keys.push(match[1]);
    }
  }
  return keys;
}

// --- EO-427 version surfaces (source tree) ---------------------------------

test("release.json is the hand-written release label (semver major.minor.patch)", () => {
  const version = readReleaseVersion(workspaceRoot);
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test("teams-app-package/manifest.json version matches release.json", () => {
  const releaseVersion = readReleaseVersion(workspaceRoot);
  const manifest = readJson("teams-app-package/manifest.json");
  assert.equal(manifest.version, releaseVersion);
  assert.equal(typeof manifest.id, "string");
  assert.ok(manifest.id.length > 0, "manifest.id must be present and stable across releases");
});

test("package.json version stays at 0.1.0 (not the product release label)", () => {
  const pkg = readJson("package.json");
  assert.equal(pkg.version, "0.1.0");
});

// --- Runtime config templates (package:api --env) --------------------------

const REQUIRED_ENV_TEMPLATES = ["PROD", "MOCK", "HOSTEUROPE"];

test("public runtime-config templates exist for prod, mock, and hosteurope", () => {
  for (const env of REQUIRED_ENV_TEMPLATES) {
    const relativePath = `public/config/runtime-config-${env}.js`;
    assert.ok(existsSync(join(workspaceRoot, relativePath)), `missing ${relativePath}`);
  }
});

test("environment templates evaluate and declare a planning data source", () => {
  for (const env of REQUIRED_ENV_TEMPLATES) {
    const script = readText(`public/config/runtime-config-${env}.js`);
    const config = evaluateRuntimeConfig(script);
    assert.ok(
      ["mock", "sharepoint", "api"].includes(config.planningDataSource),
      `${env}: unexpected planningDataSource ${JSON.stringify(config.planningDataSource)}`
    );
  }
});

test("PROD and HOSTEUROPE templates target the api data source; MOCK stays mock", () => {
  const prod = evaluateRuntimeConfig(readText("public/config/runtime-config-PROD.js"));
  const hosteurope = evaluateRuntimeConfig(readText("public/config/runtime-config-HOSTEUROPE.js"));
  const mock = evaluateRuntimeConfig(readText("public/config/runtime-config-MOCK.js"));

  assert.equal(prod.planningDataSource, "api");
  assert.equal(hosteurope.planningDataSource, "api");
  assert.equal(mock.planningDataSource, "mock");
});

test("dev default public/config/runtime-config.js stays on mock (cannot ship by accident via npm run build)", () => {
  const devDefault = evaluateRuntimeConfig(readText("public/config/runtime-config.js"));
  assert.equal(devDefault.planningDataSource, "mock");
});

// --- Packaging scripts -----------------------------------------------------

test("package-api produces RppWebApi.zip and requires --env", () => {
  const source = readText("scripts/package-api.mjs");
  assert.match(source, /RppWebApi\.zip/);
  assert.match(source, /Missing --env/);
  assert.match(source, /validate-release-consistency/);
  // Must not claim to build the Teams catalog package
  assert.doesNotMatch(source, /rpp-teams-app-v/);
  assert.doesNotMatch(source, /teams-app-package\/.*\.zip/);
});

test("stamp-runtime-config resolves templates as runtime-config-<ENV>.js", () => {
  const source = readText("scripts/stamp-runtime-config.mjs");
  assert.match(source, /runtime-config-\$\{environment\.toUpperCase\(\)\}\.js/);
});

test("generate-locales prioritizes es, fr, it, zh, ko, fa after the English source", () => {
  const source = readText("scripts/generate-locales.mjs");
  const match = source.match(/const localeTargets = \[([\s\S]*?)\];/);
  assert.ok(match, "localeTargets array not found");
  const locales = [...match[1].matchAll(/locale:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(locales.slice(0, 6), ["es", "fr", "it", "zh", "ko", "fa"]);
});

// --- Localization source of truth ------------------------------------------

test("de.ts and en.ts expose the same localization key set", () => {
  const deKeys = localizationKeys(readText("src/localization/de.ts"));
  const enKeys = localizationKeys(readText("src/localization/en.ts"));
  assert.ok(deKeys.length > 100, `expected a full DE catalog, got ${deKeys.length} keys`);
  assert.deepEqual(deKeys, enKeys);
});

test("infoPageBadge exists in DE and EN (friendly phase label, not release.json)", () => {
  const de = readText("src/localization/de.ts");
  const en = readText("src/localization/en.ts");
  assert.match(de, /infoPageBadge:\s*"/);
  assert.match(en, /infoPageBadge:\s*"/);
});

test("prioritized locale files exist", () => {
  for (const locale of ["es", "fr", "it", "zh", "ko", "fa"]) {
    assert.ok(existsSync(join(workspaceRoot, `src/localization/${locale}.ts`)), `missing ${locale}.ts`);
  }
});

// --- Deploy docs / playbook alignment --------------------------------------

test("complete-release-build checklist exists and documents package:api + hosteurope", () => {
  const path = "docs/deploy/complete-release-build.md";
  assert.ok(existsSync(join(workspaceRoot, path)), `missing ${path}`);
  const text = readText(path);
  assert.match(text, /package:api/);
  assert.match(text, /hosteurope/i);
  assert.match(text, /RppWebApi\.zip/);
  assert.match(text, /does \*\*not\*\* build the Teams|does not build the Teams|not.*Teams catalog/i);
});

test("deployment.md links the release checklist", () => {
  const text = readText("docs/deploy/deployment.md");
  assert.match(text, /complete-release-build\.md/);
});

test("customer onboarding does not claim package:api builds the Teams ZIP", () => {
  const text = readText("docs/distribution/customer-onboarding-playbook.md");
  assert.doesNotMatch(
    text,
    /rpp-teams-app[^)\n]*produced by `npm run package:api`/i
  );
  assert.doesNotMatch(text, /produced by `npm run package:api`/);
  assert.match(text, /package:api.*only|only.*RppWebApi\.zip|separate.*artefact/i);
});

test("customer onboarding documents SQL Migrate at startup (not production ef database update as the path)", () => {
  const text = readText("docs/distribution/customer-onboarding-playbook.md");
  assert.match(text, /Database\.Migrate\(\)/);
  assert.match(text, /local\/dev/i);
  // Hand-rolled publish must not be the documented production path
  assert.doesNotMatch(
    text,
    /dotnet publish RppWebApi\/RppWebApi\.csproj -c Release -o publish\/RppWebApi/
  );
});

// --- API schema startup paths (ADR-007) ------------------------------------

test("Program.cs keeps SQL Migrate and Postgres CreateTables startup paths", () => {
  const source = readText("RppWebApi/Program.cs");
  assert.match(source, /Database\.Migrate\(\)/);
  assert.match(source, /CreateTables\(\)/);
  assert.match(source, /PostgreSQL database already has tables/);
});

// --- Help KB ingest surface ------------------------------------------------

test("help knowledge-base ingest folders exist with DE and EN pairs for core set", () => {
  const required = [
    "docs/user/getting-started.de.md",
    "docs/user/getting-started.en.md",
    "docs/user/team-admin.de.md",
    "docs/user/team-admin.en.md",
    "docs/faq/general-questions.de.md",
    "docs/faq/general-questions.en.md",
    "docs/glossary/rpp-terms.de.md",
    "docs/glossary/rpp-terms.en.md",
    "docs/release-notes/friends-family.de.md",
    "docs/release-notes/friends-family.en.md",
    "docs/release-notes/4.0.9-friends-family.de.md",
    "docs/release-notes/4.0.9-friends-family.en.md"
  ];
  for (const relativePath of required) {
    assert.ok(existsSync(join(workspaceRoot, relativePath)), `missing ${relativePath}`);
  }

  const teamAdminDe = readText("docs/user/team-admin.de.md");
  assert.match(teamAdminDe, /audience:\s*team-owner/);

  const kbDoc = readText("docs/architecture/help-assistant-knowledge-base.md");
  assert.match(kbDoc, /docs\/user/);
  assert.match(kbDoc, /docs\/faq/);
  assert.match(kbDoc, /docs\/glossary/);
  assert.match(kbDoc, /docs\/release-notes/);
  assert.match(kbDoc, /team-owner/);
});

test("release-notes directory is present for Help Assistant ingest", () => {
  const dir = join(workspaceRoot, "docs/release-notes");
  assert.ok(existsSync(dir));
  const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
  assert.ok(files.length >= 2, "expected at least DE+EN release-note files");
});
