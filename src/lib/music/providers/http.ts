// src/lib/music/providers/http.ts
// Shared fetch-with-timeout helper for music providers. Provider calls must
// never hang indefinitely — a bounded timeout surfaces provider stalls as a
// clean failure that the generation service can refund, rather than a
// serverless function that silently runs to the platform maxDuration.

/**
 * Like `fetch`, but aborts after `timeoutMs` (default 30s) and rejects with a
 * TimeoutError. The caller can catch that and map it to a provider failure.
 */
export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
