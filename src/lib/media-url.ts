/**
 * Runtime media URL validation.
 *
 * The dashboard music player was assigning `audio.src = track.url` without
 * validating the value. When the `/api/tracks` endpoint returned `url: null`
 * (tracks without a stored audio file), JavaScript coerced `null` to the
 * string `"null"`, which the browser resolved to `https://litlabs.net/null`.
 * Firefox then logged "Content-Type text/html is not supported" and
 * "Cannot play media" errors.
 *
 * This module provides `normalizeMediaUrl` — a single source of truth for
 * deciding whether a value is safe to assign to `audio.src`, `video.src`,
 * `iframe.src`, `img.src`, or `<source src>`.
 *
 * Rules:
 *   - Accept non-empty string values only (reject null, undefined, numbers, etc.)
 *   - Reject the literal strings "null" and "undefined"
 *   - Reject empty/whitespace-only strings
 *   - Reject file: URLs (production UI must never navigate to the filesystem)
 *   - Accept same-origin relative paths (starting with "/")
 *   - Accept blob: URLs
 *   - Accept data:audio/ and data:video/ URLs (TTS results use data: URIs)
 *   - Accept https: URLs
 *   - Reject everything else (http:, javascript:, etc.)
 */

/**
 * Validate and normalize a media URL value.
 *
 * @returns The validated URL string, or `null` if the value is invalid.
 *          Never returns the string "null" or "undefined".
 */
export function normalizeMediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
  if (/^file:/i.test(trimmed)) return null;

  // Same-origin relative paths
  if (trimmed.startsWith("/")) return trimmed;

  // Blob URLs (object URLs created at runtime)
  if (trimmed.startsWith("blob:")) return trimmed;

  // Data URLs — only allow audio/video MIME types to avoid XSS via data:text/html
  if (trimmed.startsWith("data:audio/") || trimmed.startsWith("data:video/")) {
    return trimmed;
  }

  // Absolute URLs — only allow https
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Type guard: returns true when the value is a valid media URL.
 */
export function isValidMediaUrl(value: unknown): boolean {
  return normalizeMediaUrl(value) !== null;
}

/**
 * Filter an array of tracks (or any objects with a `url` field), returning
 * only those whose URL passes validation. This is used to quarantine
 * malformed tracks before they enter the playback queue.
 */
export function filterValidMediaUrls<T extends { url?: unknown }>(
  items: T[],
): T[] {
  return items.filter((item) => isValidMediaUrl(item.url));
}
