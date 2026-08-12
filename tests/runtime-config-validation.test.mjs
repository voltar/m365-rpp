import assert from "node:assert/strict";
import test from "node:test";

import { validateCriticalRuntimeConfiguration } from "../src/infrastructure/deployment/runtimeConfigValidation.js";

test("missing deployment configuration fails in a browser", () => {
  const failure = validateCriticalRuntimeConfiguration({
    isBrowser: true,
    deploymentPresent: false,
    planningDataSource: "mock",
    apiBaseUrlValid: false,
    sharePointSiteUrlValid: false
  });

  assert.equal(failure?.code, "missingDeploymentConfiguration");
});

test("explicit mock deployment remains valid", () => {
  const failure = validateCriticalRuntimeConfiguration({
    isBrowser: true,
    deploymentPresent: true,
    planningDataSource: "mock",
    apiBaseUrlValid: false,
    sharePointSiteUrlValid: false
  });

  assert.equal(failure, undefined);
});

test("api deployment requires a valid base URL", () => {
  const failure = validateCriticalRuntimeConfiguration({
    isBrowser: true,
    deploymentPresent: true,
    planningDataSource: "api",
    apiBaseUrlValid: false,
    sharePointSiteUrlValid: false
  });

  assert.equal(failure?.code, "invalidApiBaseUrl");
});

test("sharepoint deployment requires a valid site URL", () => {
  const failure = validateCriticalRuntimeConfiguration({
    isBrowser: true,
    deploymentPresent: true,
    planningDataSource: "sharepoint",
    apiBaseUrlValid: false,
    sharePointSiteUrlValid: false
  });

  assert.equal(failure?.code, "invalidSharePointSiteUrl");
});
