import type { Logger } from "../../core/logging";
import {
  calculateRetryDelayMs,
  isRetryableMethod,
  isRetryableStatus
} from "./retryPolicy.js";

const defaultMaximumAttempts = 3;

export interface ResilientFetchContext {
  readonly component: string;
  readonly operation: string;
  readonly logger?: Logger;
}

export async function resilientFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  context?: ResilientFetchContext
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const mayRetry = isRetryableMethod(method);

  for (let attempt = 1; attempt <= defaultMaximumAttempts; attempt += 1) {
    const response = await fetch(input, init);

    if (!mayRetry || !isRetryableStatus(response.status) || attempt === defaultMaximumAttempts) {
      return response;
    }

    const delayMs = calculateRetryDelayMs(response.headers.get("Retry-After"), attempt);
    context?.logger?.warn("Transient HTTP response will be retried.", {
      source: "infrastructure",
      component: context.component,
      operation: context.operation,
      details: { status: response.status, attempt, delayMs }
    });

    await response.body?.cancel();
    await waitForRetry(delayMs, init.signal);
  }

  throw new Error("HTTP retry loop ended without a response.");
}

function waitForRetry(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(resolve, delayMs);

    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeoutId);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}
