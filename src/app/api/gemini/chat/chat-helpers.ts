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

// ─── Response sanitization ──────────────────────────────────────

/**
 * Readiness phrases that must never appear as the opening of a response.
 * The prompt already prohibits these, but some models (especially Gemini)
 * still produce them. This is a post-processing safety net.
 */
const READINESS_OPENINGS: RegExp[] = [
  /^(?:hello!?\s+)?i'm ready(?:\s+to\s+go)?[.!?\s]+/i,
  /^(?:hello!?\s+)?i'm here(?:\s+and\s+ready)?(?:\s+to\s+help)?[.!?\s]+/i,
  /^(?:hello!?\s+)?ready when you are[.!?\s]+/i,
  /^(?:hello!?\s+)?just chilling[.!?\s]+/i,
  /^(?:hello!?\s+)?i'm here to help[.!?\s]+/i,
  /^thanks for checking in!?\s+i'm here and ready[.!?\s]+/i,
  /^thanks for checking in!?\s+/i,
];

/**
 * Placeholder name patterns that models sometimes emit when no trusted
 * name is available. These must be stripped entirely.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[User's Name\]/gi,
  /\[Name\]/gi,
  /\[Member\]/gi,
  /\[Friend\]/gi,
  /\[Username\]/gi,
  /\[Your Name\]/gi,
];

/**
 * Strip readiness openings from the beginning of a response.
 *
 * The prompt prohibits these, but some models still produce them.
 * If the entire response is a readiness phrase, return an empty
 * string so the caller can detect the failure.
 */
function stripReadinessOpening(text: string): string {
  let result = text;
  for (const pattern of READINESS_OPENINGS) {
    result = result.replace(pattern, "");
  }
  return result.trimStart();
}

/**
 * Strip placeholder name patterns from the response.
 * Models sometimes emit [User's Name] when no trusted name is available.
 */
function stripPlaceholders(text: string): string {
  let result = text;
  for (const pattern of PLACEHOLDER_PATTERNS) {
    result = result.replace(pattern, "");
  }
  // Clean up spaces left by placeholder removal:
  // - double spaces → single
  // - space before comma/period → remove
  result = result.replace(/  +/g, " ");
  result = result.replace(/\s+([,.!?;:])/g, "$1");
  return result;
}

/**
 * Split text into sentences (rough, handles common cases).
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Limit a voice response to a maximum number of sentences.
 * Trims at sentence boundaries, never mid-sentence.
 */
function limitVoiceSentences(text: string, maxSentences: number): string {
  const sentences = splitSentences(text);
  if (sentences.length <= maxSentences) return text;
  return sentences.slice(0, maxSentences).join(" ") + ".";
}

/**
 * Sanitize a model response before sending it to the user.
 *
 * This is a post-processing safety net that catches patterns the
 * prompt prohibits but models still produce:
 *   1. Readiness openings ("I'm ready to go", "I'm here and ready", etc.)
 *   2. Placeholder names ([User's Name], [Name], [Member], [Friend])
 *   3. Voice responses that exceed the sentence limit
 *
 * @param text - The raw model response
 * @param responseMode - "voice" or "text" (voice applies sentence limit)
 * @returns The sanitized response
 */
export function sanitizeResponse(
  text: string,
  responseMode: "text" | "voice" = "text",
): string {
  let result = text;

  // Strip placeholder names
  result = stripPlaceholders(result);

  // Strip readiness openings
  result = stripReadinessOpening(result);

  // For voice mode, limit to 3 sentences max for greetings/check-ins
  if (responseMode === "voice") {
    result = limitVoiceSentences(result, 3);
  }

  // Clean up leading/trailing whitespace
  result = result.trim();

  return result;
}
