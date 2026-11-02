/**
 * Shared SSRF guard — single source of truth for "is this destination safe
 * to connect to" across every feature that fetches a caller-influenced URL
 * (agent web_fetch, headless-browser capture, preview, etc.).
 *
 * Blocks private, loopback, link-local, CGNAT, benchmarking, documentation,
 * multicast, and unspecified IPv4 ranges; loopback, link-local, unique-local,
 * site-local, multicast, documentation, and IPv4-embedding transition forms
 * (IPv4-mapped ::ffff:a.b.c.d, IPv4-compatible ::a.b.c.d, NAT64, 6to4,
 * Teredo) for IPv6. Also rejects hostnames that RESOLVE to any blocked
 * address, and fails closed whenever a target cannot be classified.
 */

import "server-only";

import net from "node:net";
import dns from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, buildConnector, type Dispatcher } from "undici";

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

/** [networkInt, prefixLength] for blocked IPv4 ranges. */
const BLOCKED_IPV4_RANGES: Array<[number, number]> = (
  [
    ["0.0.0.0", 8], // "this network" / unspecified
    ["10.0.0.0", 8], // private
    ["100.64.0.0", 10], // carrier-grade NAT
    ["127.0.0.0", 8], // loopback
    ["169.254.0.0", 16], // link-local (cloud metadata)
    ["172.16.0.0", 12], // private
    ["192.0.0.0", 24], // IETF protocol assignments
    ["192.0.2.0", 24], // TEST-NET-1
    ["192.88.99.0", 24], // 6to4 relay anycast (deprecated)
    ["192.168.0.0", 16], // private
    ["198.18.0.0", 15], // benchmarking
    ["198.51.100.0", 24], // TEST-NET-2
    ["203.0.113.0", 24], // TEST-NET-3
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // reserved
  ] as Array<[string, number]>
).map(([netAddr, prefix]) => [ipv4ToInt(netAddr), prefix]);

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_IPV4_RANGES.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (network & mask);
  });
}

/** Expand an IPv6 literal to 8 hextet numbers; null when unparseable. */
function expandIpv6(ip: string): number[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const parse = (parts: string[]): number[] | null => {
    const out: number[] = [];
    for (const part of parts) {
      if (part.includes(".")) {
        // IPv4 tail notation (mapped/compatible forms)
        const v = ipv4ToInt(part);
        out.push((v >>> 16) & 0xffff, v & 0xffff);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
        out.push(parseInt(part, 16));
      }
    }
    return out;
  };
  const headNums = parse(head);
  const tailNums = parse(tail);
  if (!headNums || !tailNums) return null;
  if (halves.length === 1) {
    return headNums.length === 8 ? headNums : null;
  }
  const missing = 8 - headNums.length - tailNums.length;
  if (missing < 0) return null;
  return [...headNums, ...new Array(missing).fill(0), ...tailNums];
}

/**
 * Whole-prefix IPv6 blocks: tunneling/transition mechanisms that embed IPv4
 * (NAT64, 6to4, Teredo) and ranges that must never carry real traffic
 * (multicast, documentation, site-local, ORCHID).
 */
const BLOCKED_IPV6_PREFIXES: Array<{ match: (g: number[]) => boolean }> = [
  { match: (g) => (g[0] & 0xffc0) === 0xfe80 }, // fe80::/10 link-local
  { match: (g) => (g[0] & 0xfe00) === 0xfc00 }, // fc00::/7 unique local
  { match: (g) => (g[0] & 0xffc0) === 0xfec0 }, // fec0::/10 site-local (deprecated)
  { match: (g) => (g[0] & 0xff00) === 0xff00 }, // ff00::/8 multicast
  { match: (g) => g[0] === 0x2002 }, // 2002::/16 6to4 (embeds IPv4)
  { match: (g) => g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 }, // 64:ff9b::/96 NAT64
  { match: (g) => g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0x0001 }, // 64:ff9b:1::/48 local NAT64
  { match: (g) => g[0] === 0x2001 && g[1] === 0x0000 }, // 2001::/32 Teredo (embeds IPv4)
  { match: (g) => g[0] === 0x2001 && g[1] === 0x0db8 }, // 2001:db8::/32 documentation
];

function isBlockedIpv6(ip: string): boolean {
  const groups = expandIpv6(ip.toLowerCase());
  if (!groups) return true; // fail closed on unparseable literal
  const isZero = groups.every((g) => g === 0);
  if (isZero) return true; // :: unspecified
  if (groups.every((g, i) => g === (i === 7 ? 1 : 0))) return true; // ::1 loopback

  // IPv4-embedding forms: mapped ::ffff:a.b.c.d and compatible ::a.b.c.d
  // both keep the IPv4 in the low 32 bits while hextet 0 stays 0 — check
  // the embedded address against the IPv4 table (this was the bypass).
  const head5Zero = groups.slice(0, 5).every((g) => g === 0);
  if (head5Zero && (groups[5] === 0xffff || groups[5] === 0)) {
    const embedded = `${groups[6] >>> 8}.${groups[6] & 0xff}.${groups[7] >>> 8}.${groups[7] & 0xff}`;
    if (isBlockedIpv4(embedded)) return true;
    // A mapped/compatible literal wrapping a PUBLIC IPv4 is equivalent to
    // that IPv4 — but these forms serve no legitimate purpose in capture or
    // fetch targets, so block them outright to keep behavior predictable.
    return true;
  }

  if (BLOCKED_IPV6_PREFIXES.some((p) => p.match(groups))) return true;
  return false;
}

/** True when the IP literal (v4 or v6) must never be connected to. */
export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // not an IP literal we can verify — fail closed
}

/**
 * Hostname-level blocks: names that conventionally resolve to internal
 * infrastructure regardless of DNS. Checked before resolution.
 */
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".internal") ||
    h.endsWith(".local") ||
    h.endsWith(".localdomain") ||
    h === "metadata.google.internal" ||
    h === "169.254.169.254" // belt-and-braces; isIP handles this anyway
  );
}

export type HostValidation =
  | { ok: true; addresses: string[] }
  | { ok: false; reason: string };

/**
 * Validate a URL host for outbound connection. IP literals are checked
 * directly; hostnames are resolved and EVERY returned address is checked.
 * Fails closed: unresolvable or unverifiable hosts are rejected.
 */
export async function validateOutboundHost(rawHost: string): Promise<HostValidation> {
  let host = rawHost.toLowerCase();
  // URL.hostname keeps IPv6 brackets — strip them for IP checks.
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) return { ok: false, reason: "empty host" };
  if (isBlockedHostname(host)) return { ok: false, reason: `blocked hostname: ${host}` };
  if (net.isIP(host)) {
    return isBlockedIp(host)
      ? { ok: false, reason: `blocked address: ${host}` }
      : { ok: true, addresses: [host] };
  }
  let addresses: string[];
  try {
    addresses = (await dnsLookup(host, { all: true })).map((a) => a.address);
  } catch {
    return { ok: false, reason: `host could not be resolved: ${host}` };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: `host resolved to no addresses: ${host}` };
  }
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      return { ok: false, reason: `host resolves to a blocked address: ${host} -> ${address}` };
    }
  }
  return { ok: true, addresses };
}

/**
 * DNS lookup that validates every resolved address. Used as the `lookup`
 * callback of an undici connector, so the addresses a socket will actually
 * connect to are guaranteed to have passed isBlockedIp — there is no
 * check-then-connect window for DNS rebinding to exploit. Fail closed.
 */
function validatingLookup(
  hostname: string,
  options: { family?: number; hints?: number; all?: boolean },
  callback: (err: Error | null, address?: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(
    hostname,
    { all: true, family: options.family ?? 0, hints: options.hints },
    (err, addresses) => {
      if (err) return callback(err);
      if (!addresses.length) {
        return callback(new Error(`DNS returned no addresses for ${hostname}`));
      }
      for (const a of addresses) {
        if (isBlockedIp(a.address)) {
          return callback(
            new Error(`Blocked destination: ${hostname} resolves to ${a.address}`),
          );
        }
      }
      if (options.all) return callback(null, addresses);
      const first = addresses[0];
      return callback(null, first.address, first.family);
    },
  );
}

/**
 * A Dispatcher whose every connection target is validated at connect time.
 * Pass to fetch() as `{ dispatcher }`.
 *
 * Two layers, because undici bypasses `lookup` for literal-IP hosts:
 *  1. The wrapper `connect` rejects literal blocked IPs before any socket.
 *  2. For hostnames, the inner connector's `lookup` resolves and returns
 *     only validated addresses — the socket can only ever dial an address
 *     that passed isBlockedIp, with no check-then-connect window for DNS
 *     rebinding to exploit. Fail closed.
 */
export function createSsrfDispatcher(): Dispatcher {
  const innerConnect = buildConnector({
    lookup: validatingLookup as never,
    timeout: 20_000,
  });
  return new Agent({
    connect: (opts, callback) => {
      const host = (typeof opts.hostname === "string" ? opts.hostname : "").replace(/^\[|\]$/g, "");
      if (!host) {
        callback(new Error("No hostname in connection target"), null);
        return;
      }
      if (isBlockedHostname(host) || (net.isIP(host) && isBlockedIp(host))) {
        callback(new Error(`Blocked destination: ${host}`), null);
        return;
      }
      innerConnect(opts, callback);
    },
  });
}
