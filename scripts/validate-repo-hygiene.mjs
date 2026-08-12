import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const workspaceRoot = process.cwd();
const errors = [];
const warnings = [];

const trackedFiles = getTrackedFiles();

validateTrackedFileNames(trackedFiles);
validateTrackedAppSettings(trackedFiles);
validateRuntimeConfig(trackedFiles);

if (errors.length > 0) {
  console.error("Repository hygiene validation failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  warnings.forEach((warning) => console.warn(`Warning: ${warning}`));
  process.exitCode = 1;
} else {
  console.log("Repository hygiene validation passed.");
  warnings.forEach((warning) => console.warn(`Warning: ${warning}`));
}

function getTrackedFiles() {
  try {
    const output = execFileSync("git", ["ls-files", "-z"], {
      cwd: workspaceRoot,
      encoding: "utf8"
    });

    return output.split("\0").filter((file) => file.length > 0);
  } catch (error) {
    warnings.push("git ls-files is unavailable; repository hygiene validation falls back to scanning workspace files.");
    return enumerateWorkspaceFiles(workspaceRoot);
  }
}

function enumerateWorkspaceFiles(rootPath) {
  const files = [];
  const excludedDirectoryNames = new Set([
    ".git",
    ".idea",
    ".vite",
    ".vs",
    "bin",
    "dist",
    "node_modules",
    "obj"
  ]);

  visitDirectory(rootPath);
  return files;

  function visitDirectory(currentPath) {
    const entries = readdirSync(currentPath, { withFileTypes: true });

    entries.forEach((entry) => {
      const absolutePath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (!excludedDirectoryNames.has(entry.name)) {
          visitDirectory(absolutePath);
        }
        return;
      }

      files.push(relative(rootPath, absolutePath).replace(/\\/g, "/"));
    });
  }
}

function validateTrackedFileNames(files) {
  const forbiddenFilePatterns = [
    /^\.env(\..+)?$/i,
    /(^|\/)appsettings\.[^.]+\.local\.json$/i,
    /(^|\/)secrets(\..+)?\.json$/i,
    /(^|\/)runtime-config\.local\.js$/i,
    /(^|\/)id_rsa(\.pub)?$/i,
    /(^|\/)id_ed25519(\.pub)?$/i,
    /\.pfx$/i,
    /\.key$/i
  ];

  files.forEach((file) => {
    if (file === ".env.example") {
      return;
    }

    if (forbiddenFilePatterns.some((pattern) => pattern.test(file))) {
      errors.push(`Tracked file must not be committed: ${file}`);
    }
  });
}

function validateTrackedAppSettings(files) {
  const appSettingsFiles = files.filter((file) => /(^|\/)appsettings(\.[^.]+)?\.json$/i.test(file));

  appSettingsFiles.forEach((relativePath) => {
    const absolutePath = join(workspaceRoot, relativePath);
    const content = safeReadText(absolutePath);

    if (!content) {
      return;
    }

    try {
      const parsed = JSON.parse(content);
      const defaultConnection = parsed?.ConnectionStrings?.DefaultConnection;
      const clientSecret = parsed?.AzureAd?.ClientSecret;

      if (typeof defaultConnection === "string" && defaultConnection.trim().length > 0) {
        errors.push(`${relativePath} contains a non-empty ConnectionStrings:DefaultConnection value.`);
      }

      if (typeof clientSecret === "string" && clientSecret.trim().length > 0) {
        errors.push(`${relativePath} contains a non-empty AzureAd:ClientSecret value.`);
      }
    } catch {
      warnings.push(`${relativePath} could not be parsed as JSON during repository hygiene validation.`);
    }
  });
}

function validateRuntimeConfig(files) {
  const runtimeConfigFiles = files.filter((file) => /(^|\/)runtime-config\.js$/i.test(file));

  runtimeConfigFiles.forEach((relativePath) => {
    const absolutePath = join(workspaceRoot, relativePath);
    const content = safeReadText(absolutePath);

    if (!content) {
      return;
    }

    if (/clientsecret\s*[:=]|defaultconnection\s*[:=]|password\s*[:=]|authorization\s*[:=]|access[_-]?token\s*[:=]/i.test(content)) {
      errors.push(`${relativePath} appears to contain sensitive credential material.`);
    }
  });
}

function safeReadText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    warnings.push(`Unable to read ${filePath} during repository hygiene validation.`);
    return undefined;
  }
}