/**
 * LiTT User Context Layer
 *
 * Aggregates user profile, preferences, location, and permissions
 * into a single context object that LiTT uses when deciding how to
 * respond to personal-assistant requests.
 *
 * This is the "Who is speaking?" layer. It never guesses — it only
 * returns data the user explicitly provided or approved.
 */

import "server-only";
import { getAdminSupabase } from "@/lib/supabase-admin";
import {
  getUserPreferences,
  getCapabilityStatus,
} from "@/lib/connectors/connector-repository";
import type { CapabilityId, CapabilityStatus } from "@/lib/connectors/provider-registry";

export interface UserLocation {
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  source: "manual_city" | "device_location" | "ip_auto" | "ip_fallback" | "vercel" | "confirmed" | "none";
}

export interface UserContext {
  userId: string;
  displayName: string | null;
  email: string | null;
  timezone: string | null;
  locale: string | null;
  temperatureUnit: "celsius" | "fahrenheit";
  distanceUnit: "metric" | "imperial";
  location: UserLocation;
  newsInterests: string[];
  dailyBriefingEnabled: boolean;
  dailyBriefingTime: string | null;
  capabilities: Partial<Record<CapabilityId, CapabilityStatus>>;
  fetchedAt: number;
}

const DEFAULT_CONTEXT: Omit<UserContext, "userId" | "fetchedAt"> = {
  displayName: null,
  email: null,
  timezone: null,
  locale: null,
  temperatureUnit: "fahrenheit",
  distanceUnit: "imperial",
  location: {
    city: null,
    region: null,
    country: null,
    latitude: null,
    longitude: null,
    source: "none",
  },
  newsInterests: [],
  dailyBriefingEnabled: false,
  dailyBriefingTime: null,
  capabilities: {},
};

async function fetchUserProfile(
  userId: string,
): Promise<{ displayName: string | null; email: string | null }> {
  let admin: ReturnType<typeof getAdminSupabase> | null = null;
  try {
    admin = getAdminSupabase();
  } catch {
    return { displayName: null, email: null };
  }
  const { data } = await admin
    .from("users")
    .select("name, email")
    .eq("clerk_id", userId)
    .maybeSingle();
  if (!data) return { displayName: null, email: null };
  return {
    displayName: (data as { name?: string | null }).name ?? null,
    email: (data as { email?: string | null }).email ?? null,
  };
}

async function fetchCapabilityStatuses(
  userId: string,
  caps: CapabilityId[],
): Promise<Partial<Record<CapabilityId, CapabilityStatus>>> {
  const results: Partial<Record<CapabilityId, CapabilityStatus>> = {};
  await Promise.all(
    caps.map(async (cap) => {
      const status = await getCapabilityStatus(userId, cap);
      if (status) results[cap] = status;
    }),
  );
  return results;
}

const DEFAULT_CAPS_TO_CHECK: CapabilityId[] = [
  "weather.current",
  "weather.hourly",
  "weather.daily",
  "weather.geocode",
  "web.search",
  "news.search",
  "profile.read",
  "preferences.read",
  "preferences.update",
  "location.read",
  "location.update",
];

// ─── Vercel Geo Header Parsing ──────────────────────────────────

/**
 * Parse Vercel's native geolocation headers to determine user location.
 * Vercel injects x-vercel-ip-city, x-vercel-ip-latitude, etc. on all
 * Edge and Serverless deployments. This is the production-safe way to
 * auto-detect location — no third-party API calls needed.
 *
 * @see https://vercel.com/changelog/ip-geolocation-for-serverless-functions
 */
function parseVercelGeoHeaders(headers: Headers): UserLocation | null {
  const city = headers.get("x-vercel-ip-city");
  const latitude = headers.get("x-vercel-ip-latitude");
  const longitude = headers.get("x-vercel-ip-longitude");

  if (!city && !latitude) return null;

  return {
    city: city ?? null,
    region: headers.get("x-vercel-ip-country-region") ?? null,
    country: headers.get("x-vercel-ip-country-code") ?? null,
    latitude: latitude ? parseFloat(latitude) : null,
    longitude: longitude ? parseFloat(longitude) : null,
    source: "vercel",
  };
}

export async function getUserContext(
  userId: string,
  options?: { capabilities?: CapabilityId[]; headers?: Headers },
): Promise<UserContext> {
  const capsToCheck = options?.capabilities ?? DEFAULT_CAPS_TO_CHECK;

  const [profile, prefs, capabilities] = await Promise.all([
    fetchUserProfile(userId),
    getUserPreferences(userId),
    fetchCapabilityStatuses(userId, capsToCheck),
  ]);

  if (!prefs) {
    // No preferences row — try Vercel geo headers if available
    let location: UserLocation = { ...DEFAULT_CONTEXT.location };
    if (options?.headers) {
      const geo = parseVercelGeoHeaders(options.headers);
      if (geo) location = geo;
    }
    return {
      ...DEFAULT_CONTEXT,
      userId,
      displayName: profile.displayName,
      email: profile.email,
      location,
      capabilities,
      fetchedAt: Date.now(),
    };
  }

  let location: UserLocation = {
    city: prefs.saved_city,
    region: prefs.saved_region,
    country: prefs.country_code,
    latitude: null,
    longitude: null,
    source: prefs.location_mode as UserLocation["source"],
  };

  // If no manual location, try Vercel geo headers as fallback
  if ((!location.city || location.source === "none") && options?.headers) {
    const geo = parseVercelGeoHeaders(options.headers);
    if (geo) location = geo;
  }

  return {
    userId,
    displayName: profile.displayName,
    email: profile.email,
    timezone: prefs.timezone,
    locale: prefs.locale,
    temperatureUnit: prefs.temperature_unit,
    distanceUnit: prefs.distance_unit,
    location,
    newsInterests: prefs.news_interests ?? [],
    dailyBriefingEnabled: prefs.daily_briefing_enabled,
    dailyBriefingTime: prefs.daily_briefing_time,
    capabilities,
    fetchedAt: Date.now(),
  };
}

export function hasLocation(ctx: UserContext): boolean {
  return ctx.location.source !== "none" && ctx.location.city !== null;
}

export function hasCapability(
  ctx: UserContext,
  cap: CapabilityId,
): boolean {
  const status = ctx.capabilities[cap];
  return status === "ready" || status === "unknown";
}

export function formatTemperature(
  ctx: UserContext,
  celsius: number,
): string {
  if (ctx.temperatureUnit === "celsius") {
    return `${Math.round(celsius)}\u00B0C`;
  }
  const f = (celsius * 9) / 5 + 32;
  return `${Math.round(f)}\u00B0F`;
}

/**
 * Build a USER CONTEXT block for the system prompt.
 * This gives LiTT awareness of who they're talking to — name, location,
 * timezone, preferences — so responses feel personal, not generic.
 */
export function buildUserContextBlock(ctx: UserContext): string {
  const lines: string[] = [
    "USER CONTEXT (use this to personalize responses — name, location, preferences):",
  ];

  if (ctx.displayName) {
    lines.push(`  Name: ${ctx.displayName}`);
  }
  if (ctx.email) {
    lines.push(`  Email: ${ctx.email}`);
  }
  if (ctx.location.city) {
    const locSource = ctx.location.source === "ip_auto" ? " (auto-detected from IP)" : "";
    lines.push(`  Location: ${ctx.location.city}${ctx.location.region ? `, ${ctx.location.region}` : ""}${ctx.location.country ? `, ${ctx.location.country}` : ""}${locSource}`);
  }
  if (ctx.timezone) {
    lines.push(`  Timezone: ${ctx.timezone}`);
  }
  if (ctx.temperatureUnit) {
    lines.push(`  Temperature unit: ${ctx.temperatureUnit}`);
  }
  if (ctx.newsInterests.length > 0) {
    lines.push(`  News interests: ${ctx.newsInterests.join(", ")}`);
  }
  if (ctx.dailyBriefingEnabled) {
    lines.push(`  Daily briefing: enabled${ctx.dailyBriefingTime ? ` at ${ctx.dailyBriefingTime}` : ""}`);
  }

  if (lines.length === 1) {
    return ""; // No user context available
  }

  lines.push("");
  lines.push("RULES:");
  lines.push("- Use the user's name naturally in conversation, not every sentence.");
  lines.push("- Use their location for weather, local recommendations, and time references.");
  lines.push("- If location is not set and they ask about weather, ask what city they're in — don't give a robot error.");
  lines.push("- Honor their temperature unit preference (celsius vs fahrenheit).");
  lines.push("- Remember what they share in conversation — their preferences should grow over time.");

  return lines.join("\n");
}
