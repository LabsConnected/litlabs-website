/**
 * Provider Registry + Basic Route Planner
 *
 * Provider-neutral routing for tool-calling LLM requests. OpenRouter is one
 * branch, not the backbone. The planner selects eligible routes for a request
 * based on:
 *   - cost policy        (Basic = FREE_MANAGED + LOCAL; USER_FUNDED only when
 *                         the user explicitly supplies a key; never LITT_PAID)
 *   - capabilities       (tools / vision / structured output / coding)
 *   - credential state   (env-resolved; secrets are never stored on routes)
 *   - provider health    (process-local circuit breaker: healthy / degraded /
 *                         cooldown / disabled)
 *   - quota state        (429 → limited, 402 → exhausted)
 *   - model hint         (user-selected model is a preference, not a pin)
 *
 * Ordering is a preference, not a fixed sequence: health and eligibility
 * filter first, then the base preference order applies. Degraded providers
 * are still eligible but rank after healthy ones.
 *
 * Failure classification is provider-neutral. The two scopes matter:
 *   - "provider" scope (401, 402, provider-403, 408/timeout, 429, 5xx,
 *     network) stops the WHOLE provider for this call and updates the
 *     circuit breaker — no more models are tried behind the same account.
 *   - "model" scope (400, 404, model-403) skips only that model inside the
 *     provider's own candidate list.
 *
 * This module contains NO secret values — only env-var names and presence
 * checks. Diagnostics report PRESENT/ABSENT, never key material.
 */

import "server-only";

import { resolveOllamaEndpoint, OLLAMA_ENDPOINT_ENV_VARS } from "@litt/models";
import {
  findModelRecord,
  getEligibleModels,
  resolveRegistryModel,
  validateEnvOverride,
} from "./model-registry";

// ─── Types ────────────────────────────────────────────────────────

export type CostClass = "FREE_MANAGED" | "LOCAL" | "USER_FUNDED" | "LITT_PAID";

export type ProviderHealthState = "healthy" | "degraded" | "cooldown" | "disabled";

export type CredentialState = "available" | "missing" | "invalid" | "not_required";

export type QuotaState = "available" | "limited" | "exhausted" | "unknown";

export interface ProviderCapabilities {
  tools: boolean;
  /** Explicit names for the capability contract used by agent routing. */
  supportsTools?: boolean;
  supportsNativeToolCalls?: boolean;
  vision: boolean;
  supportsVision?: boolean;
  structuredOutput: boolean;
  supportsStructuredOutput?: boolean;
  supportsStreaming?: boolean;
  coding: boolean;
}

export interface ProviderHealth {
  state: ProviderHealthState;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  cooldownUntil?: number;
  consecutiveFailures: number;
  /** Sanitized failure class that produced the current state (no secrets). */
  reason?: string;
}

export type FailureClass =
  | "auth_invalid" // 401 — credential revoked/invalid
  | "billing" // 402 — account credits/quota exhausted
  | "forbidden" // 403 — provider- or model-level rejection
  | "model_unavailable" // 400/404 — request/model rejected
  | "rate_limited" // 429 — honour Retry-After when present
  | "timeout" // 408 or local per-attempt timeout
  | "server_error" // 5xx
  | "bad_response" // malformed/empty provider payload
  | "tool_call_parse_failed" // model emitted text-format tool markup, not a structured call
  | "network" // fetch threw before a response
  | "aborted" // upstream/client abort — not a provider failure
  | "budget_exhausted"; // agent deadline — not a provider failure

export interface ProviderFailure {
  class: FailureClass;
  /** "provider" stops the provider for this call; "model" skips only the model. */
  scope: "provider" | "model";
  httpStatus?: number;
  retryAfterMs?: number;
  /** Sanitized — never contains request bodies, headers, or secrets. */
  message: string;
}

/** One eligible provider in the route plan. Secret-free by construction. */
export interface PlannedProvider {
  provider: string;
  adapter: "gemini" | "openai-compatible" | "ollama";
  costClass: CostClass;
  capabilities: ProviderCapabilities;
  /** Ordered candidate models within the provider (model-scope failures advance). */
  models: string[];
  /** Hard cap on a single provider attempt. */
  timeoutMs: number;
  health: ProviderHealthState;
  credentialState: CredentialState;
}

export interface RouteRequirements {
  tools: boolean;
  vision?: boolean;
  structuredOutput?: boolean;
  coding?: boolean;
  minContext?: number;
  /**
   * BUILD runs only: the initial model selection must start on a proven
   * file writer (registry reliableFileWriting). Chat-only or unproven
   * writers (e.g. cohere/north-mini-code:free) are excluded from the
   * attempt list up front, so a BUILD never starts on them and waits for
   * the 3-step demotion guard to rule them out. The demotion guard stays
   * as the safety net for mid-run degradation of the proven models.
   */
  reliableFileWriting?: boolean;
}

export interface RoutePlanOptions {
  /** User-facing model hint (e.g. the Studio model picker value). A preference,
   *  never a pin — paid or credential-less targets are ignored for Basic. */
  model?: string;
  /** BYOK: user-supplied key. Its presence opts the request into USER_FUNDED. */
  userApiKey?: string;
  /** BYOK: which provider the user's key belongs to. */
  byokProvider?: "openai" | "openai-compatible";
  /** BYOK: model override on the user's own account. */
  byokModel?: string;
  /** BYOK: base URL for openai-compatible endpoints. */
  byokBaseUrl?: string;
  /**
   * P1: Server-derived entitlement for managed paid providers.
   * NEVER accepted from client request input — must be derived from
   * the authenticated user's plan/owner status server-side.
   * When true, LITT_PAID providers (managed OpenAI) are eligible.
   * Default: false (deny).
   */
  allowLittPaidProviders?: boolean;
}

export interface RoutePlan {
  providers: PlannedProvider[];
  /** Providers that exist but were excluded, with a safe reason. */
  excluded: Array<{ provider: string; reason: string }>;
  /** Non-null when the requested model hint could not be honoured under the
   *  Basic cost policy (e.g. a paid OpenRouter slug). */
  droppedModelHint?: string;
}

// ─── Error carrying a classified provider failure ─────────────────

/** Thrown by adapters for HTTP/transport failures, pre-classified. */
export class ProviderAttemptError extends Error {
  constructor(
    public readonly provider: string,
    public readonly model: string,
    public readonly failure: ProviderFailure,
  ) {
    super(`${provider}/${model}: ${failure.message}`);
    this.name = "ProviderAttemptError";
  }
}

// ─── Provider definitions ─────────────────────────────────────────

const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000;

/** Tool-capable OpenRouter :free models. The canonical model registry owns
 *  ordering and eligibility (capability-verified, health-aware); the legacy
 *  candidates below stay as tail fallbacks for routes the registry does not
 *  manage yet. "qwen/qwen3-coder:free" is deliberately NOT listed — it 404s
 *  in prod (Sep 2026). */
const OPENROUTER_LEGACY_TAIL_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nex-agi/nex-n2.5-pro:free",
  "openrouter/free",
];

const TOOL_CAPABLE: ProviderCapabilities = {
  tools: true,
  supportsTools: true,
  supportsNativeToolCalls: true,
  vision: false,
  supportsVision: false,
  structuredOutput: true,
  supportsStructuredOutput: true,
  supportsStreaming: true,
  coding: true,
};

interface ProviderDef {
  provider: string;
  adapter: PlannedProvider["adapter"];
  costClass: CostClass;
  capabilities: ProviderCapabilities;
  timeoutMs: number;
  credentialState(): CredentialState;
  models(): string[];
}

function envPresent(...names: string[]): boolean {
  return names.some((n) => !!process.env[n]);
}

function openRouterModels(requirements?: RouteRequirements): string[] {
  // Registry-first ordering: capability-verified, health-aware models by
  // priority (qwen3.8-27b:free, gemma-4-31b-it:free, ...). Legacy free
  // candidates the registry does not manage stay as tail fallbacks; the
  // auto-router (openrouter/free) stays last — it picks small random models
  // that fail to emit tool calls (and is filtered out entirely when the
  // caller requires tools).
  //
  // BUILD initial selection (requirements.reliableFileWriting): only proven
  // file writers are listed — chat-only/unproven registry models and the
  // unknown legacy tail are excluded so a BUILD never starts on a model
  // that can read but never writes.
  const requireWriters = requirements?.reliableFileWriting === true;
  const registryIds = getEligibleModels({ tools: true, reliableFileWriting: requireWriters })
    .filter((r) => r.provider === "openrouter")
    .map((r) => r.providerModelId);
  const list = [...registryIds];
  if (!requireWriters) {
    for (const m of OPENROUTER_LEGACY_TAIL_MODELS) {
      if (!list.includes(m)) list.push(m);
    }
  }

  // OPENROUTER_MODEL override: validated against the registry, never used
  // as a raw string. Unknown or non-free values are rejected with an
  // explicit structured warning and the registry defaults are used.
  const override = (process.env.OPENROUTER_MODEL ?? "").trim();
  if (override) {
    if (override === "openrouter/free") {
      const idx = list.indexOf(override);
      if (idx >= 0) list.splice(idx, 1);
      list.unshift(override);
    } else if (override.endsWith(":free")) {
      // BUILD runs additionally require a proven file writer — a chat-only
      // override (e.g. north-mini-code) is rejected for BUILD routing with
      // an explicit warning instead of silently starting a doomed build.
      const check = validateEnvOverride("OPENROUTER_MODEL", override, {
        tools: true,
        reliableFileWriting: requireWriters,
      });
      if (check.valid) {
        const idx = list.indexOf(override);
        if (idx >= 0) list.splice(idx, 1);
        list.unshift(override);
      } else {
        logRegistryWarn("env_override_rejected", {
          envVar: "OPENROUTER_MODEL",
          value: override,
          reason: check.error,
        });
      }
    } else {
      // A paid OPENROUTER_MODEL would violate the Basic cost policy.
      logRegistryWarn("env_override_rejected", {
        envVar: "OPENROUTER_MODEL",
        value: override,
        reason: "not a :free route — paid slugs are refused under the Basic cost policy",
      });
    }
  }
  return list;
}

function providerDefs(requirements?: RouteRequirements): ProviderDef[] {
  return [
    {
      provider: "gemini",
      adapter: "gemini",
      costClass: "FREE_MANAGED",
      capabilities: { ...TOOL_CAPABLE, vision: true },
      timeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      credentialState: () =>
        envPresent("GEMINI_API_KEY", "GOOGLE_API_KEY") ? "available" : "missing",
      // Model IDs come from the canonical registry: env overrides are
      // validated (unknown strings rejected with a warning), otherwise the
      // registry defaults (gemini-flash-latest alias + gemini-2.5-flash).
      models: () => [
        resolveRegistryModel("GEMINI_PRIMARY_MODEL", "gemini-flash", {
          tools: true,
          reliableFileWriting: true,
        }).providerModelId,
        resolveRegistryModel("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash", {
          tools: true,
          reliableFileWriting: true,
        }).providerModelId,
      ],
    },
    {
      provider: "openrouter",
      adapter: "openai-compatible",
      costClass: "FREE_MANAGED",
      capabilities: TOOL_CAPABLE,
      // Free-tier OpenRouter models legitimately take 40s+ under load — the
      // shared 30s cap timed them out every attempt and churned the
      // provider into cooldown. Per-route cap only; the agent's absolute
      // deadline still bounds every attempt via computeAttemptTimeout.
      timeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS) || 60_000,
      credentialState: () => (envPresent("OPENROUTER_API_KEY") ? "available" : "missing"),
      models: () => openRouterModels(requirements),
    },
    {
      provider: "groq",
      adapter: "openai-compatible",
      costClass: "FREE_MANAGED",
      capabilities: TOOL_CAPABLE,
      timeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      credentialState: () => (envPresent("GROQ_API_KEY") ? "available" : "missing"),
      models: () => [
        process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        "openai/gpt-oss-120b",
      ],
    },
    {
      provider: "mistral",
      adapter: "openai-compatible",
      costClass: "FREE_MANAGED",
      capabilities: TOOL_CAPABLE,
      timeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      credentialState: () => (envPresent("MISTRAL_API_KEY") ? "available" : "missing"),
      models: () => [
        process.env.MISTRAL_MODEL || "mistral-small-latest",
        "open-mistral-nemo",
      ],
    },
    {
      provider: "cloudflare",
      adapter: "openai-compatible",
      costClass: "FREE_MANAGED",
      capabilities: TOOL_CAPABLE,
      timeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      credentialState: () =>
        envPresent("CLOUDFLARE_ACCOUNT_ID") && envPresent("CLOUDFLARE_AI_API_TOKEN")
          ? "available"
          : "missing",
      models: () => [
        process.env.CLOUDFLARE_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        "@cf/mistral/mistral-small-3.1-24b-instruct",
      ],
    },
    {
      provider: "ollama",
      adapter: "ollama",
      costClass: "LOCAL",
      // Model is resolved at attempt time from /api/tags — the registry
      // advertises tool support only for known tool-capable families.
      capabilities: { tools: true, vision: false, structuredOutput: false, coding: true },
      timeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      credentialState: () => "not_required",
      models: () => [process.env.OLLAMA_MODEL || "auto"],
    },
    {
      provider: "byok",
      adapter: "openai-compatible",
      costClass: "USER_FUNDED",
      capabilities: TOOL_CAPABLE,
      timeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      // Resolved against RoutePlanOptions.userApiKey in the planner.
      credentialState: () => "missing",
      models: () => [],
    },
    {
      // P1: Managed OpenAI fallback — LAST in route order.
      // Platform-managed credential (OPENAI_API_KEY), NOT user BYOK.
      // Only eligible when allowLittPaidProviders=true (server-derived
      // entitlement: owner or premiumModels). Default: denied.
      provider: "openai",
      adapter: "openai-compatible",
      costClass: "LITT_PAID",
      capabilities: TOOL_CAPABLE,
      timeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      credentialState: () =>
        envPresent("OPENAI_API_KEY") ? "available" : "missing",
      models: () => [
        process.env.OPENAI_MODEL || "gpt-4o",
      ],
    },
  ];
}

// ─── Ollama inclusion rule ────────────────────────────────────────
// Local Ollama is a legitimate zero-cost route when connected, but probing
// localhost on every request of a deployed web server is pointless. Include it
// when explicitly configured, or when running outside a deployed environment.

function ollamaIncluded(): boolean {
  if (process.env.LITT_DISABLE_OLLAMA) return false;
  if (OLLAMA_ENDPOINT_ENV_VARS.some((k) => !!process.env[k])) return true;
  const deployed = !!(
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_PROJECT_ID ||
    process.env.VERCEL
  );
  return !deployed;
}

// ─── Health store (process-local circuit breaker) ─────────────────

/** Auth/billing/provider-forbidden: long disable with safe re-probe window. */
const DISABLE_COOLDOWN_MS = 30 * 60_000;
/** 429 without a Retry-After hint. */
const RATE_LIMIT_DEFAULT_MS = 60_000;
const RATE_LIMIT_MAX_MS = 10 * 60_000;
/** Repeated transient failures (timeout/network/5xx). */
const TRANSIENT_COOLDOWN_MS = 60_000;
/** A single transient failure degrades; a second consecutive one cools down. */
const DEGRADE_THRESHOLD = 2;
/** Model-scope failures skip that model for a while, provider unaffected. */
const MODEL_COOLDOWN_MS = 10 * 60_000;

const providerHealth = new Map<string, ProviderHealth>();
const modelCooldowns = new Map<string, number>(); // "provider:model" → until

function defaultHealth(): ProviderHealth {
  return { state: "healthy", consecutiveFailures: 0 };
}

export function getProviderHealth(provider: string): ProviderHealth {
  const h = providerHealth.get(provider) ?? defaultHealth();
  // Cooldowns and disables are never global-forever: an expired window
  // re-admits the provider for a fresh probe.
  if ((h.state === "cooldown" || h.state === "disabled") && h.cooldownUntil && Date.now() >= h.cooldownUntil) {
    const recovered: ProviderHealth = {
      ...h,
      state: "healthy",
      cooldownUntil: undefined,
      consecutiveFailures: 0,
    };
    providerHealth.set(provider, recovered);
    return recovered;
  }
  return h;
}

export function isModelCoolingDown(provider: string, model: string): boolean {
  const until = modelCooldowns.get(`${provider}:${model}`);
  if (!until) return false;
  if (Date.now() >= until) {
    modelCooldowns.delete(`${provider}:${model}`);
    return false;
  }
  return true;
}

export function recordProviderSuccess(provider: string): void {
  providerHealth.set(provider, {
    state: "healthy",
    lastSuccessAt: Date.now(),
    consecutiveFailures: 0,
  });
}

export function recordProviderFailure(provider: string, failure: ProviderFailure): void {
  const prev = providerHealth.get(provider) ?? defaultHealth();
  const now = Date.now();
  const consecutive = prev.consecutiveFailures + 1;

  const next: ProviderHealth = {
    ...prev,
    lastFailureAt: now,
    consecutiveFailures: consecutive,
    reason: failure.class,
  };

  switch (failure.class) {
    case "auth_invalid":
    case "billing":
      next.state = "disabled";
      next.cooldownUntil = now + DISABLE_COOLDOWN_MS;
      break;
    case "forbidden":
      if (failure.scope === "provider") {
        next.state = "disabled";
        next.cooldownUntil = now + DISABLE_COOLDOWN_MS;
      }
      break;
    case "rate_limited": {
      const wait = Math.min(failure.retryAfterMs ?? RATE_LIMIT_DEFAULT_MS, RATE_LIMIT_MAX_MS);
      next.state = "cooldown";
      next.cooldownUntil = now + wait;
      break;
    }
    case "timeout":
    case "network":
    case "server_error":
    case "bad_response":
    case "tool_call_parse_failed":
      next.state = consecutive >= DEGRADE_THRESHOLD ? "cooldown" : "degraded";
      if (next.state === "cooldown") next.cooldownUntil = now + TRANSIENT_COOLDOWN_MS;
      break;
    default:
      break;
  }

  providerHealth.set(provider, next);
}

export function recordModelFailure(provider: string, model: string): void {
  modelCooldowns.set(`${provider}:${model}`, Date.now() + MODEL_COOLDOWN_MS);
}

/** Test seam: clear all circuit-breaker state. */
export function _resetProviderHealthForTests(): void {
  providerHealth.clear();
  modelCooldowns.clear();
}

export interface ProviderDiagnostic {
  state: ProviderHealthState;
  credential: CredentialState;
  costClass: CostClass;
  cooldownUntil?: number;
  consecutiveFailures: number;
  reason?: string;
}

/** Safe diagnostics snapshot — presence/state only, never secrets. */
export function providerDiagnostics(): Record<string, ProviderDiagnostic> {
  const out: Record<string, ProviderDiagnostic> = {};
  for (const def of providerDefs()) {
    const h = getProviderHealth(def.provider);
    out[def.provider] = {
      state: h.state,
      credential: def.credentialState(),
      costClass: def.costClass,
      cooldownUntil: h.cooldownUntil,
      consecutiveFailures: h.consecutiveFailures,
      reason: h.reason,
    };
  }
  return out;
}

// ─── Failure classification ───────────────────────────────────────

function sanitizeBody(text: string): string {
  // Keep a bounded, secret-free snippet for diagnostics. Auth headers and
  // request bodies are never part of provider error payloads we read here,
  // but strip anything that looks like a token just in case.
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-<redacted>")
    .replace(/key-[A-Za-z0-9_-]+/g, "key-<redacted>")
    .replace(/(token|secret|password)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, "$1=<redacted>")
    .slice(0, 300);
}

/** Structured warning line for registry rejections (var name, value, reason). */
function logRegistryWarn(event: string, fields: Record<string, unknown>): void {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.warn(`[model-registry] ${event} ${parts}`);
}

export function parseRetryAfterMs(headers: Headers | null | undefined, bodyText: string): number | undefined {
  const raw = headers?.get("retry-after");
  if (raw) {
    const secs = Number(raw);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const when = Date.parse(raw);
    if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  }
  // OpenRouter/Gemini embed "retryDelay": "17s" or Retry-After inside JSON.
  const m = bodyText.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i) ?? bodyText.match(/retry[-_ ]?after\D{0,12}([\d.]+)\s*s/i);
  if (m) {
    const secs = Number(m[1]);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  }
  return undefined;
}

export function classifyHttpFailure(
  status: number,
  bodyText: string,
  retryAfterMs?: number,
): ProviderFailure {
  const message = sanitizeBody(bodyText) || `HTTP ${status}`;
  switch (status) {
    case 400: {
      // Evidence-based split (Sep 2026 P0): Google returns HTTP 400 — NOT
      // 401 — for dead API keys, with "API key not valid" in the body.
      // Treating every 400 as model_unavailable burned the model cooldown
      // while the dead credential kept failing. Key-shaped 400s disable
      // the provider; everything else stays model-scoped.
      if (/api[_\s-]?key not valid|invalid api[_\s-]?key|api[_\s-]?key.{0,40}invalid/i.test(bodyText)) {
        return { class: "auth_invalid", scope: "provider", httpStatus: status, message };
      }
      return { class: "model_unavailable", scope: "model", httpStatus: status, message };
    }
    case 404:
      return { class: "model_unavailable", scope: "model", httpStatus: status, message };
    case 401:
      return { class: "auth_invalid", scope: "provider", httpStatus: status, message };
    case 402:
      return { class: "billing", scope: "provider", httpStatus: status, message };
    case 403: {
      // Dead/revoked keys sometimes surface as 403 with auth-shaped bodies
      // ("API key not valid", "invalid credential", "unauthenticated").
      // Classify those as auth_invalid so the dead CREDENTIAL is disabled,
      // not the model. A body that names the model stays model-scoped.
      const authShaped =
        /api[_\s-]?key.{0,40}(not valid|invalid|revoked|expired)|invalid[_\s-]?credential|unauthenticated|unauthorized/i.test(
          bodyText,
        );
      const modelShaped = /\bmodel\b|deployment|not.?supported|does not exist/i.test(bodyText);
      if (authShaped && !modelShaped) {
        return { class: "auth_invalid", scope: "provider", httpStatus: status, message };
      }
      // Narrowest proven scope: a body that names the model is a model-level
      // rejection; anything about keys/accounts/permissions is provider-level.
      const modelScoped =
        modelShaped && !/key|credential|account|permission|auth|forbidden to access/i.test(bodyText);
      return {
        class: "forbidden",
        scope: modelScoped ? "model" : "provider",
        httpStatus: status,
        message,
      };
    }
    case 408:
      return { class: "timeout", scope: "provider", httpStatus: status, message };
    case 429:
      return {
        class: "rate_limited",
        scope: "provider",
        httpStatus: status,
        retryAfterMs,
        message,
      };
    default:
      if (status >= 500) {
        return { class: "server_error", scope: "provider", httpStatus: status, message };
      }
      // Unknown non-2xx: treat as model-scoped so we don't disable a provider
      // over an unrecognised rejection.
      return { class: "model_unavailable", scope: "model", httpStatus: status, message };
  }
}

const STATUS_IN_MESSAGE = /\b([1-5]\d\d)\b/;

/** Classify an adapter throw that is NOT a ProviderAttemptError — network
 *  errors, SDK/seam throws that embed a status in the message, timeouts. */
export function classifyThrownFailure(err: unknown): ProviderFailure {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  if (/timed out after/i.test(msg) || name === "TimeoutError") {
    return { class: "timeout", scope: "provider", message: sanitizeBody(msg) };
  }
  if (/aborted by upstream/i.test(msg)) {
    return { class: "aborted", scope: "provider", message: "aborted by upstream" };
  }
  if (name === "AbortError" || /AbortError|The operation was aborted/i.test(msg)) {
    // AbortError without the upstream marker = per-attempt timeout fired.
    return { class: "timeout", scope: "provider", message: sanitizeBody(msg) };
  }
  if (/429|too many requests|rate.?limit/i.test(msg)) {
    const m = msg.match(/(\d+)\s*s(?:econds?)?/i);
    return {
      class: "rate_limited",
      scope: "provider",
      retryAfterMs: m ? Number(m[1]) * 1000 : undefined,
      message: sanitizeBody(msg),
    };
  }
  const statusMatch = msg.match(STATUS_IN_MESSAGE);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status >= 400 && status < 600) return classifyHttpFailure(status, msg);
  }
  return { class: "network", scope: "provider", message: sanitizeBody(msg) };
}

// ─── Model-hint resolution ────────────────────────────────────────

type ModelHint =
  | { kind: "route"; provider: string; model: string }
  | { kind: "paid"; model: string }
  | { kind: "unsupported-byok"; model: string }
  | null;

function resolveModelHint(model: string | undefined): ModelHint {
  if (!model) return null;
  const m = model.trim();
  if (!m || m === "auto" || m.startsWith("litt-")) return null; // LiTT aliases → auto
  if (m === "openrouter/free" || m.endsWith(":free")) return { kind: "route", provider: "openrouter", model: m };
  if (m.startsWith("@cf/")) return { kind: "route", provider: "cloudflare", model: m };
  if (m.startsWith("gemini") && !m.includes("/")) return { kind: "route", provider: "gemini", model: m };
  if (m.startsWith("google/gemini")) return { kind: "route", provider: "gemini", model: m.replace(/^google\//, "") };
  if (/^(llama|mixtral|gemma|whisper|deepseek-r1-distill|qwen)/i.test(m) && !m.includes("/")) {
    return { kind: "route", provider: "groq", model: m };
  }
  // Groq namespaced models (e.g. openai/gpt-oss-120b, openai/gpt-oss-20b) are Groq, not BYOK
  if (/^openai\/gpt-oss/i.test(m)) {
    return { kind: "route", provider: "groq", model: m };
  }
  if (/^(mistral|codestral|pixtral|ministral|open-mistral|open-codestral)/i.test(m) && !m.includes("/")) {
    return { kind: "route", provider: "mistral", model: m };
  }
  if (/^(gpt-|o\d|chatgpt-|openai$)/i.test(m) || m.startsWith("openai/")) {
    return { kind: "route", provider: "byok", model: m.replace(/^openai\//, "") };
  }
  if (/^claude|^anthropic\//i.test(m)) return { kind: "unsupported-byok", model: m };
  if (m.includes("/")) return { kind: "paid", model: m }; // vendor/model slug → OpenRouter paid
  return null; // unknown → auto
}

// ─── Route planning ───────────────────────────────────────────────

export function planBasicRoutes(
  requirements: RouteRequirements,
  opts: RoutePlanOptions = {},
): RoutePlan {
  const excluded: RoutePlan["excluded"] = [];
  const providers: PlannedProvider[] = [];
  const hint = resolveModelHint(opts.model);
  let droppedModelHint: string | undefined;

  for (const def of providerDefs(requirements)) {
    // Cost policy — LITT_PAID routes require explicit server-derived
    // entitlement (allowLittPaidProviders). Default: deny.
    // USER_FUNDED routes require the user to supply a key this request.
    if (def.costClass === "LITT_PAID" && !opts.allowLittPaidProviders) {
      excluded.push({ provider: def.provider, reason: "litt_paid_not_allowed_for_basic" });
      continue;
    }
    if (def.costClass === "USER_FUNDED" && !opts.userApiKey) {
      excluded.push({ provider: def.provider, reason: "user_funded_requires_user_key" });
      continue;
    }
    if (def.provider === "byok") {
      if (opts.byokProvider && opts.byokProvider !== "openai" && opts.byokProvider !== "openai-compatible") {
        excluded.push({ provider: def.provider, reason: "byok_provider_not_supported_for_tools" });
        continue;
      }
    }
    if (def.provider === "ollama" && !ollamaIncluded()) {
      excluded.push({ provider: def.provider, reason: "ollama_not_configured_or_deployed" });
      continue;
    }
    // P1 launch: Gemini billing depleted (HTTP 402). Explicitly skip Gemini
    // via GEMINI_DISABLED=true — do not rely on health checks.
    if (def.provider === "gemini" && process.env.GEMINI_DISABLED === "true") {
      excluded.push({ provider: def.provider, reason: "gemini_disabled_by_config" });
      continue;
    }

    const cred = def.provider === "byok" ? ("available" as CredentialState) : def.credentialState();
    if (cred === "missing" || cred === "invalid") {
      excluded.push({ provider: def.provider, reason: `credential_${cred}` });
      continue;
    }

    const caps = def.capabilities;
    if (requirements.tools && !(caps.supportsTools ?? caps.tools)) {
      excluded.push({ provider: def.provider, reason: "missing_capability_tools" });
      continue;
    }
    if (requirements.tools && !(caps.supportsNativeToolCalls ?? caps.tools)) {
      excluded.push({ provider: def.provider, reason: "missing_capability_native_tool_calls" });
      continue;
    }
    if (requirements.vision && !caps.vision) {
      excluded.push({ provider: def.provider, reason: "missing_capability_vision" });
      continue;
    }
    if (requirements.structuredOutput && !caps.structuredOutput) {
      excluded.push({ provider: def.provider, reason: "missing_capability_structured_output" });
      continue;
    }

    const health = getProviderHealth(def.provider);
    if (health.state === "disabled" || health.state === "cooldown") {
      excluded.push({
        provider: def.provider,
        reason: `health_${health.state}${health.reason ? `:${health.reason}` : ""}`,
      });
      continue;
    }

    let models = def.models();
    if (def.provider === "byok") {
      models = [opts.byokModel || process.env.OPENAI_MODEL || "gpt-4o"];
    }
    // The OpenRouter auto-router ("openrouter/free") delegates to a random
    // small model that consistently fails to emit structured tool calls.
    // When the caller requires tool execution, remove it from the candidate
    // list so only the explicitly-named free models (nvidia/nemotron, etc.)
    // are attempted. If those also fail to call tools, the launch-flow
    // re-prompt produces a clear error rather than silently returning prose.
    if (def.provider === "openrouter" && requirements.tools) {
      models = models.filter((m) => m !== "openrouter/free");
    }
    if (hint?.kind === "route" && hint.provider === def.provider) {
      // Honour the requested model first inside its provider when it is
      // eligible under the cost policy (free OR models, direct providers).
      // NOTE: Do NOT remove the model from the candidate list when dropping
      // the hint — it must remain available as a normal candidate.
      const idx = models.indexOf(hint.model);
      if (def.provider === "openrouter" && requirements.tools && hint.model === "openrouter/free") {
        // An explicit hint must not resurrect the auto-router the tools
        // filter just removed — it cannot emit tool calls. Surface the
        // drop so the caller can report it instead of silently swapping.
        droppedModelHint = opts.model;
      } else if (
        requirements.reliableFileWriting === true &&
        findModelRecord(def.provider, hint.model)?.capabilities.reliableFileWriting !== true
      ) {
        // A BUILD run must not start on a hinted model that is not a proven
        // file writer (chat-only or unknown) — drop the hint priority so
        // routing starts on a proven writer, but KEEP the model in the
        // candidate list. Surface the drop instead of silently swapping.
        droppedModelHint = opts.model;
      } else if (idx >= 0) {
        // Move hinted model to front (only when honouring the hint)
        models.splice(idx, 1);
        models.unshift(hint.model);
      }
    }

    providers.push({
      provider: def.provider,
      adapter: def.adapter,
      costClass: def.costClass,
      capabilities: caps,
      models,
      timeoutMs: def.timeoutMs,
      health: health.state,
      credentialState: cred,
    });
  }

  if (hint?.kind === "paid" || hint?.kind === "unsupported-byok") {
    droppedModelHint = hint.model;
  } else if (
    hint?.kind === "route" &&
    !providers.some((p) => p.provider === hint.provider)
  ) {
    // The hinted route exists but isn't eligible this call (e.g. a byok
    // model without a user key, or a provider whose credential is missing).
    droppedModelHint = opts.model;
  }

  // Preferred route first: the provider carrying the honoured model hint
  // moves to the front, then healthy before degraded, preserving base order.
  const hintedProvider = hint?.kind === "route" ? hint.provider : undefined;
  providers.sort((a, b) => {
    const aHint = a.provider === hintedProvider ? 0 : 1;
    const bHint = b.provider === hintedProvider ? 0 : 1;
    if (aHint !== bHint) return aHint - bHint;
    const aDeg = a.health === "degraded" ? 1 : 0;
    const bDeg = b.health === "degraded" ? 1 : 0;
    return aDeg - bDeg;
  });

  return { providers, excluded, droppedModelHint };
}

/** Resolve the Ollama endpoint for adapters (kept here so the executor never
 *  re-implements env precedence). */
export function resolveBasicOllamaEndpoint(): string {
  return resolveOllamaEndpoint((key) => process.env[key]);
}
