/**
 * Repair model resolution — the ONLY model-lane the repair command uses.
 *
 * Policy (job.modelPolicy):
 *   pinnedModel   → honored exactly or a clear error. An "ollama:" pin is
 *                   verified against the live daemon before selection; a
 *                   cloud pin requires the provider key to exist.
 *   allowedModels → tried in order; first resolvable wins.
 *   neither       → the local coding model "ollama:litt-coder:8k" (the
 *                   configured coding-agent fallback), then the lane's own
 *                   preference order — never a paid provider unless the job
 *                   explicitly allows one.
 *   offline       → local daemon only (schema already rejects cloud pins).
 *
 * Failure semantics (Phase 6): a provider that cannot serve — missing key,
 * unreachable daemon, exhausted paid lane — is a "provider-blocked" result,
 * never a failed repair. The caller reports stage=blocked and preserves
 * state for resume. InsufficientCredits/usage-limit surfaces map to
 * providerBlockedReason "billing" so they are reported as billing limits,
 * not repair failures.
 */
import type { ChatMessage, ModelProvider } from "@litt/agent-core";
import { probeLocalLane, type LocalLaneStatus } from "../local-lane.js";
import {
  localRoutedModel,
  resolveLocalModel,
} from "../local-model-resolution.js";
import { selectLocalModel } from "../local-lane.js";
import {
  hasAnyNativeProviderKey,
  hasProviderKey,
  resolveProviderAdapter,
} from "../model-provider.js";
import type { RoutedModel } from "../model-runtime.js";
import type { RepairJob } from "./contracts.js";

/** Preferred local coding model (verified against the live daemon, never assumed). */
export const REPAIR_DEFAULT_LOCAL_MODEL = "litt-coder:8k";

export interface RepairProviderHandle {
  provider: ModelProvider;
  modelId: string;
  label: string;
  providerId: string;
  local: boolean;
}

export type RepairProviderOutcome =
  | { ok: true; handle: RepairProviderHandle }
  | { ok: false; error: string; reason: "no-provider" | "billing" | "offline" };

interface LaneDeps {
  lane?: LocalLaneStatus;
  probe?: () => Promise<LocalLaneStatus>;
}

async function getLane(deps?: LaneDeps): Promise<LocalLaneStatus> {
  if (deps?.lane) return deps.lane;
  if (deps?.probe) return deps.probe();
  return probeLocalLane();
}

function localHandle(
  lane: LocalLaneStatus,
  requested: string | null,
  strict: boolean,
): { ok: true; handle: RepairProviderHandle } | { ok: false; error: string } {
  if (!lane.available) {
    return { ok: false, error: `Local model daemon unavailable at ${lane.endpoint}: ${lane.reason ?? "no reason"}` };
  }
  let outcome = resolveLocalModel(lane, requested);
  if (!outcome.ok && (strict || !requested)) return { ok: false, error: outcome.error };
  if (!outcome.ok) {
    // Default candidate missed — try the lane's own preference order.
    const picked = selectLocalModel(lane.models);
    if (!picked) return { ok: false, error: outcome.error };
    outcome = resolveLocalModel(lane, picked);
    if (!outcome.ok) return { ok: false, error: outcome.error };
  }
  const routed = localRoutedModel(outcome.resolution);
  const provider = resolveProviderAdapter(routed, { routingMode: "fixed" });
  return {
    ok: true,
    handle: {
      provider,
      modelId: outcome.resolution.canonicalId,
      label: outcome.resolution.tag,
      providerId: "ollama",
      local: true,
    },
  };
}

function cloudRoutedModel(modelId: string): RoutedModel {
  return {
    id: modelId,
    label: modelId,
    servedBy: "openrouter",
    provider: "openrouter",
    reason: "repair job modelPolicy",
    fallbackReason: null,
    appliedPolicy: "pinned",
    openRouterModelId: modelId,
    providerModelId: modelId,
  };
}

function cloudHandle(modelId: string): RepairProviderOutcome {
  if (!hasProviderKey() && !hasAnyNativeProviderKey()) {
    return {
      ok: false,
      reason: "billing",
      error:
        `Model "${modelId}" requires a paid provider credential (OPENROUTER_API_KEY ` +
        `or a native provider key), and none is configured. This is a provider ` +
        `billing/credential limit, not a repair failure.`,
    };
  }
  try {
    const provider = resolveProviderAdapter(cloudRoutedModel(modelId), { routingMode: "fixed" });
    return {
      ok: true,
      handle: { provider, modelId, label: modelId, providerId: "openrouter", local: false },
    };
  } catch (error) {
    return {
      ok: false,
      reason: "billing",
      error: `Model "${modelId}" cannot be served: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function oneCandidate(
  modelId: string,
  lane: LocalLaneStatus,
  offline: boolean,
  strict: boolean,
): RepairProviderOutcome {
  if (modelId.startsWith("ollama:")) {
    const r = localHandle(lane, modelId.slice("ollama:".length), strict);
    return r.ok ? r : { ok: false, reason: "no-provider", error: r.error };
  }
  if (offline) {
    return {
      ok: false,
      reason: "offline",
      error: `Offline repair cannot use cloud model "${modelId}" (modelPolicy.offline).`,
    };
  }
  return cloudHandle(modelId);
}

export async function resolveRepairProvider(
  job: RepairJob,
  deps?: LaneDeps,
): Promise<RepairProviderOutcome> {
  const policy = job.modelPolicy;
  const lane = await getLane(deps);
  const errors: string[] = [];
  let sawBilling = false;
  let sawOffline = false;

  const candidates: string[] = [];
  if (policy.pinnedModel) candidates.push(policy.pinnedModel);
  else {
    candidates.push(...policy.allowedModels);
    // The coding-agent fallback preference: local first, paid providers only
    // when the job explicitly allows them (allowedModels naming a cloud id).
    candidates.push(`ollama:${REPAIR_DEFAULT_LOCAL_MODEL}`);
  }

  for (const candidate of candidates) {
    const explicit = Boolean(policy.pinnedModel) || policy.allowedModels.includes(candidate);
    const outcome = oneCandidate(candidate, lane, policy.offline, explicit);
    if (outcome.ok) return outcome;
    errors.push(outcome.error);
    if (outcome.reason === "billing") sawBilling = true;
    if (outcome.reason === "offline") sawOffline = true;
    if (policy.pinnedModel) break; // pins are honored exactly
  }

  // When nothing explicit resolved and the default local was already tried,
  // accept any installed local model unless the job forbids it entirely.
  if (!policy.pinnedModel && !policy.offline && lane.available) {
    const r = localHandle(lane, null, false);
    if (r.ok) return r;
    errors.push(r.error);
  }

  return {
    ok: false,
    reason: sawOffline ? "offline" : sawBilling ? "billing" : "no-provider",
    error: "No repair model provider could serve this job: " + errors.join(" | "),
  };
}

/** Collect a streamed completion into a single string (never throws on deltas). */
export async function completeOnce(
  handle: RepairProviderHandle,
  messages: ChatMessage[],
  abortSignal?: AbortSignal,
): Promise<{ content: string; model: string; providerId: string }> {
  let content = "";
  const result = await handle.provider.stream(
    messages,
    (event) => {
      if (event.type === "delta") content += event.text;
      else if (event.type === "error") throw new Error(event.message);
    },
    abortSignal,
  );
  return {
    content: result.content || content,
    model: result.actualServedModel ?? result.model,
    providerId: result.provider ?? handle.providerId,
  };
}
