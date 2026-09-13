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

// ─── Types ────────────────────────────────────────────────────────

export type CostClass = "FREE_MANAGED" | "LOCAL" | "USER_FUNDED" | "LITT_PAID";

export type ProviderHealthState = "healthy" | "degraded" | "cooldown" | "disabled";

export type CredentialState = "available" | "missing" | "invalid" | "not_required";

export type QuotaState = "available" | "limited" | "exhausted" | "unknown";

export interface ProviderCapabilities {
  tools: boolean;
  vision: boolean;
  structuredOutput: boolean;
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

/** Tool-capable OpenRouter :free models + the free auto-router. Paid slugs are
 *  never included: under the Basic cost policy they would be LITT_PAID. */
const OPENROUTER_FREE_MODELS = [
  "openrouter/free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen-2.5-coder-32b-instruct:free",
  "deepseek/deepseek-chat:free",
];

const TOOL_CAPABLE: ProviderCapabilities = {
  tools: true,
  vision: false,
  structuredOutput: true,
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

function openRouterModels(): string[] {
  // Honour an explicit override only when it is a free route — a paid
  // OPENROUTER_MODEL would violate the Basic cost policy.
  const override = process.env.OPENROUTER_MODEL;
  const list = [...OPENROUTER_FREE_MODELS];
  if (override && (override === "openrouter/free" || override.endsWith(":free"))) {
    const idx = list.indexOf(override);
    if (idx >= 0) list.splice(idx, 1);
    list.unshift(override);
  }
  return list;
}

function providerDefs(): ProviderDef[] {
  return [
    {
      provider: "gemini",
      adapter: "gemini",
      costClass: "FREE_MANAGED",
      capabilities: { ...TOOL_CAPABLE, vision: true },
      timeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      credentialState: () =>
        envPresent("GEMINI_API_KEY", "GOOGLE_API_KEY") ? "available" : "missing",
      models: () => [
        process.env.GEMINI_PRIMARY_MODEL || "gemini-2.5-flash",
        process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite",
      ],
    },
    {
      provider: "openrouter",
      adapter: "openai-compatible",
      costClass: "FREE_MANAGED",
      capabilities: TOOL_CAPABLE,
      timeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      credentialState: () => (envPresent("OPENROUTER_API_KEY") ? "available" : "missing"),
      models: openRouterModels,
    },
    {
      provider: "groq",
      adapter: "openai-compatible",
      costClass: "FREE_MANAGED",
      capabilities: TOOL_CAPABLE,
      timeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      credentialState: () => (envPresent("GROQ_API_KEY") ? "available" : "missing"),
      models: () => [
        process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
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
    .slice(0, 300);
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
    case 400:
    case 404:
      return { class: "model_unavailable", scope: "model", httpStatus: status, message };
    case 401:
      return { class: "auth_invalid", scope: "provider", httpStatus: status, message };
    case 402:
      return { class: "billing", scope: "provider", httpStatus: status, message };
    case 403: {
      // Narrowest proven scope: a body that names the model is a model-level
      // rejection; anything about keys/accounts/permissions is provider-level.
      const modelScoped = /\bmodel\b|deployment|not.?supported|does not exist/i.test(bodyText)
        && !/key|credential|account|permission|auth|forbidden to access/i.test(bodyText);
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
  if (/^(llama|mixtral|gemma|whisper|deepseek-r1-distill|qwen|openai\/gpt-oss)/i.test(m) && !m.includes("/")) {
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

  for (const def of providerDefs()) {
    // Cost policy — the Basic router never auto-uses LITT_PAID routes and
    // only uses USER_FUNDED routes when the user supplied a key this request.
    if (def.costClass === "LITT_PAID") {
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

    const cred = def.provider === "byok" ? ("available" as CredentialState) : def.credentialState();
    if (cred === "missing" || cred === "invalid") {
      excluded.push({ provider: def.provider, reason: `credential_${cred}` });
      continue;
    }

    const caps = def.capabilities;
    if (requirements.tools && !caps.tools) {
      excluded.push({ provider: def.provider, reason: "missing_capability_tools" });
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
    if (hint?.kind === "route" && hint.provider === def.provider) {
      // Honour the requested model first inside its provider when it is
      // eligible under the cost policy (free OR models, direct providers).
      const idx = models.indexOf(hint.model);
      if (idx >= 0) models.splice(idx, 1);
      models.unshift(hint.model);
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
