/**
 * Canonical Model Registry
 *
 * The single source of truth for which AI models LiTT may route to, what
 * they can do, and how healthy they are. This replaces scattered hardcoded
 * model strings (e.g. "gemini-3.6-flash", "gemini-2.5-flash-lite") with
 * capability-verified, health-aware lookups.
 *
 * Design notes:
 * - A ModelRecord carries the STABLE internal canonicalId plus the exact
 *   providerModelId string sent to the provider API. Aliases (like
 *   "gemini-flash-latest") self-heal at the provider; the registry pins
 *   the alias, never a versioned slug that rots.
 * - reliableFileWriting is EVIDENCE-based: it is true only for models proven
 *   to emit file-writing tool calls (files.write / apply_patch / edit).
 *   cohere/north-mini-code:free reads but never writes — it stays
 *   chat-eligible and is NEVER selected for BUILD.
 * - Health is process-local and learned: success → healthy; 3 consecutive
 *   failures → unhealthy (excluded from eligibility until a success is
 *   recorded elsewhere, e.g. a chat route).
 * - Env overrides (GEMINI_PRIMARY_MODEL etc.) are VALIDATED against the
 *   registry, never used as raw strings. Unknown values are rejected with
 *   an explicit structured warning and the registry default is used.
 *
 * This module holds NO secrets and imports nothing from the routing layer,
 * so provider-registry, llm-tool-calling, and agent-loop-v2 can all import
 * it without cycles.
 */

import "server-only";

// ─── Types ────────────────────────────────────────────────────────

export type ModelProvider = "gemini" | "openrouter" | "ollama" | string;

export type ModelHealthState = "unknown" | "healthy" | "degraded" | "unhealthy";

export type ModelConfigSource = "code-default" | "env-override" | "registry";

export interface ModelCapabilities {
  text: boolean;
  structuredOutput: boolean;
  toolCalling: boolean;
  /** CRITICAL: proven to emit file-writing tool calls. Chat-only models
   *  (e.g. north-mini-code) have this FALSE and are never BUILD models. */
  reliableFileWriting: boolean;
  vision: boolean;
  contextWindow: number;
}

export interface ModelRecord {
  provider: ModelProvider;
  /** Stable internal ID, e.g. "gemini-flash", "openrouter-qwen3.8-27b". */
  canonicalId: string;
  /** Exact string sent to the provider API. */
  providerModelId: string;
  enabled: boolean;
  capabilities: ModelCapabilities;
  /** Lower = preferred. */
  priority: number;
  health: {
    state: ModelHealthState;
    lastChecked: string;
    /** Redacted — error class + sanitized detail only, never key material. */
    lastError: string;
  };
  configSource: ModelConfigSource;
}

/** Capability subset a caller can require. Field names mirror the caller's
 *  vocabulary (tools / reliableFileWriting / vision / ...). */
export interface CapabilityRequirements {
  tools?: boolean;
  reliableFileWriting?: boolean;
  vision?: boolean;
  structuredOutput?: boolean;
  text?: boolean;
}

export interface EnvOverrideValidation {
  valid: boolean;
  record?: ModelRecord;
  error?: string;
}

export interface RegistryModelResolution {
  providerModelId: string;
  source: ModelConfigSource;
  canonicalId: string;
}

/** Error code surfaced when no build-capable model remains for a run. */
export const NO_BUILD_CAPABLE_MODEL = "NO_BUILD_CAPABLE_MODEL";

/** Tool IDs that count as file-writing for the early capability guard. */
export const FILE_WRITE_TOOL_IDS = new Set(["files.write", "apply_patch", "edit"]);

/** Consecutive failed attempts before a model is marked unhealthy. */
const UNHEALTHY_AFTER_FAILURES = 3;

// ─── Seed data (Sep 2026 verified) ────────────────────────────────

function seedRecords(): Map<string, ModelRecord> {
  const now = new Date().toISOString();
  const defs: Array<Omit<ModelRecord, "health" | "configSource"> & { healthState: ModelHealthState }> = [
    {
      provider: "gemini",
      canonicalId: "gemini-flash",
      // Alias, not a versioned slug: self-heals as Google rotates versions.
      providerModelId: "gemini-flash-latest",
      enabled: true,
      capabilities: {
        text: true,
        structuredOutput: true,
        toolCalling: true,
        reliableFileWriting: true, // reference build model — proven file writer
        vision: true,
        contextWindow: 1_048_576,
      },
      priority: 10,
      healthState: "unknown",
    },
    {
      provider: "gemini",
      canonicalId: "gemini-2.5-flash",
      providerModelId: "gemini-2.5-flash",
      enabled: true,
      capabilities: {
        text: true,
        structuredOutput: true,
        toolCalling: true,
        reliableFileWriting: true,
        vision: true,
        contextWindow: 1_048_576,
      },
      priority: 20,
      healthState: "unknown",
    },
    {
      // P1: Managed OpenAI — platform credential (OPENAI_API_KEY).
      // Used as LAST-resort fallback for entitled users when free
      // providers fail. gpt-4o is the proven tool-calling model used
      // by the v1 managed path.
      provider: "openai",
      canonicalId: "openai-gpt-4o",
      providerModelId: "gpt-4o",
      enabled: true,
      capabilities: {
        text: true,
        structuredOutput: true,
        toolCalling: true,
        reliableFileWriting: true,
        vision: true,
        contextWindow: 128_000,
      },
      priority: 100, // Last — only as fallback for entitled users
      healthState: "unknown",
    },
    {
      provider: "openrouter",
      canonicalId: "openrouter-qwen3.8-27b",
      providerModelId: "qwen/qwen3.8-27b:free",
      enabled: true,
      capabilities: {
        text: true,
        structuredOutput: true,
        toolCalling: true,
        // Catalog-verified free model with tool-calling support (Sep 2026:
        // OpenRouter catalog lists tools/tool_choice in supported_parameters;
        // described for coding and long-running agent tasks). NOT yet
        // run-proven as a file writer, so reliableFileWriting stays FALSE
        // per the evidence-based doctrine — chat/tool-eligible, never the
        // initial BUILD pick. Promote to true only after a real build run
        // proves file writes (files.write / apply_patch / edit).
        reliableFileWriting: false,
        vision: true,
        // Verified from the OpenRouter catalog (Sep 2026).
        contextWindow: 262_144,
      },
      priority: 30,
      healthState: "unknown",
    },
    {
      provider: "openrouter",
      canonicalId: "openrouter-gemma-4-31b",
      providerModelId: "google/gemma-4-31b-it:free",
      enabled: true,
      capabilities: {
        text: true,
        structuredOutput: true,
        toolCalling: true,
        reliableFileWriting: true,
        vision: false,
        // Conservative seed estimate (unverified) — informational only;
        // no routing decision filters on contextWindow today.
        contextWindow: 131_072,
      },
      priority: 40,
      healthState: "unknown",
    },
    {
      provider: "openrouter",
      canonicalId: "openrouter-north-mini-code",
      providerModelId: "cohere/north-mini-code:free",
      enabled: true,
      capabilities: {
        text: true,
        structuredOutput: true,
        toolCalling: true,
        // PROVEN Sep 2026: reasons and reads files but never emits
        // file-writing tool calls. Chat-capable only — NEVER for BUILD.
        reliableFileWriting: false,
        vision: false,
        contextWindow: 131_072, // conservative seed estimate (unverified)
      },
      priority: 50,
      healthState: "unknown",
    },
    {
      provider: "openrouter",
      canonicalId: "openrouter-nemotron-3.5-lightning",
      providerModelId: "nvidia/nemotron-3.5-lightning:free",
      enabled: true,
      capabilities: {
        text: true,
        structuredOutput: true,
        toolCalling: true,
        // bad_response in prod Sep 2026 — not a proven writer.
        reliableFileWriting: false,
        vision: false,
        contextWindow: 131_072, // conservative seed estimate (unverified)
      },
      priority: 60,
      // Excluded from eligibility until a success is recorded (the registry
      // learns: a later success flips it back to healthy).
      healthState: "unhealthy",
    },
  ];

  const map = new Map<string, ModelRecord>();
  for (const d of defs) {
    map.set(d.canonicalId, {
      provider: d.provider,
      canonicalId: d.canonicalId,
      providerModelId: d.providerModelId,
      enabled: d.enabled,
      capabilities: { ...d.capabilities },
      priority: d.priority,
      health: { state: d.healthState, lastChecked: now, lastError: "" },
      configSource: "registry",
    });
  }
  return map;
}

let records = seedRecords();
/** Consecutive failure counts per canonicalId (process-local learning). */
const consecutiveFailures = new Map<string, number>();
/** Where each canonicalId's effective model string came from. */
const configSources = new Map<string, ModelConfigSource>();

function snapshot(r: ModelRecord): ModelRecord {
  return {
    ...r,
    capabilities: { ...r.capabilities },
    health: { ...r.health },
  };
}

// ─── Redaction ────────────────────────────────────────────────────

function redactDetail(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-<redacted>")
    .replace(/key-[A-Za-z0-9_-]+/g, "key-<redacted>")
    .replace(/(token|secret|password)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, "$1=<redacted>")
    .slice(0, 200);
}

function logRegistry(event: string, fields: Record<string, unknown>): void {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.warn(`[model-registry] ${event} ${parts}`);
}

// ─── Queries ──────────────────────────────────────────────────────

function meetsRequirements(r: ModelRecord, required: CapabilityRequirements): boolean {
  const c = r.capabilities;
  if (required.tools && !c.toolCalling) return false;
  if (required.reliableFileWriting && !c.reliableFileWriting) return false;
  if (required.vision && !c.vision) return false;
  if (required.structuredOutput && !c.structuredOutput) return false;
  if (required.text && !c.text) return false;
  return true;
}

/**
 * Enabled models with the required capabilities that are not unhealthy,
 * sorted by priority (lower first). Unhealthy models are excluded until a
 * success is recorded via recordHealthOutcome.
 */
export function getEligibleModels(required: CapabilityRequirements): ModelRecord[] {
  return [...records.values()]
    .filter((r) => r.enabled && r.health.state !== "unhealthy" && meetsRequirements(r, required))
    .sort((a, b) => a.priority - b.priority)
    .map(snapshot);
}

/** Highest-priority BUILD model: tool-calling + proven file writer. */
/**
 * Providers whose routes spend LiTT's own platform credential.
 *
 * The model registry holds no auth state by design, so callers that pick a
 * BUILD model must reconcile this list against the run's server-derived
 * entitlement. Without that, an unentitled build guard would preselect a
 * LITT_PAID model that planBasicRoutes then correctly refuses to route to,
 * ending the run with NO_BUILD_CAPABLE_MODEL.
 */
export const LITT_PAID_PROVIDERS: ReadonlySet<string> = new Set(["openai"]);

/**
 * Entitlement-aware build-model selection.
 *
 * `allowLittPaidProviders` must be server-derived (never request input) and
 * defaults to deny: when it is not explicitly true, LITT_PAID models are
 * withheld so the guard only ever picks a model the cost policy will allow.
 */
export function selectBuildModel(
  excludeCanonicalIds?: Iterable<string>,
  opts?: { allowLittPaidProviders?: boolean },
): ModelRecord | null {
  const excluded = new Set(excludeCanonicalIds ?? []);
  const entitled = opts?.allowLittPaidProviders === true;
  const eligible = getEligibleModels({ tools: true, reliableFileWriting: true }).filter(
    (r) => !excluded.has(r.canonicalId) && (entitled || !LITT_PAID_PROVIDERS.has(r.provider)),
  );
  return eligible[0] ?? null;
}

/** Resolve a provider + providerModelId (or canonicalId) to its registry record. */
export function findModelRecord(provider: string, providerModelId: string): ModelRecord | undefined {
  const rec = [...records.values()].find(
    (r) => r.provider === provider && (r.providerModelId === providerModelId || r.canonicalId === providerModelId),
  );
  return rec ? snapshot(rec) : undefined;
}

/** Where a canonicalId's effective model string came from (run evidence). */
export function getModelConfigSource(canonicalId: string): ModelConfigSource {
  return configSources.get(canonicalId) ?? records.get(canonicalId)?.configSource ?? "registry";
}

/**
 * Validate an env-var model override against the registry. The value must
 * match a known providerModelId or canonicalId AND carry the required
 * capabilities. Unknown strings are NEVER silently accepted — the caller
 * must fall back to the registry default and log the rejection.
 */
export function validateEnvOverride(
  envVar: string,
  value: string,
  requiredCaps: CapabilityRequirements,
): EnvOverrideValidation {
  const v = (value ?? "").trim();
  if (!v) {
    return { valid: false, error: `${envVar} is empty — using registry default` };
  }
  const record = [...records.values()].find(
    (r) => r.providerModelId === v || r.canonicalId === v,
  );
  if (!record) {
    return {
      valid: false,
      error: `${envVar}="${v}" is not a known registry model (no providerModelId or canonicalId match) — refusing to silently accept an unknown model string`,
    };
  }
  if (!record.enabled) {
    return {
      valid: false,
      error: `${envVar}="${v}" resolves to registry model "${record.canonicalId}" which is disabled`,
    };
  }
  const missing: string[] = [];
  if (requiredCaps.tools && !record.capabilities.toolCalling) missing.push("tools");
  if (requiredCaps.reliableFileWriting && !record.capabilities.reliableFileWriting)
    missing.push("reliableFileWriting");
  if (requiredCaps.vision && !record.capabilities.vision) missing.push("vision");
  if (requiredCaps.structuredOutput && !record.capabilities.structuredOutput)
    missing.push("structuredOutput");
  if (requiredCaps.text && !record.capabilities.text) missing.push("text");
  if (missing.length > 0) {
    return {
      valid: false,
      error: `${envVar}="${v}" resolves to "${record.canonicalId}" which lacks required capabilities: ${missing.join(", ")}`,
    };
  }
  return { valid: true, record: snapshot(record) };
}

/**
 * Resolve GEMINI_PRIMARY_MODEL / GEMINI_FALLBACK_MODEL / OPENROUTER_MODEL on
 * first use: validate the env value, and on ANY rejection log an explicit
 * structured warning (var name, value, reason) and use the registry default.
 * Never silently uses the raw string.
 */
export function resolveRegistryModel(
  envVar: string,
  canonicalId: string,
  requiredCaps: CapabilityRequirements,
): RegistryModelResolution {
  const seed = records.get(canonicalId);
  const raw = (process.env[envVar] ?? "").trim();
  if (!raw) {
    if (seed) configSources.set(seed.canonicalId, "registry");
    return {
      providerModelId: seed?.providerModelId ?? canonicalId,
      source: "registry",
      canonicalId,
    };
  }
  const check = validateEnvOverride(envVar, raw, requiredCaps);
  if (check.valid && check.record) {
    configSources.set(check.record.canonicalId, "env-override");
    return {
      providerModelId: check.record.providerModelId,
      source: "env-override",
      canonicalId: check.record.canonicalId,
    };
  }
  logRegistry("env_override_rejected", {
    envVar,
    value: raw,
    reason: check.error,
    fallback: seed?.providerModelId,
  });
  if (seed) configSources.set(seed.canonicalId, "registry");
  return {
    providerModelId: seed?.providerModelId ?? canonicalId,
    source: "registry",
    canonicalId,
  };
}

// ─── Health learning ──────────────────────────────────────────────

/**
 * Record an attempt outcome for a registry model. Success → healthy.
 * Failure → degraded, and after 3 consecutive failures → unhealthy
 * (excluded from getEligibleModels until a later success).
 */
export function recordHealthOutcome(canonicalId: string, success: boolean, errorClass: string): void {
  const r = records.get(canonicalId);
  if (!r) return;
  const now = new Date().toISOString();
  if (success) {
    consecutiveFailures.set(canonicalId, 0);
    r.health = { state: "healthy", lastChecked: now, lastError: "" };
    return;
  }
  const n = (consecutiveFailures.get(canonicalId) ?? 0) + 1;
  consecutiveFailures.set(canonicalId, n);
  r.health = {
    state: n >= UNHEALTHY_AFTER_FAILURES ? "unhealthy" : "degraded",
    lastChecked: now,
    lastError: redactDetail(`${errorClass}`),
  };
}

/**
 * Attempt-level wiring for the routing layer: maps (provider, model) to the
 * registry record and records the outcome. No-op for models the registry
 * does not manage (legacy candidates, BYOK, ollama).
 */
export function recordModelAttemptOutcome(
  provider: string,
  providerModelId: string,
  success: boolean,
  errorClass: string,
): void {
  const rec = [...records.values()].find(
    (r) => r.provider === provider && (r.providerModelId === providerModelId || r.canonicalId === providerModelId),
  );
  if (rec) recordHealthOutcome(rec.canonicalId, success, errorClass);
}

/** Safe diagnostics snapshot — capability/health only, never secrets. */
export function modelRegistryDiagnostics(): Array<{
  canonicalId: string;
  provider: string;
  providerModelId: string;
  enabled: boolean;
  priority: number;
  health: ModelHealthState;
  configSource: ModelConfigSource;
}> {
  return [...records.values()]
    .sort((a, b) => a.priority - b.priority)
    .map((r) => ({
      canonicalId: r.canonicalId,
      provider: r.provider,
      providerModelId: r.providerModelId,
      enabled: r.enabled,
      priority: r.priority,
      health: r.health.state,
      configSource: getModelConfigSource(r.canonicalId),
    }));
}

/** Test seam: restore seeded records and clear learned health. */
export function _resetModelRegistryForTests(): void {
  records = seedRecords();
  consecutiveFailures.clear();
  configSources.clear();
}
