import { createCorrelationId } from "./CorrelationId";
import { createSafeErrorDetails, type SafeErrorDetails } from "../security";

export type ApplicationErrorSeverity = "debug" | "info" | "warning" | "error";

export interface ApplicationError {
  readonly id: string;
  readonly timestamp: string;
  readonly severity: ApplicationErrorSeverity;
  readonly source: string;
  readonly component?: string;
  readonly operation?: string;
  readonly message: string;
  readonly innerError?: SafeErrorDetails;
  readonly correlationId: string;
}

export interface CreateApplicationErrorInput {
  readonly severity: ApplicationErrorSeverity;
  readonly source: string;
  readonly message: string;
  readonly component?: string;
  readonly operation?: string;
  readonly innerError?: unknown;
}

export function createApplicationError(input: CreateApplicationErrorInput): ApplicationError {
  const correlationId = createCorrelationId();
  const { innerError, ...safeInput } = input;

  return {
    id: `app-error-${correlationId}`,
    timestamp: new Date().toISOString(),
    correlationId,
    ...safeInput,
    innerError: innerError ? createSafeErrorDetails(innerError) : undefined
  };
}
