/**
 * Resolve the terminal-server command bridge base URL.
 *
 * The bridge is a server-side HTTP fetch — it can only ever target an
 * http(s) endpoint. A websocket URL (ws://, wss://) is a browser transport
 * and is never a valid command base: if one is configured, that is a
 * configuration error and we fail loudly rather than attempting a request
 * that cannot succeed.
 *
 * TERMINAL_SERVER_INTERNAL_URL is the SINGLE authoritative source. There is
 * deliberately no fallback chain.
 *
 * Production incident (commit 698bea5e): the variable was unset on the web
 * service, the resolver fell through to NEXT_PUBLIC_TERMINAL_WS_URL
 * ("wss://terminal.litlabs.net"), and fetch() rejected the scheme —
 * surfacing as a generic 502 on every slash command while terminal-server
 * itself was healthy.
 *
 * Falling back to TERMINAL_SERVER_URL or NEXT_PUBLIC_TERMINAL_HTTP_URL
 * would paper over a half-configured deployment: those describe the PUBLIC
 * endpoint, while this path may legitimately be pointed at private
 * networking (http://<service>.railway.internal:8080, which is what
 * production uses). Silently substituting one for the other hides which
 * transport is actually in use, so an absent or unusable value fails closed
 * instead. .env.example ships the variable for local development.
 */

export class TerminalCommandConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalCommandConfigError";
  }
}

/** The one variable that carries the internal command endpoint. */
const INTERNAL_URL_VAR = "TERMINAL_SERVER_INTERNAL_URL";

/** Schemes fetch() can actually issue a request on. */
const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * NEXT_PUBLIC_TERMINAL_WS_URL is deliberately NOT a candidate: it is the
 * browser's websocket URL and must never be reinterpreted as an HTTP
 * command endpoint. Neither are TERMINAL_SERVER_URL nor
 * NEXT_PUBLIC_TERMINAL_HTTP_URL — see the module comment.
 */
export function resolveTerminalCommandBase(
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env[INTERNAL_URL_VAR]?.trim();

  if (!value) {
    throw new TerminalCommandConfigError(
      `Terminal command bridge is not configured — set ${INTERNAL_URL_VAR} ` +
        "to the terminal-server http(s) URL (for example " +
        "https://terminal.example.net, or a private " +
        "http://<service>.railway.internal:<port> address).",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // The configured value is not echoed — it may carry credentials in its
    // userinfo, and a malformed value can carry them in an opaque path.
    throw new TerminalCommandConfigError(
      `${INTERNAL_URL_VAR} is not a valid absolute URL. Expected an http:// ` +
        "or https:// origin.",
    );
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    // Only the scheme is reported, for the same reason.
    throw new TerminalCommandConfigError(
      `${INTERNAL_URL_VAR} must be an http(s) URL — got "${parsed.protocol}//". ` +
        "A websocket URL cannot be used for server-side HTTP requests.",
    );
  }

  // Trailing slashes would produce "//internal/command" when joined.
  return value.replace(/\/+$/, "");
}
