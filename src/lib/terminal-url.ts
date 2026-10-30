import "server-only";

import { LOCAL_TERMINAL_URL } from "./terminal-url-client";

/**
 * Centralized terminal-server and voice-server URL resolution.
 *
 * Each function checks environment variables in priority order. There is NO
 * implicit production fallback: when nothing is configured the result is ""
 * (unconfigured) in production, and http://localhost:4001 in development.
 * Server callers that need a usable URL should use requireTerminalBaseUrl()
 * from ./terminal-config, which fails closed with an explicit 503-style error.
 *
 * Client-side components cannot import this module (it uses "server-only");
 * they use resolveClientTerminalUrl() from ./terminal-url-client.
 */

/**
 * Resolve the terminal-server base URL.
 *
 * Resolution order:
 *   1. TERMINAL_PUBLIC_URL            — canonical env var (preferred)
 *   2. NEXT_PUBLIC_TERMINAL_WS_URL    — browser-side WebSocket URL (ws:// → http://)
 *   3. NEXT_PUBLIC_TERMINAL_HTTP_URL  — browser-side HTTP fallback
 *   4. Development only: http://localhost:4001 (production returns "")
 */
export function getTerminalServerUrl(): string {
  // 1. Canonical env var (server-side, preferred)
  if (process.env.TERMINAL_PUBLIC_URL) {
    return process.env.TERMINAL_PUBLIC_URL.replace(/\/$/, "");
  }

  // 2. Browser-side WebSocket URL — strip ws(s):// → http(s)://
  if (process.env.NEXT_PUBLIC_TERMINAL_WS_URL) {
    return process.env.NEXT_PUBLIC_TERMINAL_WS_URL
      .replace(/^wss:/, "https:")
      .replace(/^ws:/, "http:")
      .replace(/\/$/, "");
  }

  // 3. Browser-side HTTP fallback
  if (process.env.NEXT_PUBLIC_TERMINAL_HTTP_URL) {
    return process.env.NEXT_PUBLIC_TERMINAL_HTTP_URL.replace(/\/$/, "");
  }

  // 4. No implicit production fallback. Localhost is development-only.
  return process.env.NODE_ENV === "production" ? "" : LOCAL_TERMINAL_URL;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * Resolve the terminal WebSocket base URL a BROWSER should dial.
 *
 * Local dev configures a loopback URL (http://127.0.0.1:4001) because the
 * terminal server binds loopback by default — but "127.0.0.1" resolves on
 * the CLIENT's device, not the dev server. When the page itself was served
 * over a loopback-equivalent tunnel (localhost:3001 → remote 3001) or a
 * remote dev host, the loopback literal is wrong for every non-colocated
 * client. Substituting the request's own hostname makes the WS target
 * follow the page origin: localhost-served pages dial localhost:4001
 * (reachable through the authenticated SSH tunnel's port forward), and
 * remote dev origins dial that host's terminal port — which only works
 * when the terminal server was launched with --lan/--tailscale. Either
 * way the socket handshake still carries the signed terminal token, so
 * substituting the host never weakens auth.
 *
 * Non-loopback configured URLs (production public endpoints) are returned
 * untouched. A configured URL that can't be parsed is returned as-is.
 */
export function resolveTerminalBrowserBaseUrl(configured: string, requestHostname: string): string {
  if (!configured) return configured;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return configured;
  }
  if (!isLoopbackHost(url.hostname)) return configured;
  const host = (requestHostname ?? "").trim().toLowerCase();
  if (!host) return configured;
  url.hostname = host;
  return url.toString().replace(/\/$/, "");
}

export type TerminalInternalUrlSource = "internal" | "public-fallback" | "none";

export interface TerminalInternalUrlResolution {
  url: string;
  source: TerminalInternalUrlSource;
}

/**
 * Resolve server-to-server terminal traffic.
 *
 * This is intentionally separate from getTerminalServerUrl(), which serves
 * browser/iframe-facing URLs and may use public client configuration. Internal
 * calls must prefer the Railway private URL whenever both values exist.
 * There is no hardcoded production hostname here.
 */
export function resolveTerminalInternalUrl(
  env: NodeJS.ProcessEnv = process.env,
): TerminalInternalUrlResolution {
  const internal = env.TERMINAL_SERVER_INTERNAL_URL?.trim();
  if (internal) return { url: internal.replace(/\/+$/, ""), source: "internal" };

  const publicFallback = env.TERMINAL_SERVER_URL?.trim();
  if (publicFallback) return { url: publicFallback.replace(/\/+$/, ""), source: "public-fallback" };

  if (env.NODE_ENV !== "production") {
    return { url: "http://localhost:4001", source: "public-fallback" };
  }

  return { url: "", source: "none" };
}

/** Sanitized source-only diagnostic; never returns a URL or credential. */
export function getTerminalInternalUrlSource(): TerminalInternalUrlSource {
  return resolveTerminalInternalUrl().source;
}

/**
 * Resolve the voice-server base URL, or "" if it isn't configured.
 *
 * Deliberately has NO hardcoded fallback: the voice-proxy that was
 * previously guessed here (voice-proxy-production-3f9c.up.railway.app) lives
 * in a separate Railway project from the website and cannot be assumed to
 * share VOICE_AUTH_SECRET — connecting to it produces a WebSocket close code
 * 4001 that looks like an auth failure. Callers must treat "" as "voice is
 * not configured", not synthesize a guessed URL.
 *
 * Resolution order:
 *   1. VOICE_PUBLIC_URL              — canonical env var (preferred)
 *   2. NEXT_PUBLIC_VOICE_WS_URL      — browser-side WebSocket URL (ws:// → http://)
 */
export function getVoiceServerUrl(): string {
  // 1. Canonical env var
  if (process.env.VOICE_PUBLIC_URL) {
    return process.env.VOICE_PUBLIC_URL.replace(/\/$/, "");
  }

  // 2. Browser-side WebSocket URL — strip ws(s):// → http(s)://
  if (process.env.NEXT_PUBLIC_VOICE_WS_URL) {
    return process.env.NEXT_PUBLIC_VOICE_WS_URL
      .replace(/^wss:/, "https:")
      .replace(/^ws:/, "http:")
      .replace(/\/$/, "");
  }

  return "";
}
