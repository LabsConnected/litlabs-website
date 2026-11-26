/**
 * DNS-resolution SSRF guard for the Studio browser proxy.
 *
 * checkBrowserUrlPolicy inspects the literal hostname only — a domain
 * like "localtest.me" passes every hostname rule and then resolves to
 * 127.0.0.1, and DNS rebinding can flip an answer between validation
 * and connect. This module closes both gaps:
 *
 *   1. resolvePublicAddresses() resolves the hostname and validates
 *      EVERY returned address with the shared ip-address-safety
 *      classifier — one private/looped-back answer fails the whole
 *      destination closed, even if siblings are public.
 *   2. pinnedDispatcherFor() returns an undici Agent whose connect
 *      lookup ALWAYS answers with those pre-validated addresses, so
 *      the socket never consults live DNS again — no TOCTOU window,
 *      no rebinding. TLS SNI and the Host header still carry the real
 *      hostname, so certificates and virtual hosting are unaffected.
 *
 * Agents are cached briefly per hostname (connection reuse + stable
 * pinning); expiry re-resolves and re-validates, and a resolution that
 * newly includes a non-public address fails closed.
 */

import { isIP, type LookupFunction } from "node:net";
import dns from "node:dns";
import { Agent, buildConnector, type Dispatcher } from "undici";
import { ipBlockReason } from "@/lib/litt-intelligence/ip-address-safety";

/** DNS lookup budget — a hung resolver must not stall the proxy. */
const DNS_TIMEOUT_MS = 5_000;
/** How long a validated address set stays pinned for a hostname. */
const PIN_TTL_MS = 60_000;
/** Bound on cached agents so a hostile hostname spray can't grow memory. */
const AGENT_CACHE_MAX = 200;

/** Thrown when a hostname resolves to (or only to) unsafe addresses. */
export class DestinationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DestinationBlockedError";
  }
}

interface ResolvedAddress {
  address: string;
  family: number;
}

/**
 * Resolve `hostname` and prove every answer is a public unicast
 * address. Throws DestinationBlockedError when any answer is
 * non-public (fail closed — one bad answer poisons the destination)
 * or when resolution fails/returns nothing.
 */
export async function resolvePublicAddresses(
  hostname: string,
): Promise<ResolvedAddress[]> {
  let results: ResolvedAddress[];
  try {
    const lookup = dns.promises.lookup(hostname, {
      all: true,
      verbatim: true,
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("DNS resolution timed out")), DNS_TIMEOUT_MS),
    );
    results = await Promise.race([lookup, timeout]);
  } catch (err) {
    if (err instanceof DestinationBlockedError) throw err;
    throw new DestinationBlockedError(
      `DNS resolution failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!results || results.length === 0) {
    throw new DestinationBlockedError("hostname did not resolve to any address");
  }
  for (const { address } of results) {
    const reason = ipBlockReason(address);
    if (reason) {
      throw new DestinationBlockedError(
        `hostname resolves to a non-public address (${address}: ${reason})`,
      );
    }
  }
  return results;
}

interface CachedAgent {
  agent: Agent;
  expires: number;
}

const agentCache = new Map<string, CachedAgent>();

function cacheAgent(host: string, entry: CachedAgent): void {
  if (agentCache.size >= AGENT_CACHE_MAX) {
    const oldestKey = agentCache.keys().next().value;
    const oldest = oldestKey !== undefined ? agentCache.get(oldestKey) : undefined;
    if (oldestKey !== undefined) agentCache.delete(oldestKey);
    if (oldest) void oldest.agent.close().catch(() => {});
  }
  agentCache.set(host, entry);
}

/** Test hook: drop all cached agents. */
export function clearDestinationCache(): void {
  for (const { agent } of agentCache.values()) {
    void agent.close().catch(() => {});
  }
  agentCache.clear();
}

/**
 * Return a dispatcher that connects ONLY to the validated addresses
 * for `hostname`, or undefined for IP-literal hosts (already
 * classified by the URL policy — no DNS involved).
 *
 * The lookup callback ignores live DNS entirely: whatever the
 * resolver would say at connect time is irrelevant, which is what
 * makes DNS rebinding ineffective.
 */
export async function pinnedDispatcherFor(
  hostname: string,
): Promise<Dispatcher | undefined> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || isIP(host) !== 0) return undefined;

  const cached = agentCache.get(host);
  if (cached) {
    if (cached.expires > Date.now()) return cached.agent;
    agentCache.delete(host);
    void cached.agent.close().catch(() => {});
  }

  const addresses = await resolvePublicAddresses(host);

  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, addresses);
      return;
    }
    const first = addresses[0];
    callback(null, first.address, first.family);
  };

  const agent = new Agent({ connect: buildConnector({ lookup }) });
  cacheAgent(host, { agent, expires: Date.now() + PIN_TTL_MS });
  return agent;
}
