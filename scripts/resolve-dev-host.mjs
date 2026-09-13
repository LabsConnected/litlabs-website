/**
 * Network bind-address resolution for the root Next.js `dev` script.
 *
 * Self-contained (not shared with terminal-server/network-bind.ts or
 * voice-server/network-bind.mjs) — same rationale as voice-server: this is
 * a small, stable, security-critical ~60 lines and each of the three
 * services/scripts that need it has its own build/runtime boundary.
 *
 * Precedence (first match wins):
 *   1. Railway runtime   -> "0.0.0.0". Detected via RAILWAY_ENVIRONMENT_ID /
 *      RAILWAY_SERVICE_ID / RAILWAY_PROJECT_ID — never RAILWAY_ENVIRONMENT_NAME.
 *      In practice `next dev` is never what Railway runs for this app (the
 *      root Dockerfile runs the built `.next/standalone/server.js`), but
 *      this keeps the policy identical everywhere on principle.
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

/** Recognized network flags — stripped from argv before forwarding to `next`. */
export const NETWORK_FLAGS = ["--lan", "--tailscale"];

export function parseNetworkFlags(argv) {
  return { lan: argv.includes("--lan"), tailscale: argv.includes("--tailscale") };
}

/** argv with --lan/--tailscale removed, safe to forward to `next dev`. */
export function stripNetworkFlags(argv) {
  return argv.filter((a) => !NETWORK_FLAGS.includes(a));
}

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
        "[resolve-dev-host] --tailscale was requested but no Tailscale interface/IP " +
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
