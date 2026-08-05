/**
 * LiTT Location Resolver
 *
 * Philosophy: "LiTT already knows."
 * The resolver follows a strict fallback priority to determine the user's
 * location without ever asking — unless every automatic method fails.
 *
 * Priority chain:
 *   1. Manual — User explicitly saved their city in Settings
 *   2. Confirmed — Previously auto-detected and user confirmed (stored in prefs)
 *   3. Vercel — Native Vercel geolocation headers (x-vercel-ip-*)
 *   4. Cached IP — Server-side IP geolocation cached in Redis (24h TTL)
 *   5. Browser — Client-side GPS, opt-in only (never auto-prompted)
 *   6. Graceful Fallback — Return null, LiTT asks conversationally
 *
 * Constraints:
 *   - Never calls a third-party free IP API on every request
 *   - Vercel geo headers are always preferred over manual IP parsing
 *   - IP-derived location is approximate (low confidence)
 *   - Manual user location always overrides automatic detection
 *   - Location detection must never block the main chat response
 *   - If all resolution fails, return null — caller handles gracefully
 *   - Browser GPS is NEVER automatically triggered — only on explicit user action
 */

import "server-only";
import {
  type LocationResolution,
  type VercelGeo,
  extractVercelGeo,
} from "./types";
import { getUserPreferences } from "@/lib/connectors/connector-repository";

// ─── Types ──────────────────────────────────────────────────────

export interface ResolveLocationOptions {
  userId: string;
  headers: Headers;
  /** Upstash Redis client for caching IP geolocation (optional) */
  redis?: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, opts?: { ex?: number }) => Promise<void>;
  };
}

// ─── Resolution Steps ───────────────────────────────────────────

function fromManual(
  prefs: Awaited<ReturnType<typeof getUserPreferences>>,
): LocationResolution | null {
  if (!prefs?.saved_city || prefs.location_mode === "none") return null;

  // If location_mode is 'confirmed', it was previously auto-detected and the user confirmed it
  const source = prefs.location_mode === "confirmed" ? "confirmed" : "manual";

  return {
    city: prefs.saved_city,
    region: prefs.saved_region,
    country: prefs.country_code,
    latitude: null,
    longitude: null,
    timezone: prefs.timezone,
    source: source as LocationResolution["source"],
    confidence: "high",
    updatedAt: prefs.updated_at ?? new Date().toISOString(),
  };
}

function fromVercelGeo(geo: VercelGeo): LocationResolution | null {
  if (!geo.city && !geo.latitude) return null;

  const lat = geo.latitude ? parseFloat(geo.latitude) : null;
  const lon = geo.longitude ? parseFloat(geo.longitude) : null;

  return {
    city: geo.city ?? null,
    region: geo.region ?? null,
    country: geo.countryCode ?? geo.country ?? null,
    latitude: lat,
    longitude: lon,
    timezone: geo.timezone ?? null,
    source: "vercel",
    confidence: "medium",
    updatedAt: new Date().toISOString(),
  };
}

async function fromCachedIp(
  clientIp: string,
  redis: ResolveLocationOptions["redis"],
): Promise<LocationResolution | null> {
  if (!redis || !clientIp) return null;

  // Skip loopback/private IPs
  if (
    clientIp === "127.0.0.1" ||
    clientIp === "::1" ||
    clientIp === "localhost" ||
    clientIp.startsWith("10.") ||
    clientIp.startsWith("192.168.")
  ) {
    return null;
  }

  const cacheKey = `litt:geo:ip:${clientIp}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as LocationResolution;
      // Refresh the cache TTL on read
      void redis.set(cacheKey, cached, { ex: 86400 });
      return parsed;
    }
  } catch {
    // Cache miss or parse error — fall through
  }

  return null;
}

/**
 * Store a resolved IP location in Redis cache for 24 hours.
 * This is called after a successful Vercel geo resolution to cache
 * the result for non-Vercel environments or future requests.
 */
async function cacheIpLocation(
  clientIp: string,
  location: LocationResolution,
  redis: ResolveLocationOptions["redis"],
): Promise<void> {
  if (!redis || !clientIp) return;
  const cacheKey = `litt:geo:ip:${clientIp}`;
  try {
    await redis.set(cacheKey, JSON.stringify(location), { ex: 86400 });
  } catch {
    // Best-effort caching — don't block on failure
  }
}

// ─── Client IP Extraction ───────────────────────────────────────

export function getClientIp(headers: Headers): string | null {
  // Vercel sets x-forwarded-for — but also check x-real-ip as fallback
  // Note: If there's a proxy in front of Vercel, x-forwarded-for may
  // contain multiple IPs. The first one is the original client.
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const ip = forwarded.split(",")[0]?.trim();
    if (ip && ip !== "::1" && ip !== "127.0.0.1") return ip;
  }

  const realIp = headers.get("x-real-ip");
  if (realIp && realIp !== "::1" && realIp !== "127.0.0.1") return realIp.trim();

  return null;
}

// ─── In-Memory Cache (Request-Level) ──────────────────────────

/**
 * Short-lived in-memory cache to prevent repeated resolution within
 * the same request batch. Entries expire after 60 seconds.
 */
const memoryCache = new Map<string, { location: LocationResolution; expires: number }>();
const MEMORY_CACHE_TTL_MS = 60_000;

function getCachedMemory(userId: string): LocationResolution | null {
  const entry = memoryCache.get(userId);
  if (entry && entry.expires > Date.now()) {
    return entry.location;
  }
  memoryCache.delete(userId);
  return null;
}

function setCachedMemory(userId: string, location: LocationResolution): void {
  memoryCache.set(userId, { location, expires: Date.now() + MEMORY_CACHE_TTL_MS });
}

// ─── Main Resolver ──────────────────────────────────────────────

/**
 * Resolve the user's location using the strict fallback priority chain.
 *
 * This function is designed to be fast (<50ms in production with Vercel geo)
 * and never throws. If all resolution methods fail, it returns null.
 *
 * @param options.userId - The authenticated user's ID
 * @param options.headers - Request headers (for Vercel geo + IP extraction)
 * @param options.redis - Optional Upstash Redis client for IP caching
 * @returns LocationResolution or null if no location could be determined
 */
export async function resolveUserLocation(
  options: ResolveLocationOptions,
): Promise<LocationResolution | null> {
  const { userId, headers, redis } = options;

  // 0. Check in-memory cache first — prevents repeated resolution within request batch
  const memCached = getCachedMemory(userId);
  if (memCached) return memCached;

  // 1. Manual or Confirmed — user explicitly saved or confirmed their city
  try {
    const prefs = await getUserPreferences(userId);
    const manual = fromManual(prefs);
    if (manual) {
      setCachedMemory(userId, manual);
      return manual;
    }
  } catch {
    // DB unavailable — continue to next method
  }

  // 2. Vercel native geolocation headers
  const vercelGeo = extractVercelGeo(headers);
  if (vercelGeo) {
    const vercelLocation = fromVercelGeo(vercelGeo);
    if (vercelLocation) {
      // Cache the Vercel result for non-Vercel environments
      const clientIp = getClientIp(headers);
      if (clientIp) {
        void cacheIpLocation(clientIp, vercelLocation, redis);
      }
      setCachedMemory(userId, vercelLocation);
      return vercelLocation;
    }
  }

  // 3. Cached IP geolocation (from previous Vercel detection or manual cache)
  const clientIp = getClientIp(headers);
  if (clientIp && redis) {
    const cached = await fromCachedIp(clientIp, redis);
    if (cached) {
      setCachedMemory(userId, cached);
      return cached;
    }
  }

  // 4. Browser GPS — opt-in only, never auto-triggered.
  // The resolver does NOT prompt browser GPS. That is a client-side concern.
  // If a tool needs high-precision coordinates, the client can send a
  // browser-resolved location via the request body, which would be
  // injected as a 'browser' source by the caller.

  // 5. Graceful fallback — could not resolve
  return null;
}

/**
 * Upgrade a location's source to 'confirmed' when the user explicitly
 * confirms an auto-detected location. This should be called when the
 * user says something like "Yes, that's correct" in response to LiTT's
 * "I have you approximately in [city]" prompt.
 *
 * The confirmed location is persisted to user_preferences so it becomes
 * the new default without asking again.
 */
export async function confirmUserLocation(
  userId: string,
  location: LocationResolution,
): Promise<void> {
  try {
    const { upsertUserPreferences } = await import("@/lib/connectors/connector-repository");
    await upsertUserPreferences(userId, {
      saved_city: location.city,
      saved_region: location.region,
      country_code: location.country,
      timezone: location.timezone,
      location_mode: "confirmed",
    });
    // Invalidate the in-memory cache so the next request picks up the confirmed location
    memoryCache.delete(userId);
  } catch {
    // Best-effort — don't throw on confirmation failure
  }
}

/**
 * Build a USER CONTEXT location block for the system prompt.
 * This is the "Where am I?" layer that LiTT uses to personalize responses.
 */
export function buildLocationContextBlock(location: LocationResolution): string {
  if (location.source === "none" || !location.city) return "";

  const parts: string[] = [
    `  Location: ${location.city}`,
  ];
  if (location.region) parts.push(`  Region: ${location.region}`);
  if (location.country) parts.push(`  Country: ${location.country}`);
  if (location.timezone) parts.push(`  Timezone: ${location.timezone}`);
  if (location.latitude != null && location.longitude != null) {
    parts.push(`  Coordinates: ${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`);
  }

  const sourceLabel =
    location.source === "manual" ? "user-saved" :
    location.source === "vercel" ? "auto-detected" :
    location.source === "ip_fallback" ? "approximate" :
    location.source;

  parts.push(`  Source: ${sourceLabel}`);
  parts.push(`  Confidence: ${location.confidence}`);

  return `LOCATION CONTEXT:\n${parts.join("\n")}`;
}
