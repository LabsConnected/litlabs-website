/**
 * The ONE canonical Ollama endpoint resolver.
 *
 * Every code path that needs to know where Ollama lives — local lane probing,
 * provider discovery, /api/tags, ModelRuntime, provider transport, health
 * checks, diagnostics — MUST call this function. No other module should
 * hardcode `localhost:11434` or invent its own env-var precedence.
 *
 * Env-var precedence (highest → lowest):
 *   1. LITT_OLLAMA_URL   — LiTT canonical override (full URL or bare host:port)
 *   2. OLLAMA_HOST       — Ollama host setting (full URL or bare host:port)
 *   3. OLLAMA_BASE_URL   — compatibility alias (full URL or bare host:port)
 *
 * Only when none of these are set does the resolver default to
 * `http://localhost:11434`.
 *
 * Design rules:
 *   - Never reads process.env directly. The caller passes an env getter.
 *   - Bare host:port (e.g. `192.168.0.77:11434`) is normalized to
 *     `http://192.168.0.77:11434`.
 *   - Trailing slashes are stripped.
 *   - A bare scheme like `http://` without a host is treated as unset.
 */

/** The default Ollama endpoint when no env var is configured. */
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/**
 * Env-var names checked, in priority order. Exported for tests and
 * diagnostics so callers can verify which variable was honoured.
 */
export const OLLAMA_ENDPOINT_ENV_VARS = [
  "LITT_OLLAMA_URL",
  "OLLAMA_HOST",
  "OLLAMA_BASE_URL",
] as const;

/** The env-getter signature — matches the EnvAccessor from discovery.ts
 * without creating a circular import.
 */
export type EnvGetter = (key: string) => string | undefined;

/** Normalize a raw endpoint value into a full URL.
 *
 * - `undefined` / empty / whitespace-only → `null` (treat as unset)
 * - `http://host:port` or `https://host:port` → strip trailing slashes
 * - `host:port` → prepend `http://`
 * - `http://` alone → `null` (no host, treat as unset)
 */
export function normalizeOllamaEndpoint(raw: string | undefined): string | null {
  const trimmed = raw?.trim().replace(/\/+$/, "");
  if (!trimmed || /[\s\\?#@]/.test(trimmed)) return null;

  const hasScheme = /^https?:\/\//i.test(trimmed);
  // Bare endpoints must be host[:port], including bracketed IPv6. Only
  // explicit URLs may carry a reverse-proxy path prefix.
  if (!hasScheme && !/^(?:[\w.-]+|\[[\da-f:]+\])(?::\d+)?$/i.test(trimmed)) {
    return null;
  }
  if (/^https?$/i.test(trimmed)) return null;

  try {
    const url = new URL(hasScheme ? trimmed : `http://${trimmed}`);
    if (!url.hostname || url.port === "0") return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Resolve the Ollama base URL (no path suffix).
 *
 * Returns the full base URL, e.g. `http://192.168.0.77:11434`.
 * Falls back to `DEFAULT_OLLAMA_URL` (`http://localhost:11434`) when
 * no env var is set.
 *
 * @param getEnv  Env getter (e.g. `envAccessorFromProcess().get` or `(k) => process.env[key]`).
 * @param override  Optional explicit override (skips env resolution). Used by tests
 *                  and by callers that already have the endpoint.
 */
export function resolveOllamaEndpoint(
  getEnv: EnvGetter,
  override?: string,
): string {
  if (override) {
    const normalized = normalizeOllamaEndpoint(override);
    if (normalized) return normalized;
  }

  for (const key of OLLAMA_ENDPOINT_ENV_VARS) {
    const raw = getEnv(key);
    const normalized = normalizeOllamaEndpoint(raw);
    if (normalized) return normalized;
  }

  return DEFAULT_OLLAMA_URL;
}

/** Resolve the Ollama `/api/tags` URL (for model discovery + health checks). */
export function resolveOllamaTagsUrl(
  getEnv: EnvGetter,
  override?: string,
): string {
  return `${resolveOllamaEndpoint(getEnv, override)}/api/tags`;
}

/** Resolve the Ollama `/api/chat` URL (for chat completions). */
export function resolveOllamaChatUrl(
  getEnv: EnvGetter,
  override?: string,
): string {
  return `${resolveOllamaEndpoint(getEnv, override)}/api/chat`;
}

/** Resolve the Ollama OpenAI-compatible `/v1/chat/completions` URL.
 *
 * Ollama exposes an OpenAI-compatible endpoint at `/v1/chat/completions`.
 * The CLI's `openAiCompatibleLocalEndpoint()` uses this for the
 * OpenAI-compatible adapter path.
 */
export function resolveOllamaOpenAiChatUrl(
  getEnv: EnvGetter,
  override?: string,
): string {
  return `${resolveOllamaEndpoint(getEnv, override)}/v1/chat/completions`;
}

/** Diagnostic helper: which env var was actually honoured?
 *
 * Returns the first env-var name that produced a valid endpoint, or
 * `"default"` if none were set.
 */
export function ollamaEndpointSource(
  getEnv: EnvGetter,
  override?: string,
): string {
  if (override) {
    const normalized = normalizeOllamaEndpoint(override);
    if (normalized) return "override";
  }

  for (const key of OLLAMA_ENDPOINT_ENV_VARS) {
    const raw = getEnv(key);
    if (normalizeOllamaEndpoint(raw)) return key;
  }

  return "default";
}
