/**
 * Client-safe logger abstraction.
 *
 * Production browser console should normally contain only:
 *   - real errors
 *   - actionable warnings
 *
 * Debug/info chatter (successful init, dedupe success, state messages,
 * payload dumps) is suppressed in production.
 *
 * NEVER log secrets through any of these methods:
 *   API keys, authorization headers, ephemeral tokens, Clerk tokens,
 *   Supabase credentials, Vapi secrets, OpenRouter keys.
 *
 * Usage:
 *   import { logger } from "@/lib/client-logger";
 *   logger.debug("…");   // dev only
 *   logger.info("…");    // dev only
 *   logger.warn("…");    // always
 *   logger.error("…");   // always
 */

const isDev = process.env.NODE_ENV !== "production";

export const logger = {
  /** Dev-only debug logging. Suppressed in production. */
  debug(...args: unknown[]): void {
    if (isDev) console.debug(...args);
  },
  /** Dev-only info logging. Suppressed in production. */
  info(...args: unknown[]): void {
    if (isDev) console.info(...args);
  },
  /** Always shown. Use for actionable warnings. */
  warn(...args: unknown[]): void {
    console.warn(...args);
  },
  /** Always shown. Use for real errors. */
  error(...args: unknown[]): void {
    console.error(...args);
  },
  /** Expose the dev flag for callers that branch on it. */
  get isDev(): boolean {
    return isDev;
  },
};
