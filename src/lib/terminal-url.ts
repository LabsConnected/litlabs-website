import "server-only";

/**
 * Centralized terminal-server and voice-server URL resolution.
 *
 * This module replaces the scattered hardcoded Railway production URLs that
 * were duplicated across dozens of files (API routes, lib helpers, etc.).
 * Each function checks environment variables in priority order and falls
 * back to the legacy hardcoded production URL only as a last resort.
 *
 * Client-side components cannot import this module (it uses "server-only")
 * and should instead reference NEXT_PUBLIC_* env vars directly with the same
 * hardcoded fallback.
 */

/**
 * Resolve the terminal-server base URL.
 *
 * Resolution order:
 *   1. TERMINAL_PUBLIC_URL            — canonical env var (preferred)
 *   2. NEXT_PUBLIC_TERMINAL_WS_URL    — browser-side WebSocket URL (ws:// → http://)
 *   3. NEXT_PUBLIC_TERMINAL_HTTP_URL  — browser-side HTTP fallback
 *   4. Legacy hardcoded production URL
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

  // 4. Legacy hardcoded production URL — must match the Railway service
  // deploy-terminal.yml actually deploys to (litlabs-terminal-server).
  return "https://litlabs-terminal-server-production-0be1.up.railway.app";
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
