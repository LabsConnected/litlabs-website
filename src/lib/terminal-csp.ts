/**
 * Development-only CSP `connect-src` entries for the local terminal server.
 *
 * The browser dials the terminal WebSocket on a LOOPBACK host — either the
 * configured URL's host verbatim, or the page's own hostname after
 * resolveTerminalBrowserBaseUrl() substitutes a loopback configured value
 * with the request host (localhost tunnel, 127.0.0.1, ::1). The stable,
 * config-derived part of that dial target is the PORT, which can be any
 * value the deployment picked (4001, 4011, ...) — hardcoding 4001 broke
 * the socket whenever the terminal server ran elsewhere.
 *
 * This emits ws:// + http:// entries for every loopback host × every
 * configured loopback terminal port, plus the historical default 4001.
 * Nothing here widens production CSP — callers must only splice these in
 * when NODE_ENV === "development".
 */

/** Env vars that can carry a terminal-server URL, most specific first.
 *  LITT_TERMINAL_URL is included because existing dev environments already
 *  set it even though the runtime resolver doesn't read it. */
export const TERMINAL_URL_ENV_VARS = [
  "TERMINAL_PUBLIC_URL",
  "NEXT_PUBLIC_TERMINAL_WS_URL",
  "NEXT_PUBLIC_TERMINAL_HTTP_URL",
  "LITT_TERMINAL_URL",
] as const;

/** Ports emitted even when nothing is configured — the historical default. */
const DEFAULT_TERMINAL_PORTS = ["4001"];

/** Loopback hostnames the browser can dial after host substitution.
 *  Bracketed IPv6 (`ws://[::1]:port`) is NOT a valid CSP source — Chrome
 *  drops it with a console error — and `localhost` already covers ::1
 *  resolution, so only these two are emitted. */
const LOOPBACK_DIAL_HOSTS = ["localhost", "127.0.0.1"] as const;

const LOOPBACK_URL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type EnvLike = Readonly<Record<string, string | undefined>>;

/**
 * connect-src entries for the dev terminal server.
 *
 * Only loopback URLs contribute ports: a non-loopback configured terminal
 * (e.g. the production wss:// endpoint) is never dialed by a dev page —
 * resolveClientTerminalUrl returns it untouched and prod CSP covers its
 * own origins separately.
 */
export function devTerminalConnectSrcEntries(env: EnvLike = process.env): string[] {
  const ports = new Set<string>(DEFAULT_TERMINAL_PORTS);
  for (const key of TERMINAL_URL_ENV_VARS) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    try {
      const url = new URL(
        raw.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:"),
      );
      if (!LOOPBACK_URL_HOSTS.has(url.hostname.toLowerCase())) continue;
      ports.add(url.port || (url.protocol === "https:" ? "443" : "80"));
    } catch {
      // Malformed env value — ignore it rather than break the header.
    }
  }

  const entries: string[] = [];
  for (const port of ports) {
    for (const host of LOOPBACK_DIAL_HOSTS) {
      entries.push(`ws://${host}:${port}`, `http://${host}:${port}`);
    }
  }
  return entries;
}
