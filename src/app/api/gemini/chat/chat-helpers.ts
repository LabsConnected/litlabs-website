/**
 * Shared security helpers for the chat route and prompt composer.
 *
 * These are pure functions used by BOTH the production route handler and
 * the tests — tests must never reimplement this logic.
 */

/**
 * Parse a raw `responseMode` value from the request body.
 *
 * Only the exact string `"voice"` activates voice guidance. Everything
 * else — missing, null, undefined, "text", "audio", "VOICE", numbers,
 * objects — defaults to `"text"`.
 *
 * Case-sensitive on purpose: the client must explicitly opt in.
 */
export function parseResponseMode(value: unknown): "text" | "voice" {
  return value === "voice" ? "voice" : "text";
}

/**
 * Validate and sanitize a trusted display name (Clerk firstName).
 *
 * This does NOT mutate malformed values into merged words. Suspicious
 * values are rejected entirely — returning undefined — so the prompt
 * omits personalization rather than embedding garbled text.
 *
 * Accepted:
 *   - Unicode letters and combining marks
 *   - Internal apostrophe (U+0027 or U+2019) or hyphen (U+002D)
 *   - 1–32 characters after NFKC normalization and trim
 *
 * Rejected (returns undefined):
 *   - Empty / whitespace-only
 *   - Longer than 32 chars
 *   - Contains spaces (multiword / instruction-shaped text)
 *   - Contains digits, HTML tags, sentence punctuation, control chars
 *   - Starts or ends with apostrophe/hyphen
 *
 * Examples:
 *   "Larry"            → "Larry"
 *   "Mary-Jane"        → "Mary-Jane"
 *   "D'Andre"          → "D'Andre"
 *   "D’Andre"          → "D’Andre"
 *   "Larry Ignore"     → undefined  (space → multiword)
 *   "John<script>"    → undefined  (< > not allowed)
 *   "John123"          → undefined  (digits not allowed)
 *   ""                 → undefined
 *   "   "              → undefined
 *   null / undefined   → undefined
 */
export function sanitizeTrustedFirstName(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;

  const normalized = value.normalize("NFKC").trim();

  if (normalized.length < 1 || normalized.length > 32) {
    return undefined;
  }

  // Must be entirely letters/marks, optionally with internal apostrophe
  // or hyphen separating letter groups. No spaces, no digits, no tags.
  if (!/^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u.test(normalized)) {
    return undefined;
  }

  return normalized;
}
