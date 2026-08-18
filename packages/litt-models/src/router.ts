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
  /**
   * Strict mode: when true, PINNED/ASK throw if the chosen model is not
   * routable instead of falling back to AUTO. Use this for FIXED policy
   * where the user explicitly wants that model or a clear error.
   * Default false (preserve existing fall-back-to-auto behavior).
   */
  strict?: boolean;
  /**
   * Only consider models that have been verified available (availability
   * "online") — i.e. confirmed by real discovery. When false (default for
   * backward compat), routable-but-unverified models are also considered.
   * MAX/BUDGET always prefer online models; this controls whether
   * unverified models are excluded entirely or just deprioritized.
   */
  verifiedOnly?: boolean;
}

/**
 * Route a model for a run.
 *
 * AUTO    → classify task → select from available models using LiTT defaults.
 * PINNED  → use the pinned model if routable; else fall back to AUTO (or throw if strict).
 * ASK     → use the supplied choice if routable; else fall back to AUTO (or throw if strict).
 *
 * The `preference` option modifies AUTO selection:
 *   "budget" → cheapest capable model instead of LiTT default
 *   "max"    → strongest available model instead of LiTT default
 *
 * Truthfulness contract:
 *   - MAX only selects from verified-online models. If the strongest
 *     verified model is not the absolute strongest in the catalog, the
 *     result's fallbackReason explains which stronger models were
 *     unavailable and why.
 *   - BUDGET only selects from verified-online models with pricing.
 *   - PINNED with strict=true throws a clear error if the model is not
 *     routable, instead of silently falling back.
 *
 * Never throws (except strict PINNED/ASK unavailable, or no models at all).
 * If everything fails, returns the first available model with a fallback
 * reason. If no models are available, throws (the runtime should surface a
 * "no provider configured" error).
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
  const strict = options.strict ?? false;
  const verifiedOnly = options.verifiedOnly ?? false;

  // The candidate set: verified-online models are always candidates.
  // Unverified-but-routable models are candidates unless verifiedOnly.
  const onlineModels = available.filter((m) => m.availability === "online");
  const candidatePool = verifiedOnly
    ? onlineModels
    : [...onlineModels, ...available.filter((m) => m.availability !== "online")];

  // PINNED / ASK: respect explicit choice if routable
  if (mode === "pinned" && options.pinnedModelId) {
    const pinned = registry.getById(options.pinnedModelId);
    if (pinned && registry.isRoutable(pinned)) {
      return buildResult(registry, pinned, `Pinned: ${pinned.displayName}`, classifyTask(input), null, "pinned");
    }
    // Not routable
    if (strict) {
      const reason = pinned
        ? `FIXED model ${pinned.displayName} is not available (availability: ${pinned.availability})`
        : `FIXED model ${options.pinnedModelId} is not in the catalog`;
      throw new Error(reason);
    }
    // Non-strict: fall through to AUTO with a fallback reason
    const taskKind = classifyTask(input);
    const { model, reason } = selectForTask(registry, taskKind, candidatePool.length > 0 ? candidatePool : available);
    return buildResult(
      registry,
      model,
      reason,
      taskKind,
      pinned ? `Pinned ${pinned.displayName} unavailable (availability: ${pinned.availability}) → AUTO fallback` : `Pinned ${options.pinnedModelId} unknown → AUTO fallback`,
      "auto",
    );
  }
  if (mode === "ask" && options.askChoice) {
    const choice = registry.getById(options.askChoice);
    if (choice && registry.isRoutable(choice)) {
      return buildResult(registry, choice, `User choice: ${choice.displayName}`, classifyTask(input), null, "ask");
    }
    if (strict) {
      const reason = choice
        ? `ASK model ${choice.displayName} is not available (availability: ${choice.availability})`
        : `ASK model ${options.askChoice} is not in the catalog`;
      throw new Error(reason);
    }
    const taskKind = classifyTask(input);
    const { model, reason } = selectForTask(registry, taskKind, candidatePool.length > 0 ? candidatePool : available);
    return buildResult(
      registry,
      model,
      reason,
      taskKind,
      choice ? `ASK ${choice.displayName} unavailable (availability: ${choice.availability}) → AUTO fallback` : `ASK ${options.askChoice} unknown → AUTO fallback`,
      "auto",
    );
  }

  // AUTO (or fallback from a non-routable pin/ask)
  const taskKind = classifyTask(input);

  // Budget preference: cheapest capable model (verified-online preferred)
  if (preference === "budget") {
    const cheapest = selectCheapest(candidatePool, onlineModels);
    if (cheapest) {
      const fallbackReason = cheapest.availability !== "online"
        ? `No verified-online models — selected best available (unverified): ${cheapest.displayName}`
        : null;
      return buildResult(registry, cheapest, "Budget — cheapest capable model", taskKind, fallbackReason, "budget");
    }
  }

  // Max preference: strongest available model (verified-online only)
  if (preference === "max") {
    const pool = onlineModels.length > 0 ? onlineModels : candidatePool;
    const strongest = selectStrongest(pool);
    if (strongest) {
      // Build a fallback reason:
      //   - if no verified-online models exist (all unverified), report that
      //   - else if stronger models exist but are unavailable, list them
      let fallbackReason: string | null = null;
      if (onlineModels.length === 0) {
        fallbackReason = `No verified-online models discovered — selected strongest routable (unverified): ${strongest.displayName}. Run discovery to verify.`;
      } else {
        fallbackReason = buildMaxFallbackReason(registry, strongest);
      }
      return buildResult(registry, strongest, "Max — strongest available verified model", taskKind, fallbackReason, "max");
    }
  }

  const { model, reason } = selectForTask(registry, taskKind, candidatePool.length > 0 ? candidatePool : available);
  return buildResult(registry, model, reason, taskKind, null, "auto");
}

/**
 * Select the cheapest capable model.
 * Prefers verified-online models with pricing; falls back to any available.
 */
function selectCheapest(
  candidates: ModelDefinition[],
  onlineModels: ModelDefinition[],
): ModelDefinition | null {
  const pool = onlineModels.length > 0 ? onlineModels : candidates;
  const withPricing = pool.filter((m) => m.pricing);
  if (withPricing.length === 0) return pool[0] ?? null;
  return [...withPricing].sort((a, b) => {
    const costA = a.pricing!.inputPer1M + a.pricing!.outputPer1M;
    const costB = b.pricing!.inputPer1M + b.pricing!.outputPer1M;
    return costA - costB;
  })[0] ?? null;
}

/**
 * Select the strongest (frontier intelligence) available model.
 * Sort: frontier > balanced > light, then by context window desc.
 */
function selectStrongest(available: ModelDefinition[]): ModelDefinition | null {
  if (available.length === 0) return null;
  const rank = (m: ModelDefinition) =>
    m.intelligence === "frontier" ? 3 : m.intelligence === "balanced" ? 2 : 1;
  return [...available].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return rb - ra;
    return b.contextWindow - a.contextWindow;
  })[0];
}

/**
 * Build a fallback reason for MAX when the selected model is not the
 * absolute strongest in the catalog. Lists which stronger OR same-tier
 * models were unavailable and why.
 *
 * Same-tier unavailable models are included because MAX should explain
 * why a particular frontier model was chosen over another unavailable
 * frontier model (e.g. "GPT-5.6 Sol unavailable → Claude Fable 5 selected").
 */
function buildMaxFallbackReason(
  registry: ModelRegistry,
  selected: ModelDefinition,
): string | null {
  const selectedRank =
    selected.intelligence === "frontier" ? 3 :
    selected.intelligence === "balanced" ? 2 : 1;

  // Find catalog models that are stronger OR same-tier, not the selected
  // model, and not available (offline/no-key/unverified).
  const unavailable = registry.getAll()
    .filter((m) => {
      const rank =
        m.intelligence === "frontier" ? 3 :
        m.intelligence === "balanced" ? 2 : 1;
      return rank >= selectedRank;
    })
    .filter((m) => m.canonicalId !== selected.canonicalId)
    .filter((m) => !registry.isRoutable(m) || m.availability !== "online");

  if (unavailable.length === 0) return null;

  const reasons = unavailable.slice(0, 3).map((m) => {
    const routable = registry.isRoutable(m);
    return `${m.displayName} ${routable ? "(unverified)" : "(unavailable: " + m.availability + ")"}`;
  });
  return `${reasons.join(", ")} → ${selected.displayName} selected`;
}

function buildResult(
  registry: ModelRegistry,
  model: ModelDefinition,
  reason: string,
  taskKind: TaskKind,
  fallbackReason: string | null,
  appliedPolicy: "auto" | "pinned" | "ask" | "budget" | "max",
): RoutingResult {
  const cred = registry.credentialFor(model);
  return {
    model,
    reason,
    taskKind,
    servedBy: cred.servedBy,
    credentialSource: cred.source,
    fallbackReason,
    appliedPolicy,
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
