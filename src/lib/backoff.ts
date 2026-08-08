export interface BackoffOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  factor?: number;
}

const DEFAULTS: Required<BackoffOptions> = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: true,
  factor: 2,
};

export async function withBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  opts: BackoffOptions = {}
): Promise<T> {
  const config = { ...DEFAULTS, ...opts };
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === config.maxAttempts) break;

      let delay = Math.min(
        config.baseDelayMs * Math.pow(config.factor, attempt - 1),
        config.maxDelayMs
      );

      if (config.jitter) {
        delay = delay * (0.5 + Math.random() * 0.5);
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs = 500,
  maxDelayMs = 30_000,
  factor = 2
): number {
  return Math.min(baseDelayMs * Math.pow(factor, attempt - 1), maxDelayMs);
}
