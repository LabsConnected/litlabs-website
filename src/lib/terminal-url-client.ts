/**
 * Browser-safe terminal-server URL helpers (no "server-only").
 *
 * Single home for the legacy production terminal host so client components
 * and src/lib/terminal-url.ts do not each carry their own copy.
 *
 * NEXT_PUBLIC_* variables are inlined by Next.js only when referenced as
 * `process.env.NEXT_PUBLIC_X` literally, so callers pass the values in.
 */

/**
 * Legacy production terminal-server host. Must match the Railway service
 * deploy-terminal.yml deploys to (litlabs-terminal-server). Kept only as the
 * last-resort fallback for production builds; non-production builds never
 * fall back to it, so local dev cannot reach the production terminal.
 */
export const LEGACY_PROD_TERMINAL_URL =
  "https://litlabs-terminal-server-production-0be1.up.railway.app";

export const LOCAL_TERMINAL_URL = "http://localhost:4001";

/**
 * Resolve the terminal-server base URL for client components.
 *
 * - Explicit non-localhost URL (HTTP, else WS rewritten to HTTP) wins.
 * - Production builds fall back to the legacy production host (unchanged).
 * - Other builds use the configured value if any, else the local terminal
 *   server, never the production host.
 */
export function resolveClientTerminalUrl(
  httpUrl: string | undefined,
  wsUrl: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  const raw = httpUrl
    ? httpUrl.replace(/\/$/, "")
    : wsUrl?.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "") || "";
  if (raw && !raw.includes("localhost")) return raw;
  if (nodeEnv === "production") return LEGACY_PROD_TERMINAL_URL;
  return raw || LOCAL_TERMINAL_URL;
}
