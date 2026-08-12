import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * EO-427 FR-427.1: `release.json` at the repository root is the one place the release label is
 * written by hand. Everything else derives from it or is validated against it.
 */
export function readReleaseVersion(workspaceRoot = process.cwd()) {
  const releasePath = join(workspaceRoot, "release.json");

  if (!existsSync(releasePath)) {
    throw new Error("release.json is missing at the repository root; it defines the release label (EO-427).");
  }

  let parsed;

  try {
    parsed = JSON.parse(readFileSync(releasePath, "utf8"));
  } catch {
    throw new Error("release.json is not valid JSON.");
  }

  if (typeof parsed.version !== "string" || !RELEASE_VERSION_PATTERN.test(parsed.version)) {
    throw new Error(
      `release.json must carry a "version" of the form major.minor.patch; found ${JSON.stringify(parsed.version)}.`
    );
  }

  return parsed.version;
}

/**
 * The commit the artefact is built from. FR-427.1 forbids placeholders such as "0", so this throws
 * rather than inventing a value. SOURCE_REVISION stays available for builds outside a git checkout.
 */
export function readSourceRevision(workspaceRoot = process.cwd()) {
  const provided = process.env.SOURCE_REVISION?.trim();

  if (provided) {
    return provided;
  }

  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    throw new Error(
      "Could not determine the source revision from git. Set SOURCE_REVISION when building outside a checkout."
    );
  }
}

/** True when tracked files differ from HEAD, i.e. the revision does not fully describe the artefact. */
export function hasUncommittedChanges(workspaceRoot = process.cwd()) {
  try {
    return (
      execFileSync("git", ["status", "--porcelain"], {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim().length > 0
    );
  } catch {
    return false;
  }
}

/**
 * Runtime configuration is executable JavaScript, not JSON: it assigns to a global. Running it in a
 * throwaway context with a stub `window` yields the real values, which beats matching on text.
 */
export function evaluateRuntimeConfig(configScript) {
  const sandbox = { window: {} };

  createContext(sandbox);
  runInContext(configScript, sandbox, { timeout: 1000 });

  const config = sandbox.window.__RESOURCE_PRESENCE_PLANNER_CONFIG__;

  if (!config || typeof config !== "object") {
    throw new Error("Runtime configuration does not assign __RESOURCE_PRESENCE_PLANNER_CONFIG__.");
  }

  return config;
}

export function serializeRuntimeConfig(config) {
  return `window.__RESOURCE_PRESENCE_PLANNER_CONFIG__ = ${JSON.stringify(config, null, 2)};\n`;
}
