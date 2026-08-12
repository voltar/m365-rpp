import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readReleaseVersion, readSourceRevision } from "./lib/release.mjs";

const workspaceRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8"));

// EO-427 FR-427.1: the release label comes from release.json, never from package.json. The two mean
// different things — packageVersion identifies the npm package, releaseVersion is what ships to the
// tenant. The RELEASE_VERSION environment override is gone with them; there is one source now.
const releaseMetadata = {
  application: packageJson.name,
  author: packageJson.author,
  packageVersion: packageJson.version,
  releaseVersion: readReleaseVersion(workspaceRoot),
  sourceRevision: readSourceRevision(workspaceRoot),
  environmentName: process.env.DEPLOYMENT_ENVIRONMENT || "local",
  builtAt: new Date().toISOString()
};

mkdirSync(join(workspaceRoot, "dist"), { recursive: true });
writeFileSync(
  join(workspaceRoot, "dist", "release.json"),
  `${JSON.stringify(releaseMetadata, null, 2)}\n`,
  "utf8"
);
