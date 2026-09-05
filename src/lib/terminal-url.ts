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
 * Resolve the voice-server base URL.
 *
 * Resolution order:
 *   1. VOICE_PUBLIC_URL              — canonical env var (preferred)
 *   2. NEXT_PUBLIC_VOICE_WS_URL      — browser-side WebSocket URL (ws:// → http://)
 *   3. Legacy hardcoded production URL
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

  // 3. Legacy hardcoded production URL
  return "https://voice-proxy-production-3f9c.up.railway.app";
}
