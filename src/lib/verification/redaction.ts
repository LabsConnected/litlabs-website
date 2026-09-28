/**
 * LiTT Verification Foundation — secret redaction.
 *
 * Redaction happens BEFORE persistence. Evidence/log/artifact metadata must
 * never persist raw secrets. Pure: no I/O.
 */

export const REDACTED = "[REDACTED]";

/**
 * Patterns matched against string values. Each pattern is deliberately
 * conservative: it must match real secret shapes while avoiding common
 * prose. All replacements are total (no partial secret survives).
 */
const SECRET_PATTERNS: RegExp[] = [
  // Stripe-style / generic sk- keys: sk- prefix + 16+ alphanumerics/hyphens
  // (covers sk-live-..., sk-test-..., sk-ant-... shapes)
  /\bsk-[A-Za-z0-9-]{16,}\b/g,
  // GitHub tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // AWS access key ids
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Private key blocks (any content between markers)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Bearer tokens in headers or prose
  /\b[bB]earer\s+[A-Za-z0-9\-._~+/=]{12,}/g,
  // Authorization header values
  /\b[Aa]uthorization\s*:\s*[^\s,;}"']{8,}/g,
  // key=value style secrets: api_key, apikey, secret, password, token, etc.
  /\b(api[_-]?key|apikey|client[_-]?secret|consumer[_-]?secret|secret|password|passwd|pwd|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|private[_-]?token|webhook[_-]?secret)\b\s*[:=]\s*("([^"]{4,})"|'([^']{4,})'|([^\s,;}"']{6,}))/gi,
  // OpenAI-style org/project keys are covered by sk- above; OpenRouter etc:
  /\bor-[A-Za-z0-9]{16,}\b/g,
];

const SECRET_KEY_NAMES = new Set(
  [
    "api_key",
    "apikey",
    "api_secret",
    "client_secret",
    "consumer_secret",
    "secret",
    "password",
    "passwd",
    "pwd",
    "auth_token",
    "access_token",
    "refresh_token",
    "session_token",
    "private_token",
    "bearer_token",
    "webhook_secret",
    "signing_secret",
    "db_password",
    "database_url",
    "connection_string",
  ].map((s) => s.toLowerCase()),
);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, "_");
}

/** Redact secrets inside a single string. */
export function redactString(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/**
 * Deep-redact any JSON-compatible value. Object keys whose normalized name
 * looks like a secret key have their entire value replaced, in addition to
 * pattern-based string scrubbing.
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactString(value) as T;
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_NAMES.has(normalizeKey(k))) {
        out[k] = REDACTED;
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

/**
 * Returns true when a value still contains secret-like content AFTER
 * redaction — i.e. the redactor missed something. A key whose value is
 * exactly the REDACTED marker counts as safe. Used by tests to prove the
 * redaction contract: `redactDeep(x)` must always satisfy
 * `!containsSecretLike(redactDeep(x))`.
 */
export function containsSecretLike(value: unknown): boolean {
  if (typeof value === "string") {
    if (value === REDACTED) return false;
    for (const pattern of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(value)) return true;
    }
    return false;
  }
  if (Array.isArray(value)) return value.some((v) => containsSecretLike(v));
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([k, v]) => {
      if (v === REDACTED) return false;
      if (SECRET_KEY_NAMES.has(normalizeKey(k))) {
        // A secret-named key is only a leak when its value is non-empty
        // and not already the redaction marker.
        return v !== null && v !== undefined && v !== "";
      }
      return containsSecretLike(v);
    });
  }
  return false;
}

/**
 * Assert that a value is safe to persist. Throws when secret-like content
 * is detected. Call sites use this as a fail-closed gate before writes.
 */
export function assertNoSecrets(value: unknown, context: string): void {
  if (containsSecretLike(value)) {
    throw new Error(
      `[verification] secret-like content detected and refused persistence (${context})`,
    );
  }
}
