/**
 * Network bind-address resolution for the voice-proxy server.
 *
 * Deliberately self-contained (not shared with terminal-server/network-bind.ts)
 * because voice-server is its own standalone Railway service with its own
 * Dockerfile whose build context is just this directory (see ./Dockerfile —
 * `COPY server.mjs ./` copies nothing outside voice-server/). Keeping the
 * logic duplicated in ~60 lines here avoids a cross-service build dependency
 * for a small, stable, security-critical piece of code.
 *
 * Precedence (first match wins) — mirrors terminal-server/network-bind.ts:
 *   1. Railway runtime   -> "0.0.0.0". Detected via RAILWAY_ENVIRONMENT_ID /
 *      RAILWAY_SERVICE_ID / RAILWAY_PROJECT_ID — never RAILWAY_ENVIRONMENT_NAME,
 *      so preview/staging Railway environments get correct networking too.
 *   2. --tailscale flag  -> the detected Tailscale interface IP. Throws if
 *      none is found — never silently falls back to 0.0.0.0 or 127.0.0.1.
 *   3. --lan flag        -> "0.0.0.0" (explicit, operator-requested).
 *   4. HOST env var      -> used as-is (explicit operator override).
 *   5. Nothing supplied  -> "127.0.0.1" (safe local default).
 */

import { networkInterfaces } from "node:os";

const TAILSCALE_IFACE_PATTERN = /^tailscale/i;

/** 100.64.0.0/10 — Tailscale's documented CGNAT address range. */
function isTailscaleCgnatAddress(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

export function isRailwayRuntime(env = process.env) {
  return Boolean(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_SERVICE_ID || env.RAILWAY_PROJECT_ID);
}

/**
 * Finds a Tailscale-attributable IPv4 address: a real "tailscale*"
 * interface, or a "tun0" interface carrying a Tailscale CGNAT address
 * (Android/Termux, where Tailscale runs as the OS VPN app).
 */
export function findTailscaleAddress() {
  const ifaces = networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const looksLikeTailscale = TAILSCALE_IFACE_PATTERN.test(name) || name === "tun0";
      if (looksLikeTailscale && isTailscaleCgnatAddress(addr.address)) {
        return addr.address;
      }
    }
  }
  return null;
}

export function parseNetworkFlags(argv) {
  return { lan: argv.includes("--lan"), tailscale: argv.includes("--tailscale") };
}

/**
 * Resolves the bind host. Throws if --tailscale is requested but no
 * Tailscale address can be found — callers must let this propagate and
 * exit non-zero, never catch-and-fall-back to a wider bind.
 */
export function resolveBindHost(options = {}) {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(2);
  const detectTailscale = options.findTailscaleAddress ?? findTailscaleAddress;
  const { lan, tailscale } = parseNetworkFlags(argv);

  if (isRailwayRuntime(env)) {
    return { host: "0.0.0.0", reason: "railway", isRailway: true };
  }

  if (tailscale) {
    const addr = detectTailscale();
    if (!addr) {
      throw new Error(
        "[network-bind] --tailscale was requested but no Tailscale interface/IP " +
          "was found (looked for a tailscale* interface, or tun0 carrying a " +
          "100.64.0.0/10 address). Refusing to start rather than silently bind " +
          "0.0.0.0 or fall back to 127.0.0.1. Connect Tailscale and retry, or " +
          "drop --tailscale to run localhost-only.",
      );
    }
    return { host: addr, reason: "tailscale", isRailway: false };
  }

  if (lan) {
    return { host: "0.0.0.0", reason: "lan", isRailway: false };
  }

  if (env.HOST && env.HOST.trim()) {
    return { host: env.HOST.trim(), reason: "explicit-host", isRailway: false };
  }

  return { host: "127.0.0.1", reason: "default-local", isRailway: false };
}
