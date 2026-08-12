const retryableMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const defaultBaseDelayMs = 250;
const defaultMaximumDelayMs = 10_000;

export function isRetryableMethod(method) {
  return retryableMethods.has(method.toUpperCase());
}

export function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export function calculateRetryDelayMs(
  retryAfter,
  attempt,
  nowMs = Date.now(),
  random = Math.random()
) {
  const retryAfterMs = parseRetryAfterMs(retryAfter, nowMs);

  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, defaultMaximumDelayMs);
  }

  const exponentialDelay = defaultBaseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = exponentialDelay * 0.2 * random;
  return Math.min(Math.round(exponentialDelay + jitter), defaultMaximumDelayMs);
}

function parseRetryAfterMs(value, nowMs) {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryDateMs = Date.parse(value);
  if (Number.isNaN(retryDateMs)) {
    return undefined;
  }

  return Math.max(0, retryDateMs - nowMs);
}
