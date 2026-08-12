import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = process.cwd();
const errors = [];
const warnings = [];

validateSourceSecurity();
validateBuiltSecurity();

if (errors.length > 0) {
  console.error("Security validation failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  warnings.forEach((warning) => console.warn(`Warning: ${warning}`));
  process.exitCode = 1;
} else {
  console.log("Security validation passed.");
  warnings.forEach((warning) => console.warn(`Warning: ${warning}`));
}

function validateSourceSecurity() {
  const indexPath = join(workspaceRoot, "index.html");
  const apiProgramPath = join(workspaceRoot, "RppWebApi", "Program.cs");

  if (!existsSync(indexPath)) {
    errors.push("index.html is missing.");
    return;
  }

  const indexHtml = readFileSync(indexPath, "utf8");

  if (!indexHtml.includes("Content-Security-Policy")) {
    errors.push("index.html does not define a Content Security Policy baseline.");
  }

  if (!indexHtml.includes('name="referrer"')) {
    errors.push("index.html does not define a referrer policy.");
  }

  if (!existsSync(apiProgramPath)) {
    errors.push("RppWebApi/Program.cs is missing.");
    return;
  }

  const apiProgram = readFileSync(apiProgramPath, "utf8");

  if (!apiProgram.includes("Content-Security-Policy")) {
    errors.push("RppWebApi/Program.cs does not set a production Content Security Policy header.");
  }

  if (!apiProgram.includes("X-Content-Type-Options") || !apiProgram.includes("nosniff")) {
    errors.push("RppWebApi/Program.cs does not set X-Content-Type-Options: nosniff.");
  }

  if (!apiProgram.includes("Referrer-Policy") || !apiProgram.includes("no-referrer")) {
    errors.push("RppWebApi/Program.cs does not set Referrer-Policy: no-referrer.");
  }

  if (!apiProgram.includes("Permissions-Policy") || !apiProgram.includes("camera=(), microphone=(), geolocation=()")) {
    errors.push("RppWebApi/Program.cs does not set a restrictive Permissions-Policy.");
  }

  if (/http:\/\/(?!localhost|127\.0\.0\.1)/i.test(indexHtml)) {
    errors.push("index.html must not reference insecure HTTP resources.");
  }
}

function validateBuiltSecurity() {
  const distPath = join(workspaceRoot, "dist");

  if (!existsSync(distPath)) {
    warnings.push("dist folder is missing; run npm run build before deployment security validation.");
    return;
  }

  const builtIndexPath = join(distPath, "index.html");

  if (!existsSync(builtIndexPath)) {
    errors.push("dist/index.html is missing.");
    return;
  }

  const builtIndexHtml = readFileSync(builtIndexPath, "utf8");

  if (!builtIndexHtml.includes("Content-Security-Policy")) {
    errors.push("dist/index.html does not include the Content Security Policy baseline.");
  }

  if (/http:\/\/(?!localhost|127\.0\.0\.1)/i.test(builtIndexHtml)) {
    errors.push("dist/index.html must not reference insecure HTTP resources.");
  }

  const runtimeConfigPath = join(distPath, "config", "runtime-config.js");

  if (!existsSync(runtimeConfigPath)) {
    return;
  }

  const runtimeConfig = readFileSync(runtimeConfigPath, "utf8");

  if (/(clientSecret|password|bearerToken|privateKey)\s*:/i.test(runtimeConfig) || /accessToken:\s*["'][^"']+["']/i.test(runtimeConfig)) {
    errors.push("Runtime configuration appears to contain sensitive credential material.");
  }

  if (/sharePointSiteUrl:\s*["']http:\/\//i.test(runtimeConfig)) {
    errors.push("Runtime configuration must not use an insecure SharePoint site URL.");
  }
}
