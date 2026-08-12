import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateRetryDelayMs,
  isRetryableMethod,
  isRetryableStatus
} from "../src/infrastructure/http/retryPolicy.js";

test("only idempotent methods are automatically retried", () => {
  assert.equal(isRetryableMethod("GET"), true);
  assert.equal(isRetryableMethod("HEAD"), true);
  assert.equal(isRetryableMethod("POST"), false);
  assert.equal(isRetryableMethod("DELETE"), false);
});

test("429 and temporary gateway failures are retryable", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(502), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(504), true);
  assert.equal(isRetryableStatus(500), false);
  assert.equal(isRetryableStatus(403), false);
});

test("Retry-After seconds are honored and capped", () => {
  assert.equal(calculateRetryDelayMs("5", 1, 0, 0), 5000);
  assert.equal(calculateRetryDelayMs("60", 1, 0, 0), 10000);
});

test("bare throttling uses exponential backoff with bounded jitter", () => {
  assert.equal(calculateRetryDelayMs(null, 1, 0, 0), 250);
  assert.equal(calculateRetryDelayMs(null, 2, 0, 0), 500);
  assert.equal(calculateRetryDelayMs(null, 2, 0, 1), 600);
});
