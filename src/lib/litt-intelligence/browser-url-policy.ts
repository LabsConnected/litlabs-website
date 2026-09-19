/**
 * LiTT Agent Browser — navigate-time URL policy (Phase 2, §5.3 of the
 * agent-browser plan).
 *
 * Pure, dependency-free: safe to import from both server tool handlers
 * and (via re-export) the chat-facing orchestration layer, and trivially
 * unit-testable.
 *
 * The policy is LiTT's own guardrail, independent of the vendor's network
 * isolation. It blocks:
 *   - non-http(s) schemes: file://, chrome://, javascript:, data:, …
 *   - localhost / loopback (127.0.0.0/8, ::1, 0.0.0.0)
 *   - link-local ranges (169.254.0.0/16, fe80::/10) — these cover the
 *     cloud metadata endpoints (169.254.169.254, 100.100.100.200, …)
 *   - well-known cloud metadata hostnames
 *   - a small blocklist of credential-phishing hostname patterns
 *     (typosquats + credential-bait substrings + IDN homograph prefix)
 *
 * Known limitation (documented, not silent): hostnames that resolve via
 * DNS to a blocked IP are not caught — this layer inspects the literal
 * hostname. Browserbase's own network egress isolation is the deeper
 * layer. The blocklist is a first line, not a guarantee.
 */

export interface BrowserUrlPolicyResult {
  allowed: boolean;
  /** Present when blocked: human/agent-readable reason. */
  reason?: string;
  /** The host that was inspected (lowercased). */
  host?: string;
}

// ─── URL normalization ───────────────────────────────────────────
// (Moved here from browser-agent.ts Phase 1 so the navigate tool path can
// share it without creating an import cycle. browser-agent.ts re-exports
// it to keep the existing import path working.)

/**
 * Normalize user-supplied URL text for the browser.
 * Adds https:// when no scheme is present; rejects non-http(s) schemes
 * (file://, chrome://, javascript:, …) and unparseable input.
 * Returns null when the input is not a loadable web URL.
 */
export function normalizeBrowserUrl(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  // If the input already carries a scheme, only http(s) is loadable —
  // never rewrite file://, chrome://, javascript:, … into https://.
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return null;
    try {
      return new URL(trimmed).toString();
    } catch {
      return null;
    }
  }
  try {
    return new URL(`https://${trimmed}`).toString();
  } catch {
    return null;
  }
}

// ─── Policy ──────────────────────────────────────────────────────

// Cloud metadata endpoints: well-known IPs + hostnames. The IPs live in
// link-local ranges, which are blocked by the range check below; the
// hostnames are listed explicitly.
const METADATA_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.google",
  "metadata.goog",
  "instance-data",
  "instance-data-compute",
]);

const METADATA_IPS = new Set([
  "169.254.169.254", // AWS / GCP / Azure
  "100.100.100.200", // Alibaba Cloud
  "192.0.0.192", // Oracle Cloud
]);

// Credential-phishing hostname patterns. Small, curated, and documented:
// typosquats of high-value brands, credential-bait substrings, and the
// IDN (punycode) homograph prefix. A first line, not a guarantee.
const PHISHING_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /paypa[l1]/i, label: "typosquat of a payment brand" },
  { pattern: /pay-pal/i, label: "typosquat of a payment brand" },
  { pattern: /apple[-.]?id/i, label: "credential-harvesting pattern" },
  { pattern: /micr[o0]s[o0]ft/i, label: "typosquat of a tech brand" },
  { pattern: /micorsoft/i, label: "typosquat of a tech brand" },
  { pattern: /g[o0]{2}gle/i, label: "typosquat of a tech brand" },
  { pattern: /faceb[o0]{2}k/i, label: "typosquat of a social brand" },
  { pattern: /amaz[o0]n/i, label: "typosquat of a retail brand" },
  { pattern: /netfl[i1]x/i, label: "typosquat of a media brand" },
  { pattern: /chase[-.]?bank/i, label: "credential-harvesting pattern" },
  { pattern: /wells[-.]?fargo/i, label: "credential-harvesting pattern" },
  { pattern: /verify[-.]?account/i, label: "credential-bait phrasing" },
  { pattern: /account[-.]?suspended/i, label: "credential-bait phrasing" },
  { pattern: /secure[-.]?login/i, label: "credential-bait phrasing" },
  { pattern: /login[-.]?verify/i, label: "credential-bait phrasing" },
  { pattern: /signin[-.]?confirm/i, label: "credential-bait phrasing" },
  { pattern: /(^|\.)xn--/i, label: "IDN homograph (punycode) domain" },
];

function isIPv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function ipv4Octets(host: string): number[] | null {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null;
  }
  return parts;
}

function blockedIpv4Reason(host: string): string | null {
  const octets = ipv4Octets(host);
  if (!octets) return null;
  const [a, b] = octets;
  if (a === 127) return "loopback address";
  if (a === 0) return "unspecified address (0.0.0.0)";
  if (a === 169 && b === 254) {
    return METADATA_IPS.has(host)
      ? "cloud metadata endpoint"
      : "link-local address";
  }
  return null;
}

function blockedIpv6Reason(host: string): string | null {
  // Node's URL.hostname keeps the brackets on IPv6 literals ("[::1]");
  // strip them before range checks.
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1") return "loopback address";
  if (h === "::" || h === "0:0:0:0:0:0:0:0") return "unspecified address";
  if (h.startsWith("fe80:")) return "link-local address";
  return null;
}

/**
 * Apply the navigate-time URL policy.
 *
 * Accepts a raw or normalized URL string; rejects anything that is not a
 * loadable http(s) URL, then inspects the host against the block rules.
 */
export function checkBrowserUrlPolicy(raw: string): BrowserUrlPolicyResult {
  const normalized = normalizeBrowserUrl(raw);
  if (!normalized) {
    return {
      allowed: false,
      reason: `"${(raw ?? "").trim()}" is not a valid http(s) web address`,
    };
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return { allowed: false, reason: "unparseable URL" };
  }

  const host = url.hostname.toLowerCase();
  if (!host) {
    return { allowed: false, reason: "URL has no host", host };
  }

  // localhost and its aliases
  if (host === "localhost" || host.endsWith(".localhost")) {
    return { allowed: false, reason: "localhost is not browsable", host };
  }

  // Cloud metadata hostnames
  if (METADATA_HOSTNAMES.has(host)) {
    return { allowed: false, reason: "cloud metadata endpoint", host };
  }

  // Literal IP checks (no DNS resolution at this layer — documented above)
  const ipReason = isIPv4(host) ? blockedIpv4Reason(host) : blockedIpv6Reason(host);
  if (ipReason) {
    return { allowed: false, reason: ipReason, host };
  }

  // Credential-phishing patterns
  for (const { pattern, label } of PHISHING_PATTERNS) {
    if (pattern.test(host)) {
      return {
        allowed: false,
        reason: `blocked by phishing policy (${label})`,
        host,
      };
    }
  }

  return { allowed: true, host };
}
