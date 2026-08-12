import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = process.cwd();
const hooksPath = ".githooks";
const hookFilePath = join(workspaceRoot, hooksPath, "pre-commit");

if (!existsSync(hookFilePath)) {
  console.error(`Hook file is missing: ${hooksPath}/pre-commit`);
  process.exitCode = 1;
} else if (!isGitRepository()) {
  console.warn("Git hooks were not installed because this workspace is not an initialized Git repository yet.");
  console.warn(`After 'git init' or after cloning, run 'npm run install:git-hooks'.`);
} else {
  execFileSync("git", ["config", "core.hooksPath", hooksPath], {
    cwd: workspaceRoot,
    stdio: "inherit"
  });

  console.log(`Git hooks installed via core.hooksPath=${hooksPath}`);
}

function isGitRepository() {
  try {
    const output = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();

    return output === "true";
  } catch {
    return false;
  }
}