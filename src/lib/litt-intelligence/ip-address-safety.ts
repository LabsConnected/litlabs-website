/**
 * Non-public IP address classification — the single source of truth
 * for "may the Studio browser proxy connect to this literal or
 * DNS-resolved address".
 *
 * Used in two places:
 *   - browser-url-policy.ts, for literal IP hosts in the URL
 *     (http://127.0.0.1/, http://[::1]/);
 *   - proxy-destination.ts, which resolves every proxied hostname and
 *     validates EVERY returned address before pinning the connection
 *     to it (DNS-rebinding / TOCTOU defense).
 *
 * "Public" here means globally routable unicast. Everything else —
 * private, loopback, link-local, CGNAT, ULA, multicast, reserved,
 * documentation, benchmarking, and IPv6 transition mechanisms that
 * embed an IPv4 — is blocked. When in doubt the answer is "not
 * public": callers fail closed.
 */

/** Cloud metadata endpoints that deserve a specific reason string. */
const METADATA_IPS = new Set([
  "169.254.169.254", // AWS / GCP / Azure
  "100.100.100.200", // Alibaba Cloud
  "192.0.0.192", // Oracle Cloud
]);

// ─── IPv4 ────────────────────────────────────────────────────────

function parseIPv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Dotted-quad → 32-bit unsigned int, or null when not IPv4. */
function ipv4ToInt(address: string): number | null {
  const octets = parseIPv4Octets(address);
  if (!octets) return null;
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function ipv4FromInt(value: number): string {
  return [24, 16, 8, 0].map((s) => (value >>> s) & 0xff).join(".");
}

/**
 * Non-public IPv4 ranges as [network-int, prefix-length, reason].
 * Covers RFC 1918 private, loopback, link-local, CGNAT, benchmarking,
 * documentation (TEST-NET-1/2/3), protocol-assignment and anycast,
 * multicast and reserved/broadcast space.
 */
const IPV4_NON_PUBLIC: [number, number, string][] = [
  [ipv4ToInt("0.0.0.0")!, 8, "unspecified address (0.0.0.0)"],
  [ipv4ToInt("10.0.0.0")!, 8, "private address (RFC 1918)"],
  [ipv4ToInt("100.64.0.0")!, 10, "CGNAT shared address space"],
  [ipv4ToInt("127.0.0.0")!, 8, "loopback address"],
  [ipv4ToInt("169.254.0.0")!, 16, "link-local address"],
  [ipv4ToInt("172.16.0.0")!, 12, "private address (RFC 1918)"],
  [ipv4ToInt("192.0.0.0")!, 24, "IETF protocol-assignment address"],
  [ipv4ToInt("192.0.2.0")!, 24, "documentation address (TEST-NET-1)"],
  [ipv4ToInt("192.31.196.0")!, 24, "anycast address (AS112)"],
  [ipv4ToInt("192.52.193.0")!, 24, "anycast address (AMT)"],
  [ipv4ToInt("192.88.99.0")!, 24, "6to4 relay anycast address"],
  [ipv4ToInt("192.168.0.0")!, 16, "private address (RFC 1918)"],
  [ipv4ToInt("192.175.48.0")!, 24, "anycast address (AS112)"],
  [ipv4ToInt("198.18.0.0")!, 15, "benchmarking address"],
  [ipv4ToInt("198.51.100.0")!, 24, "documentation address (TEST-NET-2)"],
  [ipv4ToInt("203.0.113.0")!, 24, "documentation address (TEST-NET-3)"],
  [ipv4ToInt("224.0.0.0")!, 4, "multicast address"],
  [ipv4ToInt("240.0.0.0")!, 4, "reserved address"],
];

function ipv4BlockReason(address: string): string | null {
  if (METADATA_IPS.has(address)) return "cloud metadata endpoint";
  const value = ipv4ToInt(address);
  if (value === null) return null;
  for (const [net, bits, reason] of IPV4_NON_PUBLIC) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((value & mask) === (net & mask)) return reason;
  }
  return null;
}

// ─── IPv6 ────────────────────────────────────────────────────────

/** Parse an IPv6 literal (with optional "::" compression and an
 *  embedded dotted-quad tail) into 8 hextets, or null. */
export function parseIPv6(address: string): number[] | null {
  let s = address.trim().toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(":")) return null;

  // Embedded IPv4 tail ("::ffff:1.2.3.4") → two hextets.
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = parseIPv4Octets(s.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const groups = side.split(":");
    const out: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = parseSide(halves[0]);
  const tail = halves.length === 2 ? parseSide(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/** Does the hextet array fall inside `prefix` of `bits` length? */
function v6PrefixMatch(h: number[], prefix: number[], bits: number): boolean {
  let remaining = bits;
  let i = 0;
  while (remaining > 0) {
    const take = Math.min(16, remaining);
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if ((h[i] & mask) !== (prefix[i] & mask)) return false;
    remaining -= take;
    i++;
  }
  return true;
}

const v6h = (...groups: number[]) => groups;

/** [hextets, prefix-bits, reason] for non-public IPv6 ranges. */
const IPV6_NON_PUBLIC: [number[], number, string][] = [
  [v6h(0, 0, 0, 0, 0, 0, 0, 0), 128, "unspecified address (::)"],
  [v6h(0, 0, 0, 0, 0, 0, 0, 1), 128, "loopback address (::1)"],
  [v6h(0x64, 0xff9b, 1, 0, 0, 0, 0, 0), 48, "NAT64 local-use address (64:ff9b:1::/48)"],
  [v6h(0x100, 0, 0, 0, 0, 0, 0, 0), 64, "discard-only address (100::/64)"],
  [v6h(0x2001, 0, 0, 0, 0, 0, 0, 0), 32, "Teredo transition address (2001::/32)"],
  [v6h(0x2001, 0x0002, 0, 0, 0, 0, 0, 0), 48, "benchmarking address (2001:2::/48)"],
  [v6h(0x2001, 0x0db8, 0, 0, 0, 0, 0, 0), 32, "documentation address (2001:db8::/32)"],
  [v6h(0x2001, 0x0010, 0, 0, 0, 0, 0, 0), 28, "ORCHID address (2001:10::/28)"],
  [v6h(0x2001, 0x0020, 0, 0, 0, 0, 0, 0), 28, "ORCHIDv2 address (2001:20::/28)"],
  [v6h(0x2002, 0, 0, 0, 0, 0, 0, 0), 16, "6to4 transition address (2002::/16)"],
  [v6h(0x3fff, 0, 0, 0, 0, 0, 0, 0), 20, "documentation address (3fff::/20)"],
  [v6h(0x5f00, 0, 0, 0, 0, 0, 0, 0), 16, "segment-routing address (5f00::/16)"],
  [v6h(0xfc00, 0, 0, 0, 0, 0, 0, 0), 7, "ULA private address (fc00::/7)"],
  [v6h(0xfe80, 0, 0, 0, 0, 0, 0, 0), 10, "link-local address (fe80::/10)"],
  [v6h(0xff00, 0, 0, 0, 0, 0, 0, 0), 8, "multicast address (ff00::/8)"],
];

const V6_UNSPECIFIED = v6h(0, 0, 0, 0, 0, 0, 0, 0);
const V6_LOOPBACK = v6h(0, 0, 0, 0, 0, 0, 0, 1);
const V6_MAPPED_PREFIX = v6h(0, 0, 0, 0, 0, 0xffff, 0, 0);
const V6_NAT64_PREFIX = v6h(0x64, 0xff9b, 0, 0, 0, 0, 0, 0);
const V6_COMPAT_PREFIX = v6h(0, 0, 0, 0, 0, 0, 0, 0);

function ipv6BlockReason(address: string): string | null {
  const hextets = parseIPv6(address);
  if (!hextets) return null;

  // Exact unspecified/loopback first — they also fall inside ::/96.
  if (v6PrefixMatch(hextets, V6_UNSPECIFIED, 128)) return "unspecified address (::)";
  if (v6PrefixMatch(hextets, V6_LOOPBACK, 128)) return "loopback address (::1)";

  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 well-known prefix
  // (64:ff9b::/96): the last 32 bits ARE an IPv4 address — validate it
  // recursively so ::ffff:127.0.0.1 and 64:ff9b::a9fe:a9fe cannot
  // smuggle a blocked IPv4 past the v6 checks. A public embedded
  // IPv4 means the destination is public.
  const isMapped = v6PrefixMatch(hextets, V6_MAPPED_PREFIX, 96);
  const isNat64 = v6PrefixMatch(hextets, V6_NAT64_PREFIX, 96);
  if (isMapped || isNat64) {
    const v4 = ipv4FromInt(((hextets[6] << 16) | hextets[7]) >>> 0);
    const inner = ipv4BlockReason(v4);
    if (!inner) return null;
    const kind = isMapped ? "IPv4-mapped IPv6" : "NAT64";
    return `${kind} address → ${inner}`;
  }

  // IPv4-compatible ::a.b.c.d (deprecated ::/96) — block outright.
  if (v6PrefixMatch(hextets, V6_COMPAT_PREFIX, 96)) {
    return "IPv4-compatible IPv6 address (::/96)";
  }

  for (const [prefix, bits, reason] of IPV6_NON_PUBLIC) {
    if (v6PrefixMatch(hextets, prefix, bits)) return reason;
  }
  return null;
}

/**
 * Classify an IP literal (v4 or v6, brackets optional). Returns a
 * human-readable block reason, or null when the address is public
 * unicast. Non-IP input returns null — callers must only pass
 * addresses they know are IPs.
 */
export function ipBlockReason(address: string): string | null {
  const a = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!a) return null;
  if (a.includes(":")) return ipv6BlockReason(a);
  if (ipv4ToInt(a) !== null) return ipv4BlockReason(a);
  return null;
}
