/**
 * Canonical network policy contracts.
 *
 * Explicit egress controls for execution capsules.
 * Default-deny capable. Must support offline/no-network execution.
 *
 * Protects against:
 *   - SSRF
 *   - localhost abuse
 *   - 127.0.0.1
 *   - RFC1918 private networks
 *   - cloud metadata endpoints (169.254.169.254)
 *   - DNS rebinding
 *   - data exfiltration
 *   - IPv4-mapped IPv6 bypass
 *   - redirect-into-private-range attacks
 *   - hostname resolution TOCTOU
 *
 * Phase 1 defines the contract. Full enforcement belongs to the
 * network engine in a later phase.
 *
 * This is the ONE canonical source. No existing system defines this concept.
 */

// ─── Network policy mode ──────────────────────────────────────────

/**
 * The egress mode for an execution capsule.
 *
 * deny_all: no network access at all (offline execution)
 * allowlist: only allowedHosts may be contacted
 * restricted: allowlist + blocklist (blocklist takes precedence)
 */
export type NetworkMode = "deny_all" | "allowlist" | "restricted";

// ─── Network policy ───────────────────────────────────────────────

/**
 * Egress controls for an execution capsule.
 */
export interface NetworkPolicy {
  /** Policy ID */
  policyId: string;

  /** Egress mode */
  mode: NetworkMode;

  /** Hosts that are allowed (for allowlist/restricted modes) */
  allowedHosts: string[];

  /** Hosts that are always blocked (for restricted mode) */
  blockedHosts: string[];

  /** Whether private networks (RFC1918) are allowed */
  allowPrivateNetworks: boolean;
  /** Whether loopback (127.0.0.1, ::1, localhost) is allowed */
  allowLoopback: boolean;
}

// ─── Default policies ─────────────────────────────────────────────

/**
 * The default network policy: deny all network access.
 * This is the safest default. Callers must explicitly opt in to network.
 */
export const DENY_ALL_NETWORK: NetworkPolicy = {
  policyId: "default-deny-all",
  mode: "deny_all",
  allowedHosts: [],
  blockedHosts: [],
  allowPrivateNetworks: false,
  allowLoopback: false,
};

/**
 * A local development policy: allow loopback (for local dev servers)
 * but deny private networks and require explicit host allowlisting.
 *
 * WARNING: `allowLoopback: true` is a broad exception. The eventual
 * network engine must NOT treat this as "anything goes on localhost".
 * Final enforcement must explicitly enumerate which loopback services
 * are permitted (e.g. terminal-server port, preview port, local Ollama)
 * rather than allowing all of 127.0.0.1/::1.
 *
 * Final network enforcement must protect against:
 *   - loopback (127.0.0.1, ::1, 0.0.0.0)
 *   - private IPv4 (10/8, 172.16/12, 192.168/16)
 *   - private IPv6 (fc00::/7, fd00::/8)
 *   - link-local (169.254/16, fe80::/10)
 *   - cloud metadata endpoints (169.254.169.254, metadata.google.internal)
 *   - IPv4-mapped IPv6 (::ffff:127.0.0.1)
 *   - DNS rebinding (hostname resolves to private IP)
 *   - HTTP redirects into private ranges
 *   - hostname/IP resolution changes between check and connect (TOCTOU)
 *
 * Phase 1 needs contract correctness, not a full network sandbox.
 */
export const LOCAL_DEV_NETWORK: NetworkPolicy = {
  policyId: "default-local-dev",
  mode: "restricted",
  allowedHosts: [],
  blockedHosts: [
    "169.254.169.254",  // Cloud metadata endpoint
    "metadata.google.internal",  // GCP metadata
    "metadata.azure.com",  // Azure metadata
  ],
  allowPrivateNetworks: false,
  allowLoopback: true,
};

// ─── Host validation ──────────────────────────────────────────────

/**
 * Check if a host is allowed by a network policy.
 *
 * Returns true if the host is permitted, false if denied.
 * Blocklist takes precedence over allowlist.
 */
export function isHostAllowed(policy: NetworkPolicy, host: string): boolean {
  if (policy.mode === "deny_all") {
    return false;
  }

  // Normalize host: strip port, lowercase
  const normalizedHost = host.split(":")[0].toLowerCase();

  // Blocklist takes precedence
  if (policy.blockedHosts.some((h) => normalizedHost === h.toLowerCase())) {
    return false;
  }

  // Check loopback
  if (isLoopback(normalizedHost) && !policy.allowLoopback) {
    return false;
  }

  // Check private networks
  if (isPrivateNetwork(normalizedHost) && !policy.allowPrivateNetworks) {
    return false;
  }

  if (policy.mode === "allowlist" || policy.mode === "restricted") {
    return policy.allowedHosts.some((h) => normalizedHost === h.toLowerCase());
  }

  return false;
}

/**
 * Check if a host is a loopback address.
 */
function isLoopback(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0"
  );
}

/**
 * Check if a host is in a private network range (RFC1918).
 */
function isPrivateNetwork(host: string): boolean {
  // Check IPv4 private ranges
  if (/^10\./.test(host)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  // Cloud metadata
  if (host === "169.254.169.254") return true;
  if (host === "metadata.google.internal") return true;
  // IPv6 unique local
  if (/^fd[0-9a-f]{2}/.test(host)) return true;
  return false;
}
