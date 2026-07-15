// src/lib/provider-error.ts
// Sanitize provider/LLM errors before sending them to the client.

export interface SanitizedError {
  status: number;
  error: string;
  retryAfter?: number;
}

export function sanitizeProviderError(error: unknown): SanitizedError {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (
    lower.includes("429") ||
    lower.includes("quota") ||
    lower.includes("resource_exhausted") ||
    lower.includes("rate limit") ||
    lower.includes("rate-limit") ||
    lower.includes("too many requests")
  ) {
    const seconds = extractRetrySeconds(raw);
    return {
      status: 429,
      error: seconds
        ? `Rate limit exceeded. Retry in ${seconds}s.`
        : "Rate limit exceeded. Please try again shortly.",
      retryAfter: seconds,
    };
  }

  return { status: 500, error: "Internal server error" };
}

function extractRetrySeconds(raw: string): number | undefined {
  const match = raw.match(
    /(?:retry\s*in|retry\s*delay|retryafter)[\s:]*([\d.]+)\s*s/i,
  );
  if (match) return Math.round(parseFloat(match[1]));
  const seconds = raw.match(/(\d+(?:\.\d+)?)\s*seconds/i);
  if (seconds) return Math.round(parseFloat(seconds[1]));
  const ms = raw.match(/(\d+(?:\.\d+)?)\s*ms/i);
  if (ms) return Math.round(parseFloat(ms[1]) / 1000);
  return undefined;
}
