import type { ApplicationError } from "./ApplicationError";
import { createApplicationError } from "./ApplicationError";
import { createMonitoringLogEntry, recordMonitoringEvent } from "../../infrastructure/monitoring";
import { sanitizeDiagnosticDetails } from "../security";

export interface LogContext {
  readonly source: string;
  readonly component?: string;
  readonly operation?: string;
  readonly details?: Record<string, unknown>;
}

export interface Logger {
  readonly debug: (message: string, context: LogContext) => void;
  readonly info: (message: string, context: LogContext) => void;
  readonly warn: (message: string, context: LogContext) => void;
  readonly error: (message: string, context: LogContext, innerError?: unknown) => ApplicationError;
  readonly logApplicationError: (error: ApplicationError) => void;
}

export function createLogger(): Logger {
  const write = (level: "debug" | "info" | "warning", message: string, context: LogContext) => {
    if (level === "debug" && !import.meta.env.DEV) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
      details: sanitizeDiagnosticDetails(context.details)
    };
    recordMonitoringEvent(createMonitoringLogEntry(level, message, {
      ...context,
      details: sanitizeDiagnosticDetails(context.details)
    }));

    if (level === "warning") {
      console.warn(payload);
      return;
    }

    if (level === "debug") {
      console.debug(payload);
      return;
    }

    console.info(payload);
  };

  const logApplicationError = (error: ApplicationError) => {
    recordMonitoringEvent(createMonitoringLogEntry(error.severity, error.message, {
      source: error.source,
      component: error.component,
      operation: error.operation,
      details: { errorId: error.id }
    }, error.correlationId));
    console.error(error);
  };

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warning", message, context),
    error: (message, context, innerError) => {
      const applicationError = createApplicationError({
        severity: "error",
        source: context.source,
        component: context.component,
        operation: context.operation,
        message,
        innerError
      });

      logApplicationError(applicationError);
      return applicationError;
    },
    logApplicationError
  };
}
