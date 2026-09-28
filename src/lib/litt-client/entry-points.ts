/**
 * Single place that decides which surface is the mobile / PWA entry.
 *
 * Phase 0 does not read this from the manifest, `next.config` redirects,
 * or `/chat`, `/agent-chat`, and `/litt`. Those stay pointed at Studio.
 * A later phase flips `DEFAULT_MOBILE_ENTRY` (and only then updates the
 * manifest `start_url` and redirects) without hunting through the app.
 */

export type LittSurface = "app" | "studio";

export interface LittEntryPoint {
  id: LittSurface;
  /** URL path. Route groups are not part of this path. */
  path: string;
  role: "consumer" | "advanced";
  /**
   * Value a future manifest `start_url` would use for this surface.
   * Phase 0 does not write it into `public/manifest.json`.
   */
  manifestStartUrl: string;
}

export const LITT_APP_ENABLED_ENV = "NEXT_PUBLIC_LITT_APP_ENABLED";

export const LITT_ENTRY_POINTS: Record<LittSurface, LittEntryPoint> = {
  app: {
    id: "app",
    path: "/app",
    role: "consumer",
    manifestStartUrl: "/app",
  },
  studio: {
    id: "studio",
    path: "/studio",
    role: "advanced",
    manifestStartUrl: "/studio",
  },
};

/**
 * Default mobile and PWA entry. Studio remains the default so existing
 * installs, shortcuts, and redirects are unchanged.
 */
export const DEFAULT_MOBILE_ENTRY: LittSurface = "studio";

export function defaultMobileEntry(): LittEntryPoint {
  return LITT_ENTRY_POINTS[DEFAULT_MOBILE_ENTRY];
}

/**
 * The LiTT App is off unless the public flag is exactly "1", "true", or
 * "on" (any case). Unset and every other value keep `/app` hidden.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time. Turning the app on
 * in a deployed environment requires a rebuild.
 */
export function isLittAppEnabled(env?: Record<string, string | undefined>): boolean {
  const value = (env ?? process.env).NEXT_PUBLIC_LITT_APP_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

export type LittAppAccess = "not_found" | "sign_in" | "allow";

/**
 * Gate for the `/app` layout. The flag wins: a disabled app 404s even
 * for a signed-in user. An enabled app still requires a user id.
 * `src/proxy.ts` also protects `/app(.*)`, so signed-out browser
 * requests are redirected before this runs.
 */
export function resolveLittAppAccess(
  enabled: boolean,
  userId: string | null | undefined,
): LittAppAccess {
  if (!enabled) return "not_found";
  if (!userId) return "sign_in";
  return "allow";
}
