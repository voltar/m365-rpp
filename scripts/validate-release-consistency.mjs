import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { evaluateRuntimeConfig, readReleaseVersion, readSourceRevision } from "./lib/release.mjs";

/**
 * EO-427 FR-427.5: the version a user sees in Teams is produced by four independent surfaces. This
 * asserts they state the same release, and that the stamped revision is the commit being packaged.
 * It fails the build — a warning would have been ignored exactly as the drift was before.
 */
const workspaceRoot = process.cwd();
const errors = [];

const releaseVersion = readReleaseVersion(workspaceRoot);
const sourceRevision = readSourceRevision(workspaceRoot);

checkStampedRuntimeConfig();
checkReleaseMetadata();
checkTeamsManifest();
checkAssemblyVersion();

if (errors.length > 0) {
  console.error(`Release consistency validation failed (release.json states ${releaseVersion}):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Release consistency validation passed: ${releaseVersion} at ${sourceRevision}.`);

function checkStampedRuntimeConfig() {
  const configPath = join(workspaceRoot, "dist", "config", "runtime-config.js");

  if (!existsSync(configPath)) {
    errors.push("dist/config/runtime-config.js is missing. Run the frontend build and stamp it before validating.");
    return;
  }

  let config;

  try {
    config = evaluateRuntimeConfig(readFileSync(configPath, "utf8"));
  } catch (error) {
    errors.push(`dist/config/runtime-config.js could not be evaluated: ${error.message}`);
    return;
  }

  if (config.releaseVersion !== releaseVersion) {
    errors.push(
      `Stamped releaseVersion is ${JSON.stringify(config.releaseVersion)} but release.json states ${releaseVersion}. ` +
        "Re-run scripts/stamp-runtime-config.mjs."
    );
  }

  if (config.sourceRevision !== sourceRevision) {
    errors.push(
      `Stamped sourceRevision is ${JSON.stringify(config.sourceRevision)} but the packaged commit is ${sourceRevision}.`
    );
  }
}

function checkReleaseMetadata() {
  const metadataPath = join(workspaceRoot, "dist", "release.json");

  if (!existsSync(metadataPath)) {
    errors.push("dist/release.json is missing.");
    return;
  }

  let metadata;

  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch {
    errors.push("dist/release.json is not valid JSON.");
    return;
  }

  if (metadata.releaseVersion !== releaseVersion) {
    errors.push(
      `dist/release.json states releaseVersion ${JSON.stringify(metadata.releaseVersion)} but release.json states ${releaseVersion}.`
    );
  }

  if (metadata.sourceRevision !== sourceRevision) {
    errors.push(
      `dist/release.json states sourceRevision ${JSON.stringify(metadata.sourceRevision)} but the packaged commit is ${sourceRevision}.`
    );
  }
}

/**
 * The manifest ships inside the uploaded ZIP, so the repository copy is what can be validated here.
 * docs/deployment.md requires the two to be kept identical.
 */
function checkTeamsManifest() {
  const manifestPath = join(workspaceRoot, "teams-app-package", "manifest.json");

  if (!existsSync(manifestPath)) {
    errors.push("teams-app-package/manifest.json is missing; it must mirror the manifest inside the release ZIP.");
    return;
  }

  let manifest;

  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    errors.push("teams-app-package/manifest.json is not valid JSON.");
    return;
  }

  if (manifest.version !== releaseVersion) {
    errors.push(
      `Teams manifest states version ${JSON.stringify(manifest.version)} but release.json states ${releaseVersion}.`
    );
  }
}

function checkAssemblyVersion() {
  const projectPath = join(workspaceRoot, "RppWebApi", "RppWebApi.csproj");

  if (!existsSync(projectPath)) {
    errors.push("RppWebApi/RppWebApi.csproj is missing.");
    return;
  }

  // Ask MSBuild what it actually resolves rather than trusting the file to look right.
  let resolved;

  try {
    resolved = execFileSync("dotnet", ["msbuild", projectPath, "-getProperty:Version", "-nologo"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch {
    errors.push(
      "Could not read the assembly version from MSBuild. Install the .NET SDK, or run this check where `dotnet` is available."
    );
    return;
  }

  if (resolved !== releaseVersion) {
    errors.push(`RppWebApi assembly version resolves to ${JSON.stringify(resolved)} but release.json states ${releaseVersion}.`);
  }
}
