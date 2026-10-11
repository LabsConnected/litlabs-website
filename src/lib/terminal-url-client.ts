/**
 * Browser-safe terminal-server URL helpers (no "server-only").
 *
 * There is deliberately NO implicit production fallback: a deployment that
 * does not explicitly configure a terminal URL gets an unconfigured state
 * (empty string), never a guessed production host. Localhost is a
 * development-only default.
 *
 * NEXT_PUBLIC_* variables are inlined by Next.js only when referenced as
 * `process.env.NEXT_PUBLIC_X` literally, so callers pass the values in.
 */

export const LOCAL_TERMINAL_URL = "http://localhost:4001";

/**
 * Resolve the terminal-server base URL for client components.
 *
 * - Production builds: the explicit HTTP URL (else WS rewritten to HTTP), or
 *   "" when unset or pointing at localhost (unconfigured — fail closed).
 * - Other builds: the configured value, else the local terminal server.
 */
export function resolveClientTerminalUrl(
  httpUrl: string | undefined,
  wsUrl: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  const raw = httpUrl
    ? httpUrl.replace(/\/$/, "")
    : wsUrl?.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "") || "";
  if (nodeEnv === "production") {
    return raw && !raw.includes("localhost") ? raw : "";
  }
  return raw || LOCAL_TERMINAL_URL;
}
