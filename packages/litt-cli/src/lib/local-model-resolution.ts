/**
 * Local model resolution — what actually serves a request when the
 * cockpit's execution target is LOCAL.
 *
 * The bug this module exists for:
 *
 *   The cockpit header said LOCAL / SIGNED OUT, the local Ollama daemon
 *   was up with qwen3:4b-instruct installed, and the footer still read
 *   "MiniMax M3 (Free)" — a persisted REMOTE selection from
 *   ~/.litt/model-prefs.json. Nothing in the routing path consulted
 *   executionTarget at all: ModelRuntime.route() reads only
 *   (routingMode, selectedModel) and resolves against the cloud catalog.
 *   So LOCAL mode kept a remote model authoritative, and the request
 *   ended at a cloud/BYOK auth error for a lane that needs no auth.
 *
 * Two decisions live here, both pure, both independently testable:
 *
 *   1. localRoutePolicy() — MUST the local daemon serve this request?
 *   2. resolveLocalModel() — WHICH installed model serves it?
 *
 * Neither reads process.env, neither performs I/O. The caller supplies
 * the probed lane status (lib/local-lane.ts) and the session facts.
 */

import { readFileSync } from "node:fs";
import { freemem } from "node:os";

import type { LocalLanePurpose, LocalLaneStatus } from "./local-lane.js";
import { selectLocalModel } from "./local-lane.js";
import type { ExecutionTarget } from "./execution-target.js";
import type { RoutedModel } from "./model-runtime.js";

/** Canonical id prefix the discovery layer gives installed Ollama models. */
export const OLLAMA_CANONICAL_PREFIX = "ollama:";

/**
 * Strip the canonical prefix from an Ollama model id.
 * "ollama:qwen3:4b-instruct" → "qwen3:4b-instruct"; other ids unchanged.
 */
export function ollamaTagOf(modelId: string): string {
  return modelId.startsWith(OLLAMA_CANONICAL_PREFIX)
    ? modelId.slice(OLLAMA_CANONICAL_PREFIX.length)
    : modelId;
}

/** Is this model id an explicitly-local (Ollama) selection? */
export function isLocalModelId(modelId: string | null | undefined): boolean {
  return !!modelId && modelId.startsWith(OLLAMA_CANONICAL_PREFIX);
}

// ─── 0. Canonical requested-model resolution ────────────────────────

/**
 * The source of a requested local model — for display and routing traces.
 */
export type RequestedModelSource = "env" | "prefs" | "none";

export interface RequestedModelInfo {
  /** The model to request, or null when no explicit request was made. */
  model: string | null;
  /** Where the request came from: LITT_MODEL env, persisted prefs, or none. */
  source: RequestedModelSource;
}

/**
 * Resolve the model the operator named explicitly for LOCAL execution.
 *
 * This is the CANONICAL precedence — every surface (doctor, ask, TUI,
 * local-lane probe) must call this so they all agree on which model to
 * probe and execute.
 *
 * Precedence (identical everywhere):
 *   1. LITT_MODEL env var — the documented override.
 *   2. Persisted prefs selectedModel — but ONLY when it is a local
 *      (ollama:) model id. A persisted REMOTE selection (e.g.
 *      "minimax-m3-free") is never a local request.
 *   3. null — no explicit request; the lane's own preference order
 *      (selectLocalModel) picks from installed models.
 *
 * `prefsSelectedModel` is the value from ~/.litt/model-prefs.json
 * (or the cockpit store's selectedModel state — same thing).
 */
export function resolveRequestedLocalModel(
  prefsSelectedModel: string | null | undefined,
): RequestedModelInfo {
  const env = process.env.LITT_MODEL?.trim();
  if (env) return { model: env, source: "env" };
  if (prefsSelectedModel && isLocalModelId(prefsSelectedModel)) {
    return { model: prefsSelectedModel, source: "prefs" };
  }
  return { model: null, source: "none" };
}

// ─── 1. Policy: must the local daemon serve this request? ───────────

export interface LocalRoutePolicyInput {
  executionTarget: ExecutionTarget;
  /** Emergency/offline lock (LITT_LOCAL_ONLY=1 / LITT_LOCAL_MODE=1). */
  localOnly: boolean;
  /** null = auth not yet resolved. */
  signedIn: boolean | null | undefined;
  /**
   * A model the operator named explicitly for this session — LITT_MODEL,
   * or a selection whose canonical id is an "ollama:" one. Null when the
   * only selection is an ordinary catalog (cloud) model.
   */
  requestedLocalModel: string | null;
  /** Does this machine hold ANY cloud/BYOK provider credential? */
  hasCloudCredential: boolean;
}

export type LocalRoutePolicy =
  /** The local daemon must serve. Cloud/BYOK is not an acceptable answer. */
  | { kind: "local-required"; reason: string }
  /** Ordinary catalog routing applies (BYOK on the client, or REMOTE). */
  | { kind: "catalog" };

/**
 * Decide whether the local daemon is the required lane for this request.
 *
 * The rules, in order:
 *
 *   REMOTE target
 *     → catalog. This module has no opinion about remote execution.
 *
 *   LOCAL target (any auth/credential state)
 *     → local-required. When executionTarget is "local", the local
 *       daemon (Ollama/LM Studio) is the ONLY acceptable provider.
 *       A persisted remote model preference (e.g. "minimax-m3-free"
 *       from ~/.litt/model-prefs.json) must NEVER become the effective
 *       model in LOCAL mode — that was the P0 split-brain bug where
 *       the header said LOCAL but the request went to OpenRouter.
 *       The remote preference is preserved in the store for later
 *       /remote use, but it is NOT used as the effective model.
 *       If the local daemon is unavailable, the caller surfaces a
 *       clear LOCAL failure — never a silent fallback to cloud.
 */
export function localRoutePolicy(input: LocalRoutePolicyInput): LocalRoutePolicy {
  if (input.executionTarget !== "local") return { kind: "catalog" };

  // LOCAL target → always local-required, regardless of auth/credentials.
  // This is the fix for the P0 split-brain bug: LOCAL mode must never
  // call OpenRouter or any other remote provider. The local daemon is
  // the only lane. If it's unavailable, the caller shows a clear error.
  if (input.localOnly) {
    return {
      kind: "local-required",
      reason: "local-only mode is active — cloud and remote lanes are blocked",
    };
  }

  if (input.requestedLocalModel) {
    return {
      kind: "local-required",
      reason: `local model "${input.requestedLocalModel}" was requested explicitly`,
    };
  }

  return {
    kind: "local-required",
    reason: "LOCAL execution target — the local daemon is the only provider lane",
  };
}

/**
 * The brain label to show while the local lane is still being resolved.
 *
 * Resolving the local model needs an HTTP probe, so there is a window at
 * startup before the real model is known. Rendering the persisted
 * selection during that window is what put "MiniMax M3 (Free)" on screen
 * in a cockpit that could only ever call Ollama. A remote label the
 * session cannot honour is worse than no label, so this returns a
 * neutral placeholder instead — and null whenever the persisted
 * selection IS legitimately what will serve.
 */
export function pendingLocalBrainLabel(
  policy: LocalRoutePolicy,
  selectedModel: string | null,
): string | null {
  if (policy.kind !== "local-required") return null;
  if (isLocalModelId(selectedModel)) return null;
  return "Local model";
}

// ─── 2. Which installed model serves it? ────────────────────────────

export interface LocalModelResolution {
  /** The daemon's own model tag, e.g. "qwen3:4b-instruct". */
  tag: string;
  /** Canonical registry id, e.g. "ollama:qwen3:4b-instruct". */
  canonicalId: string;
  provider: "ollama";
  /** The endpoint that will serve it. */
  endpoint: string;
  /** Why this tag was chosen — surfaced in the routing trace. */
  reason: string;
  /**
   * The model the operator asked for (env/prefs), stripped to a bare
   * tag. null when no explicit request was made (preference order pick).
   * Used to detect and surface fallback/route-change decisions.
   */
  configuredInput: string | null;
  /**
   * Where the configuredInput came from: "env" (LITT_MODEL), "prefs"
   * (persisted selectedModel), or "none" (no explicit request).
   */
  configuredSource: RequestedModelSource;
  /**
   * True when the effective model differs from the configured input —
   * i.e. a routing/preference-order decision changed what serves the
   * request. False when the explicit request was honoured exactly, or
   * when there was no explicit request (preference order is not a
   * "fallback" — it's the default path).
   */
  isRouteChange: boolean;
  /**
   * Non-fatal pressure warning — set when the resolution is allowed to
   * proceed but the caller should surface it (heavy local inference under
   * low memory explicitly permitted via LITT_ALLOW_HEAVY_LOCAL, or a
   * small model running below its comfortable floor). Never set when
   * the gate blocked — that path is an error, not a warning.
   */
  warning?: string;
}

export type LocalModelOutcome =
  | { ok: true; resolution: LocalModelResolution }
  | { ok: false; error: string };

// ─── 2a. Heavy-local-inference pressure gate ────────────────────────

/**
 * Measured memory facts the caller supplies for the on-device pressure
 * gate. Kept injectable so resolveLocalModel stays pure/testable — the
 * production call sites pass currentLocalPressureFacts().
 */
export interface LocalPressureFacts {
  /** MemAvailable (or free-mem fallback) in kB. null = unmeasurable. */
  memAvailableKb: number | null;
  /** Explicit operator opt-in for heavy on-device inference. */
  allowHeavyLocal?: boolean;
}

/** >4B params counts as "heavy" on-device inference on this class of hardware. */
export const HEAVY_LOCAL_PARAMS_B = 4;
/** A heavy local model wants at least this much headroom (≈4.5 GB). */
export const HEAVY_LOCAL_MIN_MEM_KB = 4_500_000;
/** A ≤4B local model still wants ≈3 GB — below that, warn. */
export const LOCAL_MODEL_MIN_MEM_KB = 3_000_000;

export type LocalPressureGate =
  | { kind: "ok" }
  | { kind: "warn"; message: string }
  | { kind: "blocked"; message: string };

/**
 * Parse the parameter count out of a model tag: "qwen3:4b" → 4,
 * "litt-oc-phone:1.7b-8k" → 1.7, "llama3.1:8b" → 8. Returns null for
 * tags with no size suffix — context sizes ("litt-hermes:64k",
 * "litt-coder:8k") are NOT parameter counts and must not match.
 */
export function modelParamsBillions(tag: string): number | null {
  const m = /(\d+(?:\.\d+)?)b(?![a-z0-9])/i.exec(tag);
  return m ? Number.parseFloat(m[1]) : null;
}

/**
 * The no-silent-fallback rule: when the elected route is THIS device
 * (tier "local" — on the phone, the last-resort daemon), a heavy (>4B)
 * model under memory pressure is REFUSED unless the operator explicitly
 * permitted it via LITT_ALLOW_HEAVY_LOCAL=1. Permitted-but-pressured and
 * small-but-pressured cases surface a warning instead — a route that
 * lands on the device is never allowed to pretend nothing is wrong.
 */
export function localHeavyInferenceGate(input: {
  tag: string;
  memAvailableKb: number | null;
  allowHeavyLocal?: boolean;
}): LocalPressureGate {
  const params = modelParamsBillions(input.tag);
  const heavy = params !== null && params > HEAVY_LOCAL_PARAMS_B;
  const mem = input.memAvailableKb;
  const memMb = mem === null ? null : Math.round(mem / 1024);

  if (heavy) {
    if (mem !== null && mem < HEAVY_LOCAL_MIN_MEM_KB) {
      const detail = `"${input.tag}" (~${params}B params) with MemAvailable ${memMb} MB < ${HEAVY_LOCAL_MIN_MEM_KB / 1000} MB`;
      if (!input.allowHeavyLocal) {
        return {
          kind: "blocked",
          message:
            `Refusing heavy on-device inference: ${detail}. ` +
            `The PC route is preferred for large models — restore Tailscale/PC ` +
            `connectivity, or explicitly permit this device with LITT_ALLOW_HEAVY_LOCAL=1.`,
        };
      }
      return {
        kind: "warn",
        message:
          `Heavy on-device inference permitted explicitly: ${detail} ` +
          `(LITT_ALLOW_HEAVY_LOCAL=1). Expect pressure on the Android LMK.`,
      };
    }
    if (mem === null) {
      return {
        kind: "warn",
        message:
          `Heavy on-device inference for "${input.tag}" (~${params}B params) ` +
          `with memory unmeasurable — proceeding unverified.`,
      };
    }
    return { kind: "ok" };
  }

  if (mem !== null && mem < LOCAL_MODEL_MIN_MEM_KB) {
    return {
      kind: "warn",
      message:
        `Low memory for local inference: "${input.tag}" with MemAvailable ` +
        `${memMb} MB < ${LOCAL_MODEL_MIN_MEM_KB / 1000} MB.`,
    };
  }
  return { kind: "ok" };
}

/**
 * MemAvailable in kB — /proc/meminfo on Linux/Android, os.freemem()
 * elsewhere. null when neither is readable.
 */
export function memAvailableKb(): number | null {
  try {
    const text = readFileSync("/proc/meminfo", "utf8");
    const m = /^MemAvailable:\s*(\d+)\s*kB/im.exec(text);
    if (m) return Number.parseInt(m[1], 10);
  } catch {
    /* non-Linux or unreadable — fall through to os.freemem */
  }
  const free = freemem();
  return Number.isFinite(free) && free > 0 ? Math.floor(free / 1024) : null;
}

/** Production facts: measured memory + the explicit-permission env flag. */
export function currentLocalPressureFacts(): LocalPressureFacts {
  return {
    memAvailableKb: memAvailableKb(),
    allowHeavyLocal: /^(1|true|yes)$/i.test(process.env.LITT_ALLOW_HEAVY_LOCAL?.trim() ?? ""),
  };
}

/**
 * Pick the installed model that will serve a LOCAL request.
 *
 * `requested` is the operator's explicit choice (LITT_MODEL, or an
 * "ollama:" selection). It is honoured exactly or it is an error — a
 * request for a model that is not installed HARD-FAILS with the list of
 * what is installed, rather than quietly serving something else. Serving
 * a different model than the one asked for is how "Served by" lines stop
 * being trustworthy.
 *
 * With no explicit request, the lane's own preference order applies.
 *
 * `pressure` is optional: when supplied AND the elected route is this
 * device (tier "local"), the heavy-local-inference gate applies — heavy
 * (>4B) models under low memory are refused unless explicitly permitted
 * via LITT_ALLOW_HEAVY_LOCAL=1, and pressured-but-allowed resolutions
 * carry a `warning` the caller can surface. Omitting it preserves the
 * pre-gate behaviour exactly (tests, fixtures).
 */
/**
 * Optional knobs for resolveLocalModel — a single options bag so callers
 * can pass a purpose hint, pressure facts, or both. `memAvailableKb` /
 * `allowHeavyLocal` at the top level ARE the pressure facts; the gate
 * only arms when at least one of them is present.
 */
export interface ResolveLocalModelOptions {
  /** Lane purpose hint for preference-order selection. */
  purpose?: LocalLanePurpose;
  /** MemAvailable (or free-mem fallback) in kB. null = unmeasurable. */
  memAvailableKb?: number | null;
  /** Explicit operator opt-in for heavy on-device inference. */
  allowHeavyLocal?: boolean;
}

export function resolveLocalModel(
  lane: LocalLaneStatus,
  requested: string | null,
  options?: ResolveLocalModelOptions,
): LocalModelOutcome {
  // The pressure gate is armed only when the caller actually supplied
  // pressure facts — an options bag with just `{ purpose }` preserves
  // the pre-gate behaviour exactly.
  const pressure: LocalPressureFacts | undefined =
    options && (options.memAvailableKb !== undefined || options.allowHeavyLocal !== undefined)
      ? { memAvailableKb: options.memAvailableKb ?? null, allowHeavyLocal: options.allowHeavyLocal }
      : undefined;
  // Evaluate the on-device pressure gate for a chosen tag. Only fires
  // when the probe landed on THIS device — a PC route (lan/tailscale)
  // is the preferred heavy lane and is never gated here.
  const gate = (tag: string): { blocked?: string; warning?: string } => {
    if (!pressure || lane.route !== "local") return {};
    const g = localHeavyInferenceGate({
      tag,
      memAvailableKb: pressure.memAvailableKb,
      allowHeavyLocal: pressure.allowHeavyLocal,
    });
    if (g.kind === "blocked") return { blocked: g.message };
    if (g.kind === "warn") return { warning: g.message };
    return {};
  };

  // Track the configured input and its source so callers (doctor, ask,
  // TUI) can surface route-change decisions instead of silently serving
  // a different model than the one the operator named.
  const configuredInput = requested ? ollamaTagOf(requested) : null;

  if (!lane.available) {
    const detail = lane.reason ?? "the local model daemon is not available";
    return {
      ok: false,
      error: requested
        ? `Cannot serve local model "${ollamaTagOf(requested)}": ${detail}`
        : `No local model available: ${detail}`,
    };
  }

  if (requested) {
    const tag = ollamaTagOf(requested);
    const hit = lane.models.find((m) => m === tag)
      // A bare "qwen3" should match the installed "qwen3:4b-instruct",
      // but "qwen3:4b" must NOT silently match "qwen3:4b-instruct".
      ?? lane.models.find((m) => m.startsWith(`${tag}:`) && !tag.includes(":"));
    if (!hit) {
      return {
        ok: false,
        error:
          `Local model "${tag}" is not installed at ${lane.endpoint}. ` +
          `Installed: ${lane.models.join(", ") || "(none)"}. ` +
          `Run \`ollama pull ${tag}\`, or unset LITT_MODEL to use an installed model.`,
      };
    }
    const g = gate(hit);
    if (g.blocked) return { ok: false, error: g.blocked };
    return {
      ok: true,
      resolution: {
        tag: hit,
        canonicalId: `${OLLAMA_CANONICAL_PREFIX}${hit}`,
        provider: "ollama",
        endpoint: lane.endpoint,
        reason:
          (hit === tag
            ? `explicitly requested local model "${tag}"`
            : `explicitly requested "${tag}" → installed "${hit}"`) +
          (g.warning ? ` — ${g.warning}` : ""),
        configuredInput,
        configuredSource: "env",
        isRouteChange: hit !== tag,
        warning: g.warning,
      },
    };
  }

  const picked = selectLocalModel(lane.models, undefined, options?.purpose ?? "agent");
  if (!picked) {
    return {
      ok: false,
      error: `No local model available: the daemon at ${lane.endpoint} has no models installed.`,
    };
  }
  const g = gate(picked);
  if (g.blocked) return { ok: false, error: g.blocked };
  return {
    ok: true,
    resolution: {
      tag: picked,
      canonicalId: `${OLLAMA_CANONICAL_PREFIX}${picked}`,
      provider: "ollama",
      endpoint: lane.endpoint,
      reason:
        `local lane preference order selected "${picked}"` +
        (g.warning ? ` — ${g.warning}` : ""),
      configuredInput: null,
      configuredSource: "none",
      isRouteChange: false,
      warning: g.warning,
    },
  };
}

// ─── 3b. Explicit-selection helpers (/model <arg>, /remote) ─────────

/**
 * The selection REMOTE can honour from a persisted prefs value: the
 * stored id unchanged, or null when it is a local-only ("ollama:")
 * model — the remote catalog can never serve a daemon tag. Used when
 * switching execution targets so a local pin degrades to AUTO routing
 * instead of a strict-pinned "not in catalog" failure.
 */
export function remoteSelectionOf(
  persistedSelectedModel: string | null | undefined,
): string | null {
  if (!persistedSelectedModel || isLocalModelId(persistedSelectedModel)) return null;
  return persistedSelectedModel;
}

/** Minimal shape of a catalog model for argument resolution. */
export interface ModelArgCatalogEntry {
  canonicalId: string;
  displayName: string;
}

export type ModelArgResolution =
  | { ok: true; canonicalId: string; label: string; source: "catalog" | "local" }
  | { ok: false; error: string };

/**
 * Resolve a `/model <arg>` string to a canonical model id.
 *
 * Lookup order:
 *   1. Catalog — exact canonicalId, then case-insensitive canonicalId
 *      or displayName match.
 *   2. Local daemon — the arg (with or without the "ollama:" prefix)
 *      matched against installed tags; a bare prefix like "qwen3" may
 *      match "qwen3:4b-instruct" but "qwen3:4b" never silently matches
 *      "qwen3:4b-instruct" (same rule as resolveLocalModel).
 *   3. Clear error listing what IS installed — "not found" must never
 *      be mistaken for success.
 */
export function resolveModelArg(
  arg: string,
  catalog: ModelArgCatalogEntry[],
  lane: LocalLaneStatus,
): ModelArgResolution {
  const needle = arg.trim();
  if (!needle) {
    return { ok: false, error: "Usage: /model <model-id-or-name> — or bare /model for the picker." };
  }

  const cat = catalog.find((m) => m.canonicalId === needle)
    ?? catalog.find((m) => m.canonicalId.toLowerCase() === needle.toLowerCase())
    ?? catalog.find((m) => m.displayName.toLowerCase() === needle.toLowerCase());
  if (cat) {
    return { ok: true, canonicalId: cat.canonicalId, label: cat.displayName, source: "catalog" };
  }

  const tag = ollamaTagOf(needle);
  const hit = lane.available
    ? lane.models.find((m) => m === tag)
      ?? lane.models.find((m) => m.startsWith(`${tag}:`) && !tag.includes(":"))
    : undefined;
  if (hit) {
    return {
      ok: true,
      canonicalId: `${OLLAMA_CANONICAL_PREFIX}${hit}`,
      label: hit,
      source: "local",
    };
  }

  const installed = lane.available
    ? lane.models.join(", ") || "(none)"
    : `(daemon unavailable at ${lane.endpoint})`;
  return {
    ok: false,
    error:
      `Model "${needle}" not found — not in the catalog and not installed locally. ` +
      `Installed local models: ${installed}.`,
  };
}

// ─── 3. The RoutedModel the adapter layer consumes ──────────────────

/**
 * Build the RoutedModel for a resolved local model.
 *
 * `servedBy: "ollama"` is what makes resolveProviderAdapter() take its
 * credentialless local-daemon branch, and `openRouterModelId: undefined`
 * is what makes a silent reroute through OpenRouter impossible: the
 * adapter resolver's OpenRouter branch requires that id, so a LOCAL
 * route can only ever end at the local daemon or at a clear error.
 */
export function localRoutedModel(resolution: LocalModelResolution): RoutedModel {
  return {
    id: resolution.canonicalId,
    label: resolution.tag,
    servedBy: "ollama",
    provider: "ollama",
    reason: `LOCAL execution target — ${resolution.reason}`,
    fallbackReason: null,
    appliedPolicy: "pinned",
    openRouterModelId: undefined,
    providerModelId: resolution.tag,
  };
}
