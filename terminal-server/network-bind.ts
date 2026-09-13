/**
 * Network bind-address resolution for terminal-server, its LiveKit worker's
 * health endpoint, and preview child processes (preview/PreviewManager.ts).
 *
 * Precedence (first match wins) — see LiTT network-exposure audit:
 *   1. Railway runtime   → "0.0.0.0". Detected via RAILWAY_ENVIRONMENT_ID /
 *      RAILWAY_SERVICE_ID / RAILWAY_PROJECT_ID — deliberately NOT
 *      RAILWAY_ENVIRONMENT_NAME, so preview/staging Railway environments
 *      get correct container networking too, not just "production".
 *      process.env.PORT is honored by the caller's existing PORT constant;
 *      this module only resolves the host.
 *   2. --tailscale flag  → the detected Tailscale interface IP. If none is
 *      found, throws rather than silently falling back to 0.0.0.0 or
 *      127.0.0.1 — callers must fail startup, not guess.
 *   3. --lan flag        → "0.0.0.0" (explicit, operator-requested LAN
 *      exposure).
 *   4. HOST env var      → used as-is (explicit operator override).
 *   5. Nothing supplied  → "127.0.0.1" (safe local default).
 *
 * A dev-only server must never bind 0.0.0.0 silently.
 */

import { networkInterfaces } from "node:os";

export type BindReason = "railway" | "tailscale" | "lan" | "explicit-host" | "default-local";

export interface BindResolution {
  host: string;
  reason: BindReason;
  isRailway: boolean;
}

export function isRailwayRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_SERVICE_ID || env.RAILWAY_PROJECT_ID);
}

const TAILSCALE_IFACE_PATTERN = /^tailscale/i;

/** 100.64.0.0/10 — Tailscale's documented CGNAT address range. */
function isTailscaleCgnatAddress(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

/**
 * Finds a Tailscale-attributable IPv4 address. Looks for a real
 * "tailscale*" interface (Linux/macOS Tailscale client), or a "tun0"
 * interface carrying a Tailscale CGNAT address (Android/Termux, where
 * Tailscale runs as the OS VPN app and Termux only sees its tunnel).
 */
export function findTailscaleAddress(): string | null {
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

export function parseNetworkFlags(argv: string[]): { lan: boolean; tailscale: boolean } {
  return { lan: argv.includes("--lan"), tailscale: argv.includes("--tailscale") };
}

export interface ResolveBindHostOptions {
  /** Defaults to process.argv.slice(2). Override in tests. */
  argv?: string[];
  /** Defaults to process.env. Override in tests. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to findTailscaleAddress. Override in tests. */
  findTailscaleAddress?: () => string | null;
}

/**
 * Resolves the bind host per the precedence documented above. Throws if
 * --tailscale is requested but no Tailscale address can be found — callers
 * must let this propagate and exit non-zero, never catch-and-fall-back.
 */
export function resolveBindHost(options: ResolveBindHostOptions = {}): BindResolution {
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
