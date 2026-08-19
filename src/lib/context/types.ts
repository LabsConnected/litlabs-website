/**
 * LiTT Context Engine — Core Types
 *
 * Philosophy: "LiTT already knows."
 * The system should never ask the user for context (location, project,
 * preferences) that it can securely and automatically determine.
 *
 * This module defines the canonical types for the LiTT context layer:
 * - LocationResolution: How we know where the user is
 * - LittUserContext: Everything LiTT knows about the user at this moment
 */

// ─── Location ───────────────────────────────────────────────────

export type LocationSource =
  | "manual"       // User explicitly saved their city in Settings
  | "confirmed"    // Previously auto-detected and user confirmed/cached
  | "vercel"       // Vercel native geolocation headers (request.geo)
  | "browser"      // Browser GPS permission (high-precision only, opt-in)
  | "ip_fallback"  // Cached server-side IP geolocation (last resort)
  | "none";        // Could not resolve — LiTT should ask gracefully

export type LocationConfidence = "high" | "medium" | "low";

export interface LocationResolution {
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  source: LocationSource;
  confidence: LocationConfidence;
  /** Estimated accuracy in meters (browser GPS provides this, IP is ~5000-50000) */
  accuracyMeters?: number;
  updatedAt: string;
}

export const NULL_LOCATION: LocationResolution = {
  city: null,
  region: null,
  country: null,
  latitude: null,
  longitude: null,
  timezone: null,
  source: "none",
  confidence: "low",
  updatedAt: new Date(0).toISOString(),
};

// ─── Preferences ────────────────────────────────────────────────

export interface UserPreferences {
  theme: string | null;
  language: string | null;
  units: "metric" | "imperial";
  temperatureUnit: "celsius" | "fahrenheit";
  timezone: string | null;
  newsInterests: string[];
  dailyBriefingEnabled: boolean;
  dailyBriefingTime: string | null;
}

// ─── Project & Workspace ────────────────────────────────────────

export interface CurrentProject {
  id: string;
  name: string;
  repositoryConnected: boolean;
  repositoryName: string | null;
  activeBranch: string | null;
}

export interface CurrentWorkspace {
  mode: string;
  selectedNode: string | null;
}

// ─── Recent Context ─────────────────────────────────────────────

export interface RecentContext {
  openFiles: string[];
  activeAssets: string[];
  recentConversations: string[];
}

// ─── Current File & Asset ───────────────────────────────────────

export interface CurrentFile {
  path: string;
  language?: string;
}

export interface CurrentAsset {
  id: string;
  name: string;
  type?: string;
}

// ─── Memory ─────────────────────────────────────────────────────

export interface ContextMemory {
  user: unknown[];
  project: unknown[];
}

// ─── Active Agent & Task ───────────────────────────────────────

export interface ActiveAgent {
  slug: string;
  mode: string;
  instanceId: string | null;
}

export interface ActiveTask {
  id: string;
  description: string;
}

// ─── Conversation ──────────────────────────────────────────────

export interface ConversationContext {
  id: string;
  title: string | null;
}

// ─── Full User Context ──────────────────────────────────────────

export interface LittUserContext {
  userId: string;
  displayName: string | null;
  email: string | null;
  location: LocationResolution;
  preferences: UserPreferences;
  currentProject: CurrentProject | null;
  currentWorkspace: CurrentWorkspace | null;
  currentFile: CurrentFile | null;
  currentAsset: CurrentAsset | null;
  activeAgent: ActiveAgent | null;
  activeTask: ActiveTask | null;
  conversation: ConversationContext | null;
  recentContext: RecentContext | null;
  memory: ContextMemory | null;
  capabilities: Record<string, string>;
  fetchedAt: number;
}

// ─── Request Geo (platform-native, Vercel only) ────────────────

/**
 * Vercel provides geolocation data via `request.geo` on Edge/Serverless.
 * This interface mirrors what Vercel injects. Not all fields are guaranteed.
 * Railway does NOT inject these headers — extractVercelGeo returns null on
 * Railway and callers should handle that gracefully.
 *
 * @see https://vercel.com/changelog/ip-geolocation-for-serverless-functions
 */
export interface VercelGeo {
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  latitude?: string;
  longitude?: string;
  regionCode?: string;
  postalCode?: string;
  timezone?: string;
}

/**
 * Extract Vercel geo data from a NextRequest's headers.
 * Vercel injects these as `x-vercel-ip-city`, `x-vercel-ip-country`, etc.
 */
export function extractVercelGeo(headers: Headers): VercelGeo | null {
  const city = headers.get("x-vercel-ip-city");
  const country = headers.get("x-vercel-ip-country");
  const countryCode = headers.get("x-vercel-ip-country-code");
  const region = headers.get("x-vercel-ip-country-region");
  const regionCode = headers.get("x-vercel-ip-country-region-code");
  const latitude = headers.get("x-vercel-ip-latitude");
  const longitude = headers.get("x-vercel-ip-longitude");
  const timezone = headers.get("x-vercel-ip-timezone");
  const postalCode = headers.get("x-vercel-ip-postal-code");

  if (!city && !country && !latitude) return null;

  return {
    city: city ?? undefined,
    country: country ?? undefined,
    countryCode: countryCode ?? undefined,
    region: region ?? undefined,
    regionCode: regionCode ?? undefined,
    latitude: latitude ?? undefined,
    longitude: longitude ?? undefined,
    timezone: timezone ?? undefined,
    postalCode: postalCode ?? undefined,
  };
}
