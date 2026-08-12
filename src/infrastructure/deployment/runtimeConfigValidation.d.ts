import type { RuntimeConfigurationFailureCode } from "./runtimeConfig";

export interface CriticalRuntimeConfigurationInput {
  readonly isBrowser: boolean;
  readonly deploymentPresent: boolean;
  readonly planningDataSource: string | undefined;
  readonly apiBaseUrlValid: boolean;
  readonly sharePointSiteUrlValid: boolean;
}

export interface CriticalRuntimeConfigurationFailure {
  readonly code: RuntimeConfigurationFailureCode;
  readonly message: string;
}

export function validateCriticalRuntimeConfiguration(
  input: CriticalRuntimeConfigurationInput
): CriticalRuntimeConfigurationFailure | undefined;
