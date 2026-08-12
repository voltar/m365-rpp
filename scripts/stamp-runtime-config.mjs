import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  evaluateRuntimeConfig,
  readReleaseVersion,
  readSourceRevision,
  serializeRuntimeConfig
} from "./lib/release.mjs";

/**
 * EO-427 FR-427.2: pick the environment template explicitly and stamp the release label and commit
 * into `dist/config/runtime-config.js`. Nothing about the target environment is implicit — omitting
 * --env is an error, because the old default was "whatever public/config happened to contain", and
 * that is how a mock artefact once reached a deployment.
 */
const workspaceRoot = process.cwd();
const distConfigPath = join(workspaceRoot, "dist", "config");
const templateDirectory = join(workspaceRoot, "public", "config");

const environment = readEnvironmentArgument();
const templatePath = join(templateDirectory, `runtime-config-${environment.toUpperCase()}.js`);

if (!existsSync(templatePath)) {
  fail(`No runtime configuration template for environment "${environment}" (expected ${templatePath}).`);
}

if (!existsSync(distConfigPath)) {
  fail("dist/config does not exist. Run the frontend build before stamping.");
}

const config = evaluateRuntimeConfig(readFileSync(templatePath, "utf8"));

assertProviderRequirements(config);

const stamped = {
  ...config,
  releaseVersion: readReleaseVersion(workspaceRoot),
  sourceRevision: readSourceRevision(workspaceRoot)
};

writeFileSync(join(distConfigPath, "runtime-config.js"), serializeRuntimeConfig(stamped), "utf8");
removeTemplatesFromDist();

console.log(
  `Stamped dist/config/runtime-config.js from ${environment.toUpperCase()} ` +
    `(release ${stamped.releaseVersion}, revision ${stamped.sourceRevision}).`
);

function readEnvironmentArgument() {
  const args = process.argv.slice(2);
  const index = args.findIndex((arg) => arg === "--env" || arg.startsWith("--env="));

  if (index < 0) {
    fail(`Missing --env. Available templates: ${listAvailableEnvironments().join(", ") || "none"}.`);
  }

  const value = args[index].startsWith("--env=") ? args[index].slice("--env=".length) : args[index + 1];

  if (!value) {
    fail(`--env requires a value. Available templates: ${listAvailableEnvironments().join(", ") || "none"}.`);
  }

  return value.toLowerCase();
}

function listAvailableEnvironments() {
  return readdirSync(templateDirectory)
    .map((file) => /^runtime-config-(.+)\.js$/.exec(file)?.[1])
    .filter((name) => Boolean(name))
    .map((name) => name.toLowerCase());
}

/**
 * FR-427.2: a template that cannot work for its own provider must stop packaging here, not surface
 * as a blank screen in Teams.
 */
function assertProviderRequirements(candidate) {
  if (candidate.planningDataSource === "api") {
    if (!candidate.apiBaseUrl) {
      fail(`Template ${environment.toUpperCase()} selects planningDataSource "api" but carries no apiBaseUrl.`);
    }

    if (!Array.isArray(candidate.apiAccessTokenScopes) || candidate.apiAccessTokenScopes.length === 0) {
      fail(
        `Template ${environment.toUpperCase()} selects planningDataSource "api" but carries no apiAccessTokenScopes.`
      );
    }
  }

  if (candidate.planningDataSource === "sharepoint" && !candidate.sharePointSiteUrl) {
    fail(`Template ${environment.toUpperCase()} selects planningDataSource "sharepoint" but carries no sharePointSiteUrl.`);
  }
}

/**
 * Vite copies all of public/ verbatim, so every template — including PROD — would otherwise ship
 * inside the artefact next to the stamped file.
 */
function removeTemplatesFromDist() {
  readdirSync(distConfigPath)
    .filter((file) => /^runtime-config-.+\.js$/.test(file))
    .forEach((file) => rmSync(join(distConfigPath, file)));
}

function fail(message) {
  console.error(`Runtime configuration stamping failed: ${message}`);
  process.exit(1);
}
