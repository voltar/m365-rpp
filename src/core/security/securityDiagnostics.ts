import type { RepositoryError } from "../../repositories/planningRepositories";

export interface SafeErrorDetails {
  readonly name?: string;
  readonly message: string;
}

const sensitiveKeyPattern = /(authorization|token|secret|password|cookie|session|credential|apikey|api-key)/i;
const redactedValue = "[redacted]";

export function createSafeErrorDetails(error: unknown): SafeErrorDetails {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  if (error && typeof error === "object") {
    const err = error as { name?: string; message?: string };
    return {
      name: err.name || "Error",
      message: err.message || JSON.stringify(err) || "Unknown error"
    };
  }

  return {
    message: typeof error === "string" ? error : "Unexpected error"
  };
}

export function sanitizeDiagnosticDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      sensitiveKeyPattern.test(key) ? redactedValue : sanitizeDiagnosticValue(value)
    ])
  );
}

export function createSecurityRepositoryError(message: string, details?: Record<string, unknown>): RepositoryError {
  return {
    code: "validation",
    details: sanitizeDiagnosticDetails(details),
    message,
    recoverable: false
  };
}

function sanitizeDiagnosticValue(value: unknown): unknown {
  if (value instanceof Error) {
    return createSafeErrorDetails(value);
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeDiagnosticValue);
  }

  if (value && typeof value === "object") {
    return sanitizeDiagnosticDetails(value as Record<string, unknown>);
  }

  return value;
}
