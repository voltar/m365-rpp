import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { hasUncommittedChanges, readReleaseVersion, readSourceRevision } from "./lib/release.mjs";

/**
 * EO-427 FR-427.3: one command produces the deployable API artefact. Every step that used to be a
 * remembered manual action — choosing the environment template, mirroring dist into wwwroot,
 * stamping the commit into the assembly — happens here, in order, or the script stops.
 *
 * Usage: node scripts/package-api.mjs --env prod
 */
const workspaceRoot = process.cwd();
const distPath = join(workspaceRoot, "dist");
const wwwrootPath = join(workspaceRoot, "RppWebApi", "wwwroot");
const publishPath = join(workspaceRoot, "publish", "RppWebApi");
const strayPublishPath = join(workspaceRoot, "RppWebApi", "publish");

const environment = readEnvironmentArgument();
const releaseVersion = readReleaseVersion(workspaceRoot);
const sourceRevision = readSourceRevision(workspaceRoot);

if (hasUncommittedChanges(workspaceRoot)) {
  console.warn(
    `Warning: the working tree has uncommitted changes, so ${sourceRevision} does not fully describe this artefact.`
  );
}

step(`Packaging release ${releaseVersion} at ${sourceRevision} for environment ${environment.toUpperCase()}`);

step("Building the frontend");
run("npm", ["run", "build"]);

step("Stamping runtime configuration");
run("node", ["scripts/stamp-runtime-config.mjs", "--env", environment]);

step("Validating the deployment artefact");
run("node", ["scripts/validate-deployment.mjs"]);
run("node", ["scripts/validate-security.mjs"]);
run("node", ["scripts/validate-release-consistency.mjs"]);

step("Mirroring dist into RppWebApi/wwwroot");
// Delete first: hashed asset names differ per build, so a merge would leave orphans from earlier
// bundles in the artefact and mix two frontends in one deployment.
rmSync(wwwrootPath, { recursive: true, force: true });
mkdirSync(wwwrootPath, { recursive: true });
cpSync(distPath, wwwrootPath, { recursive: true });
assertIdenticalTrees(distPath, wwwrootPath);

step("Publishing the API");
rmSync(join(workspaceRoot, "publish"), { recursive: true, force: true });
rmSync(strayPublishPath, { recursive: true, force: true });
run("dotnet", [
  "publish",
  "RppWebApi/RppWebApi.csproj",
  "-c",
  "Release",
  "-o",
  publishPath,
  `-p:SourceRevisionId=${sourceRevision}`
]);

step("Creating the deployment ZIP");
createZip();

step(`Done: publish/RppWebApi.zip (release ${releaseVersion}, revision ${sourceRevision})`);

function readEnvironmentArgument() {
  const args = process.argv.slice(2);
  const index = args.findIndex((arg) => arg === "--env" || arg.startsWith("--env="));

  if (index < 0) {
    fail("Missing --env. The target environment must be chosen explicitly, for example: --env prod");
  }

  const value = args[index].startsWith("--env=") ? args[index].slice("--env=".length) : args[index + 1];

  if (!value) {
    fail("--env requires a value, for example: --env prod");
  }

  return value.toLowerCase();
}

/**
 * FR-427.3: refuse to package when the mirror did not produce an exact copy. Comparing content, not
 * timestamps — a stale wwwroot is precisely the defect this EO exists to prevent.
 */
function assertIdenticalTrees(left, right) {
  const leftFiles = listFiles(left);
  const rightFiles = listFiles(right);
  const missing = leftFiles.filter((file) => !rightFiles.includes(file));
  const extra = rightFiles.filter((file) => !leftFiles.includes(file));

  if (missing.length > 0 || extra.length > 0) {
    fail(
      "dist and RppWebApi/wwwroot differ after mirroring." +
        (missing.length > 0 ? `\n  missing in wwwroot: ${missing.join(", ")}` : "") +
        (extra.length > 0 ? `\n  unexpected in wwwroot: ${extra.join(", ")}` : "")
    );
  }

  const differing = leftFiles.filter((file) => hashFile(join(left, file)) !== hashFile(join(right, file)));

  if (differing.length > 0) {
    fail(`dist and RppWebApi/wwwroot differ in content: ${differing.join(", ")}`);
  }

  console.log(`  ${leftFiles.length} files mirrored, byte-identical.`);
}

function listFiles(root) {
  const results = [];

  const walk = (directory) => {
    readdirSync(directory).forEach((entry) => {
      const absolute = join(directory, entry);

      if (statSync(absolute).isDirectory()) {
        walk(absolute);
        return;
      }

      results.push(relative(root, absolute).split(sep).join("/"));
    });
  };

  walk(root);

  return results.sort();
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * PowerShell Compress-Archive stores backslash paths, which breaks Kudu on Linux App Service
 * (EO-420). Python's zipfile normalizes to forward slashes.
 */
function createZip() {
  const archivePath = join(workspaceRoot, "publish", "RppWebApi.zip");

  rmSync(archivePath, { force: true });
  // The snippet lives in a file rather than behind `python -c`: this runs through a shell on
  // Windows, which would split an inline program on its spaces.
  run("python", ["scripts/make-zip.py", join(workspaceRoot, "publish", "RppWebApi"), publishPath]);

  if (!existsSync(archivePath)) {
    fail("ZIP creation did not produce publish/RppWebApi.zip.");
  }
}

function run(command, args) {
  // npm is a .cmd shim on Windows, and Node refuses to spawn .cmd without a shell since the
  // command-injection fixes. Only npm gets the shell; dotnet, node and python are real executables
  // and stay shell-free, so nothing here depends on shell quoting. Every argument is a literal.
  const needsShell = process.platform === "win32" && command === "npm";

  try {
    execFileSync(command, args, { cwd: workspaceRoot, stdio: "inherit", shell: needsShell });
  } catch {
    fail(`Step failed: ${command} ${args.join(" ")}`);
  }
}

function step(message) {
  console.log(`\n== ${message}`);
}

function fail(message) {
  console.error(`\nPackaging failed: ${message}`);
  process.exit(1);
}
