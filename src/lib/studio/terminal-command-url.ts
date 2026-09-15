/**
 * Resolve the terminal-server command bridge base URL.
 *
 * The bridge is a server-side HTTP fetch — it can only ever target an
 * http(s) endpoint. A websocket URL (ws://, wss://) is a browser transport
 * and is never a valid command base: if one is configured, that is a
 * configuration error and we fail loudly rather than attempting a request
 * that cannot succeed.
 */

export class TerminalCommandConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalCommandConfigError";
  }
}

/** Server-side env vars that may carry the internal command endpoint. */
const HTTP_CANDIDATES = [
  "TERMINAL_SERVER_INTERNAL_URL",
  "TERMINAL_SERVER_URL",
  "NEXT_PUBLIC_TERMINAL_HTTP_URL",
] as const;

/**
 * NEXT_PUBLIC_TERMINAL_WS_URL is deliberately NOT a candidate: it is the
 * browser's websocket URL and must never be reinterpreted as an HTTP
 * command endpoint.
 */
export function resolveTerminalCommandBase(
  env: Record<string, string | undefined> = process.env,
): string {
  for (const key of HTTP_CANDIDATES) {
    const value = env[key]?.trim();
    if (!value) continue;
    if (!/^https?:\/\//i.test(value)) {
      throw new TerminalCommandConfigError(
        `${key} must be an http(s) URL — got "${value.split("://")[0]}://"`,
      );
    }
    return value.replace(/\/+$/, "");
  }

  if (env.NODE_ENV === "production") {
    throw new TerminalCommandConfigError(
      "Terminal command bridge is not configured — set TERMINAL_SERVER_INTERNAL_URL to the terminal-server http(s) URL",
    );
  }

  // Local development: the terminal server runs alongside the dev server.
  return "http://127.0.0.1:4001";
}
