/**
 * LiTT Auto Router — LiTT chooses the best model per task.
 *
 * Routing pipeline (spec section 14):
 *   Request → classify task → filter by capability/context/credentials
 *           → apply mode (auto/pinned/ask) → apply LiTT defaults → select
 *
 * Modes (spec section 15):
 *   AUTO    — LiTT decides (default). Beginners never have to care which model.
 *   PINNED  — user pinned a model for this conversation/project.
 *   ASK     — advanced user chooses before major runs.
 *
 * Run-pinning (spec section 16): once a run begins, the model is pinned for
 * that operation. Switching mid-run is forbidden. The next run picks up the
 * new selection. This is enforced by the runtime via RunModelPin; the router
 * only selects — it does not mutate run state.
 */

import { LITT_DEFAULTS } from "./catalog";
import type { ModelRegistry } from "./registry";
import type {
  CredentialSource,
  ModelDefinition,
  ProviderId,
  RoutingInput,
  RoutingMode,
  RoutingResult,
  TaskKind,
} from "./types";

// ─── Task classification ───────────────────────────────────────────
/**
 * Classify a request into a task kind. Heuristics mirror the spec's routing
 * examples (section 14). This is intentionally lightweight — the runtime can
 * override with a richer classifier if available.
 */
export function classifyTask(input: RoutingInput): TaskKind {
  const lower = input.message.toLowerCase();

  if (input.hasImageAttachments) return "vision";
  if (/\b(image|screenshot|visual|diagram|picture|photo)\b/.test(lower)) return "vision";
  if (/\b(generate|create|draw|render) (an? )?image\b/.test(lower)) return "image";
  if (/\b(make|generate|create|render) (a )?video\b/.test(lower)) return "video";
  if (/\b(transcribe|speech|voice|audio)\b/.test(lower)) return "voice";

  // Large-context signals
  const ctx = input.estimatedContextTokens ?? 0;
  if (
    /\b(entire repo|entire repository|whole project|whole codebase|all files|every file)\b/.test(lower) ||
    ctx > 200_000
  ) {
    return "large-context";
  }

  // Deep reasoning / architecture
  if (
    /\b(architect|design|refactor|complex|reason|analyz|debug|investigate|root cause)\b/.test(lower)
  ) {
    return "reasoning";
  }

  // Agent / tool workflows
  if (/\b(agent|workflow|orchestrat|automate|pipeline|run the|execute the)\b/.test(lower)) {
    return "agent";
  }

  // Coding
  if (
    /\b(code|function|bug|fix|test|build|implement|edit|write|refactor|file|class|component|api)\b/.test(
      lower,
    )
  ) {
    return "coding";
  }

  // Fast: short, casual
  if (input.message.length < 60 && !/\b(why|explain|analyze|compare)\b/.test(lower)) {
    return "fast";
  }

  return "chat";
}

// ─── Selection ─────────────────────────────────────────────────────
/**
 * Pick the best model for a task kind from the available (routable) set,
 * applying the LiTT defaults (spec section 24).
 */
function selectForTask(
  registry: ModelRegistry,
  taskKind: TaskKind,
  available: ModelDefinition[],
): { model: ModelDefinition; reason: string } {
  const find = (id: string) => available.find((m) => m.canonicalId === id);
  const byTier = (tier: ModelDefinition["littTier"]) =>
    available.find((m) => m.littTier === tier);
  const byCap = (cap: keyof ModelDefinition["capabilities"]) =>
    available.filter((m) => m.capabilities[cap]);

  switch (taskKind) {
    case "fast":
      if (find(LITT_DEFAULTS.fast)) return { model: find(LITT_DEFAULTS.fast)!, reason: "Fast default — quick task" };
      if (byTier("fast")) return { model: byTier("fast")!, reason: "Fast tier" };
      return { model: available[0], reason: "First available" };

    case "chat":
      if (find(LITT_DEFAULTS.fast)) return { model: find(LITT_DEFAULTS.fast)!, reason: "Default chat" };
      if (byTier("fast")) return { model: byTier("fast")!, reason: "Fast tier for chat" };
      return { model: available[0], reason: "First available" };

    case "coding": {
      // "build a React feature" → balanced; finer-grained split can layer on top.
      if (find(LITT_DEFAULTS.balanced)) return { model: find(LITT_DEFAULTS.balanced)!, reason: "Balanced coding" };
      if (byTier("balanced")) return { model: byTier("balanced")!, reason: "Balanced tier for coding" };
      const coders = byCap("coding");
      if (coders.length) return { model: coders[0], reason: "Coding-capable model" };
      return { model: available[0], reason: "First available" };
    }

    case "reasoning":
      if (find(LITT_DEFAULTS.max)) return { model: find(LITT_DEFAULTS.max)!, reason: "Max escalation — hard reasoning" };
      if (byTier("max")) return { model: byTier("max")!, reason: "Max tier" };
      if (byTier("deep")) return { model: byTier("deep")!, reason: "Deep tier" };
      {
        const reasoners = byCap("reasoning").filter((m) => m.intelligence === "frontier");
        if (reasoners.length) return { model: reasoners[0], reason: "Frontier reasoning model" };
      }
      return { model: available[0], reason: "First available" };

    case "large-context": {
      // Prefer long-context + frontier coding (Kimi K3 / GPT-5.6 Sol)
      if (find(LITT_DEFAULTS.codeMax)) return { model: find(LITT_DEFAULTS.codeMax)!, reason: "Large-repo coding default" };
      const longCtx = available
        .filter((m) => m.capabilities.longContext && m.capabilities.coding)
        .sort((a, b) => b.contextWindow - a.contextWindow);
      if (longCtx.length) return { model: longCtx[0], reason: "Largest long-context coding model" };
      if (find(LITT_DEFAULTS.max)) return { model: find(LITT_DEFAULTS.max)!, reason: "Max fallback for large context" };
      return { model: available[0], reason: "First available" };
    }

    case "agent": {
      // Prefer strong tool-using agent models (DeepSeek V4 Pro / GPT-5.6 Terra)
      if (byTier("agent")) return { model: byTier("agent")!, reason: "Agent tier — tool workflows" };
      const agents = byCap("tools").filter((m) => m.intelligence !== "light");
      if (agents.length) return { model: agents[0], reason: "Tool-capable agent model" };
      if (find(LITT_DEFAULTS.balanced)) return { model: find(LITT_DEFAULTS.balanced)!, reason: "Balanced fallback for agent" };
      return { model: available[0], reason: "First available" };
    }

    case "vision": {
      const vision = byCap("vision");
      if (vision.length) {
        // Prefer fast multimodal (Gemini 3.7 Flash) for vision
        const gemini = vision.find((m) => m.littTier === "gemini");
        if (gemini) return { model: gemini, reason: "Fast multimodal vision model" };
        return { model: vision[0], reason: "Vision-capable model" };
      }
      return { model: available[0], reason: "No vision model available — first available" };
    }

    case "image":
    case "video":
    case "voice":
      // Creative domains are routed by a separate creative router (not in V1
      // core). Fall back to the best available text model with a note.
      return { model: available[0], reason: `${taskKind} router not in V1 core — using best available` };

    default:
      return { model: available[0], reason: "First available" };
  }
}

// ─── Public routing API ────────────────────────────────────────────
export interface RouteOptions {
  mode?: RoutingMode;
  /** User-pinned model id (for PINNED mode). */
  pinnedModelId?: string | null;
  /** User's explicit choice (for ASK mode). */
  askChoice?: string | null;
  /**
   * Selection preference within AUTO mode:
   *   "auto"   — LiTT's default task-based selection (default)
   *   "budget" — cheapest capable model
   *   "max"    — strongest available model
   * This lets the CLI express its budget/max UI modes without defining a
   * separate routing engine.
   */
  preference?: "auto" | "budget" | "max";
}

/**
 * Route a model for a run.
 *
 * AUTO    → classify task → select from available models using LiTT defaults.
 * PINNED  → use the pinned model if routable; else fall back to AUTO.
 * ASK     → use the supplied choice if routable; else fall back to AUTO.
 *
 * The `preference` option modifies AUTO selection:
 *   "budget" → cheapest capable model instead of LiTT default
 *   "max"    → strongest available model instead of LiTT default
 *
 * Never throws — if everything fails, returns the first available model with
 * a fallback reason. If no models are available, throws (the runtime should
 * surface a "no provider configured" error).
 */
export function routeModel(
  registry: ModelRegistry,
  input: RoutingInput,
  options: RouteOptions = {},
): RoutingResult {
  const available = registry.getAvailable();
  if (available.length === 0) {
    throw new Error(
      "No routable models available — no provider credentials configured. Set OPENROUTER_API_KEY or a direct provider key.",
    );
  }

  const mode: RoutingMode = options.mode ?? "auto";
  const preference = options.preference ?? "auto";

  // PINNED / ASK: respect explicit choice if routable
  if (mode === "pinned" && options.pinnedModelId) {
    const pinned = registry.getById(options.pinnedModelId);
    if (pinned && registry.isRoutable(pinned)) {
      return buildResult(registry, pinned, `Pinned: ${pinned.displayName}`, classifyTask(input));
    }
  }
  if (mode === "ask" && options.askChoice) {
    const choice = registry.getById(options.askChoice);
    if (choice && registry.isRoutable(choice)) {
      return buildResult(registry, choice, `User choice: ${choice.displayName}`, classifyTask(input));
    }
  }

  // AUTO (or fallback from a non-routable pin/ask)
  const taskKind = classifyTask(input);

  // Budget preference: cheapest capable model
  if (preference === "budget") {
    const cheapest = selectCheapest(registry, available);
    if (cheapest) {
      return buildResult(registry, cheapest, "Budget — cheapest capable model", taskKind);
    }
  }

  // Max preference: strongest available model
  if (preference === "max") {
    const strongest = selectStrongest(available);
    if (strongest) {
      return buildResult(registry, strongest, "Max — strongest available model", taskKind);
    }
  }

  const { model, reason } = selectForTask(registry, taskKind, available);
  return buildResult(registry, model, reason, taskKind);
}

/**
 * Select the cheapest capable model from available.
 */
function selectCheapest(
  registry: ModelRegistry,
  available: ModelDefinition[],
): ModelDefinition | null {
  const withPricing = available.filter((m) => m.pricing);
  if (withPricing.length === 0) return available[0] ?? null;
  return [...withPricing].sort((a, b) => {
    const costA = a.pricing!.inputPer1M + a.pricing!.outputPer1M;
    const costB = b.pricing!.inputPer1M + b.pricing!.outputPer1M;
    return costA - costB;
  })[0] ?? null;
}

/**
 * Select the strongest (frontier intelligence) available model.
 */
function selectStrongest(available: ModelDefinition[]): ModelDefinition | null {
  const frontier = available.filter((m) => m.intelligence === "frontier");
  if (frontier.length > 0) return frontier[0];
  const balanced = available.filter((m) => m.intelligence === "balanced");
  if (balanced.length > 0) return balanced[0];
  return available[0] ?? null;
}

function buildResult(
  registry: ModelRegistry,
  model: ModelDefinition,
  reason: string,
  taskKind: TaskKind,
): RoutingResult {
  const cred = registry.credentialFor(model);
  return {
    model,
    reason,
    taskKind,
    servedBy: cred.servedBy,
    credentialSource: cred.source,
  };
}

// ─── Display helpers ───────────────────────────────────────────────
export function routingModeLabel(mode: RoutingMode): string {
  switch (mode) {
    case "auto": return "AUTO";
    case "pinned": return "PINNED";
    case "ask": return "ASK";
  }
}

/**
 * The brain label — what the user sees as "LiTT's brain" (spec section 22).
 * Never "LiTT = Claude". Always "LiTT Auto" or the model's display name.
 */
export function brainLabel(mode: RoutingMode, model: ModelDefinition | null): string {
  if (mode === "auto") return "LiTT Auto";
  if (model) return model.displayName;
  return "LiTT Auto";
}

/**
 * The cockpit status line (spec section 22):
 *   ● LiTT READY · AUTO · LOCAL
 *   MODEL GPT-5.6 Terra · OPENAI
 */
export function cockpitStatusLine(
  mode: RoutingMode,
  model: ModelDefinition | null,
  servedBy: ProviderId | null,
  credentialSource: CredentialSource | null,
): string {
  const brain = brainLabel(mode, model);
  const sourceTag = credentialSource ? credentialSource.toUpperCase() : "";
  const modelLine = model ? `MODEL ${model.displayName} · ${servedBy?.toUpperCase() ?? ""}` : "";
  const head = `● LiTT READY · ${routingModeLabel(mode)}${sourceTag ? ` · ${sourceTag}` : ""}`;
  return modelLine ? `${head}\n${modelLine}` : head;
}
