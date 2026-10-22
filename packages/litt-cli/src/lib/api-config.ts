/**
 * API base URL resolution for the LiTTree website backend.
 *
 * Separate from auth-config.ts on purpose — this module is additive and
 * does not alter the existing Clerk issuer / OAuth client_id / terminal-
 * server resolution. It resolves ONE value: the base URL for the
 * website's own `/api/*` routes (e.g. `/api/memory`), as distinct from
 * the terminal-server URL (`getTerminalUrl()`), which is a different
 * Railway service for remote command execution.
 *
 * Same production default host as the Clerk issuer in auth-config.ts
 * (`https://www.litlabs.net`) and the same literal default the mobile
 * companion app (`packages/litt-companion`) uses for its own
 * EXPO_PUBLIC_API_URL — one convention, two runtimes, no shared code
 * possible (Node CLI vs. Expo/RN), so the value is kept identical by
 * convention instead of by import.
 *
 * Env vars (all OPTIONAL — overrides for dev/staging/testing only):
 *   LITT_API_URL — website API base URL
 */

/** Default production website API base URL. */
const DEFAULT_API_BASE_URL = "https://www.litlabs.net";

/**
 * Resolve the website API base URL (env override or production default).
 *
 * Always returns a valid URL for a normal installed CLI — there is no
 * failure mode here, unlike resolveAuthConfig(), because there is no
 * "empty override" footgun to guard against (an empty LITT_API_URL
 * simply falls through to the default via the `||` below).
 */
export function getApiBaseUrl(): string {
  const env = process.env.LITT_API_URL;
  return env && env.trim() ? env.trim().replace(/\/$/, "") : DEFAULT_API_BASE_URL;
}

export { DEFAULT_API_BASE_URL };
