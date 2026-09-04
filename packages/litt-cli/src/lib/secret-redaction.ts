/**
 * Secret redaction utilities — ensures secrets never appear in stdout,
 * stderr, logs, run results, or any CLI output.
 *
 * Patterns covered:
 *   - Stripe live secret keys:  sk_live_...
 *   - Stripe test secret keys:  sk_test_...
 *   - Stripe webhook secrets:   whsec_...
 *   - Stripe publishable keys are NOT redacted (they are public by design)
 *   - Clerk secret keys:        sk_live_... (same pattern as Stripe)
 *   - Supabase service keys:    sb_secret_...
 *   - Generic API keys:         patterns with _API_KEY= followed by long values
 *
 * This module is the single source of truth for secret redaction.
 * Every production command uses redact() on any string that might
 * contain secret material before printing, logging, or storing it.
 */

/** Patterns that match secret material. Order matters — more specific first. */
const SECRET_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  // Stripe live/test secret keys (sk_live_..., sk_test_...)
  { pattern: /sk_(live|test)_[A-Za-z0-9]{10,}/g, label: "sk_***" },
  // Stripe webhook signing secrets (whsec_...)
  { pattern: /whsec_[A-Za-z0-9]{10,}/g, label: "whsec_***" },
  // Supabase service role keys
  { pattern: /sb_secret_[A-Za-z0-9_\-]{10,}/g, label: "sb_secret_***" },
  // Clerk secret keys (sk_ prefix, same as Stripe — already covered above)
  // Railway auth tokens (long hex strings after specific env var names)
  { pattern: /(RAILWAY_TOKEN=)[A-Za-z0-9_\-]{20,}/g, label: "$1***" },
  // Generic API key env var assignments (KEY=value where value is long)
  { pattern: /((?:API_KEY|SECRET_KEY|AUTH_SECRET|SERVICE_KEY|ACCESS_KEY|PRIVATE_KEY)=)[A-Za-z0-9_\-\.]{20,}/g, label: "$1***" },
  // Bearer tokens in Authorization headers
  { pattern: /(Bearer\s+)[A-Za-z0-9_\-\.]{20,}/g, label: "$1***" },
];

/**
 * Redact all known secret patterns from a string.
 * Returns a new string with secrets replaced by redacted labels.
 *
 * This is pure — it does not mutate the input and has no side effects.
 * It is safe to call on any string, including user input, error messages,
 * log lines, command output, and exception text.
 */
export function redact(input: string): string {
  let result = input;
  for (const { pattern, label } of SECRET_PATTERNS) {
    result = result.replace(pattern, label);
  }
  return result;
}

/**
 * Check if a string contains any unredacted secret patterns.
 * Returns true if at least one secret pattern is found.
 *
 * Used by tests to verify that redaction is complete.
 */
export function containsSecret(input: string): boolean {
  for (const { pattern } of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    if (pattern.test(input)) return true;
  }
  return false;
}

/**
 * Redact a value if it looks like a secret, otherwise return as-is.
 * Used for env var values where we only want to show presence, not content.
 *
 * Returns:
 *   - "SET" if the value matches a secret pattern
 *   - "SET (length: N)" if the value is long but doesn't match a known pattern
 *   - The original value if it's short and doesn't match any pattern
 *   - "NOT SET" if the value is empty/undefined
 */
export function redactEnvValue(value: string | undefined): string {
  if (!value || value.length === 0) return "NOT SET";
  if (containsSecret(value)) return "SET";
  if (value.length > 50) return `SET (length: ${value.length})`;
  return value;
}

/**
 * Assert that a string is safe to output (contains no secrets).
 * Throws if any secret pattern is found.
 *
 * Used in tests to enforce the redaction contract.
 */
export function assertNoSecrets(input: string, context?: string): void {
  if (containsSecret(input)) {
    const ctx = context ? ` in ${context}` : "";
    throw new Error(
      `Secret material detected${ctx}. Use redact() before outputting.`,
    );
  }
}
