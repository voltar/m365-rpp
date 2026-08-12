export function isRetryableMethod(method: string): boolean;
export function isRetryableStatus(status: number): boolean;
export function calculateRetryDelayMs(
  retryAfter: string | null,
  attempt: number,
  nowMs?: number,
  random?: number
): number;
