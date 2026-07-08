import { Supermemory } from "supermemory";

/**
 * Build a Supermemory client from the configured API key.
 * Throws when `SUPERMEMORY_API_KEY` is missing so callers surface a 500.
 */
export function getSupermemory(): Supermemory {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) {
    throw new Error("SUPERMEMORY_API_KEY is not configured");
  }
  return new Supermemory({ apiKey: key });
}
