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

import type { LocalLaneStatus } from "./local-lane.js";
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
}

export type LocalModelOutcome =
  | { ok: true; resolution: LocalModelResolution }
  | { ok: false; error: string };

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
 */
export function resolveLocalModel(
  lane: LocalLaneStatus,
  requested: string | null,
): LocalModelOutcome {
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
    return {
      ok: true,
      resolution: {
        tag: hit,
        canonicalId: `${OLLAMA_CANONICAL_PREFIX}${hit}`,
        provider: "ollama",
        endpoint: lane.endpoint,
        reason: hit === tag
          ? `explicitly requested local model "${tag}"`
          : `explicitly requested "${tag}" → installed "${hit}"`,
      },
    };
  }

  const picked = selectLocalModel(lane.models);
  if (!picked) {
    return {
      ok: false,
      error: `No local model available: the daemon at ${lane.endpoint} has no models installed.`,
    };
  }
  return {
    ok: true,
    resolution: {
      tag: picked,
      canonicalId: `${OLLAMA_CANONICAL_PREFIX}${picked}`,
      provider: "ollama",
      endpoint: lane.endpoint,
      reason: `local lane preference order selected "${picked}"`,
    },
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
