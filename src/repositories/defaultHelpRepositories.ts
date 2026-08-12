import type { Logger } from "../core/logging";
import { getRuntimeConfiguration } from "../infrastructure/deployment/runtimeConfig";
import type { TranslationKey } from "../localization/translations";
import { createApiHelpRepository } from "./apiHelpRepository";
import type { HelpRepository } from "./helpRepositories";
import { createMockHelpRepository } from "./mockHelpRepository";

/**
 * ADR-003: provider selection is a runtime concern. With `planningDataSource: "api"`
 * the assistant runs against the RPP Web API (and therefore Foundry); every other
 * mode falls back to the demo provider so the Help tab stays browsable without a
 * backend.
 */
export function createDefaultHelpRepository(
  t: (key: TranslationKey) => string,
  logger?: Logger
): HelpRepository {
  const runtimeConfiguration = getRuntimeConfiguration(logger);

  if (runtimeConfiguration.planningDataSource === "api" && runtimeConfiguration.apiBaseUrl) {
    return createApiHelpRepository(runtimeConfiguration.apiBaseUrl, logger);
  }

  return createMockHelpRepository(t);
}
