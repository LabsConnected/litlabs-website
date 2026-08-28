/**
 * LiTT Model System — Canonical Types
 *
 * LiTT is always LiTT. The underlying model is an engine LiTT can switch
 * between. These types define the contract every provider/model must satisfy
 * to be routable by the LiTT Runtime.
 *
 * Design rules (from the LiTT Model System spec):
 *   - Never present "LiTT = Claude" or "LiTT = GPT". Models are engines.
 *   - Every invocation knows: provider, model, credentialSource, capabilities,
 *     pricing, health, contextLimit, reasoningEffort.
 *   - The model picker is NOT the brain of LiTT. Switching engines must not
 *     reset memory, context, missions, or runtime state.
 */

// ─── Providers ─────────────────────────────────────────────────────
/**
 * A model provider — the company/runtime that serves a model.
 * OpenRouter is a meta-provider that can serve models from many families.
 */
export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "deepseek"
  | "kimi"
  | "mistral"
  | "qwen"
  | "groq"
  | "openrouter"
  | "ollama"
  | "lmstudio";

/**
 * How a model invocation is paid for.
 *   litt-managed — LiTT account → LiTT provider key → LiTTBits
 *   byok         — user-supplied provider key, provider bills user directly
 *   local        — Ollama / LM Studio on local GPU/CPU, no third-party bill
 *   free         — free tier (e.g. Gemini free, OpenRouter :free models)
 */
export type CredentialSource = "litt-managed" | "byok" | "local" | "free";

// ─── Capability + classification ───────────────────────────────────
export interface ModelCapabilities {
  chat: boolean;
  reasoning: boolean;
  coding: boolean;
  vision: boolean;
  /** Native structured function/tool calling. Required for autonomous mutations. */
  tools: boolean;
  audio: boolean;
  imageGeneration: boolean;
  videoGeneration: boolean;
  longContext: boolean;
  structuredOutput: boolean;
}

export type SpeedTier = "ultra" | "fast" | "normal" | "slow";
export type IntelligenceTier = "light" | "balanced" | "frontier";

/**
 * Lifecycle of a catalog entry.
 *   online     — verified against the live provider catalog
 *   unverified — listed but not yet confirmed by a live call (discovery may flip)
 *   offline    — provider credential missing or health check down
 *   deprecated — provider has marked this model deprecated/retired
 */
export type Availability = "online" | "unverified" | "offline" | "deprecated";

/**
 * Source of the model ID verification.
 *   provider-catalog   — checked against the official provider API docs/catalog
 *   openrouter-catalog — checked against the OpenRouter /models endpoint
 *   unverified         — not yet checked; ID may be speculative
 */
export type VerificationSource = "provider-catalog" | "openrouter-catalog" | "unverified";

/**
 * Creative models live in their own categories and must NOT be mixed into the
 * regular chat LLM picker.
 */
export type ModelDomain = "text" | "image" | "voice" | "video" | "embedding";

// ─── Pricing ───────────────────────────────────────────────────────
/**
 * Real cost information. Prices are per 1M tokens in USD.
 * For non-token-priced domains (image/video), input/output are 0 and the
 * `unit` describes the billing unit.
 */
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  /** Billing unit for non-text domains, e.g. "per-image", "per-second". */
  unit?: "per-token" | "per-image" | "per-second" | "free";
}

// ─── LiTT recommended tiers ────────────────────────────────────────
/**
 * The curated LiTT picker tiers (spec section 2). Models tagged with a
 * littTier appear at the top of the model picker under "LiTT Recommended".
 */
export type LiTTTier =
  | "fast" // ⚡ Fast — default chat, quick tasks
  | "balanced" // ⚖️ Balanced — everyday coding + reasoning
  | "max" // 🧠 Max — hardest coding/planning/reasoning
  | "code-fast" // 💻 Code Fast — rapid coding loops
  | "code-max" // 💻 Code Max — long-horizon coding
  | "alternative" // 🧠 Alternative — strong general/coding
  | "deep" // 🔬 Deep — difficult long-running work
  | "gemini" // ⚡ Gemini — fast multimodal/agent
  | "agent" // 🛠 Agent — strong agent/tool workflows
  | "local"; // 🏠 Local — private/offline

// ─── ModelDefinition ───────────────────────────────────────────────
/**
 * A single model in the LiTT registry. This is the source of truth for
 * routing, display, capability filtering, and provider dispatch.
 *
 * `providerModelId` and `openRouterModelId` tell the runtime how to address
 * the model depending on which provider actually serves it (direct vs via
 * OpenRouter). This is SOURCE TRUTH: if Claude is served through OpenRouter,
 * the runtime uses `openRouterModelId`, not `providerModelId`.
 *
 * Verification fields (`verified`, `verifiedAt`, `source`) track whether the
 * exact model ID has been confirmed against a live provider/OpenRouter
 * catalog. A model is `verified: true` ONLY when the ID was actually checked.
 * Never fabricate verification — unverified models are still routable (the
 * failover chain tolerates a 404) but must not claim provenance they don't have.
 */
export interface ModelDefinition {
  /** Canonical LiTT id, e.g. "gpt-5.6-luna". Stable across providers. */
  canonicalId: string;
  /** Human label for the picker, e.g. "GPT-5.6 Luna". */
  displayName: string;
  /** The model family provider. */
  provider: ProviderId;
  /**
   * Provider-native model ID — the id when calling the provider's own API
   * (e.g. "gpt-5.6-luna", "claude-sonnet-5"). The runtime uses this when
   * the model's native provider has a direct credential.
   */
  providerModelId?: string;
  /**
   * OpenRouter model slug — the id when calling via OpenRouter
   * (e.g. "openai/gpt-5.6-luna"). The runtime uses this when the model
   * is served by OpenRouter (no direct provider key).
   */
  openRouterModelId?: string;
  capabilities: ModelCapabilities;
  speed: SpeedTier;
  intelligence: IntelligenceTier;
  /** Context window in tokens. */
  contextWindow: number;
  pricing?: ModelPricing;
  availability: Availability;
  /**
   * Whether the exact providerModelId / openRouterModelId has been confirmed
   * against a live provider or OpenRouter catalog. NEVER set to true without
   * an actual check. Unverified models are still routable.
   */
  verified: boolean;
  /** ISO date string when the model ID was last verified. null if unverified. */
  verifiedAt: string | null;
  /** Source of the verification. "unverified" when verified is false. */
  source: VerificationSource;
  /** Short human description of what this model is for. */
  description: string;
  /** Free-text tags for routing heuristics, e.g. ["fast","chat","coding-fast"]. */
  recommendedFor: string[];
  /** True → show at top of picker under "LiTT Recommended". */
  littRecommended?: boolean;
  /** Curated LiTT tier (spec section 2). */
  littTier?: LiTTTier;
  /** Domain — keeps creative models out of the chat picker. */
  domain: ModelDomain;
  /** Max output tokens, if known. */
  maxOutputTokens?: number;
  /** Supported reasoning effort levels, if the model exposes them. */
  reasoningEfforts?: string[];
  notes?: string;
}

// ─── Credential resolution (injected, env-agnostic) ────────────────
/**
 * Resolved credential + source-truth for a provider.
 * The registry never reads process.env directly — the consumer injects a
 * CredentialResolver so the package stays pure, SSR-safe, and testable.
 */
export interface CredentialInfo {
  hasCredential: boolean;
  source: CredentialSource;
  /**
   * Which provider actually serves requests for this provider (source truth).
   * If only OPENROUTER_API_KEY is set, Claude is servedBy "openrouter", not
   * "anthropic". If a direct key is set, servedBy === provider.
   */
  servedBy: ProviderId;
}

export type CredentialResolver = (provider: ProviderId) => CredentialInfo;

// ─── Routing ───────────────────────────────────────────────────────
/**
 * AUTO     — LiTT chooses the model per task (default).
 * PINNED   — user pinned a model for this conversation/project.
 * ASK      — advanced user chooses before major runs.
 */
export type RoutingMode = "auto" | "pinned" | "ask";

export type TaskKind =
  | "chat"
  | "coding"
  | "reasoning"
  | "vision"
  | "large-context"
  | "agent"
  | "image"
  | "video"
  | "voice"
  | "fast";

export interface RoutingInput {
  message: string;
  /** Image attachments trigger vision-capable routing. */
  hasImageAttachments?: boolean;
  /** Estimated prompt + context tokens (for context-window filtering). */
  estimatedContextTokens?: number;
}

export interface RoutingResult {
  model: ModelDefinition;
  /** Human-readable reason for display in cockpit / /route explain. */
  reason: string;
  taskKind: TaskKind;
  /** Which provider will actually serve the call (source truth). */
  servedBy: ProviderId;
  credentialSource: CredentialSource;
  /**
   * If the requested policy could not be honored and a fallback was chosen,
   * this explains why (e.g. "GPT-5.6 Sol unavailable → Claude Sonnet 5 selected").
   * null when the requested policy was honored exactly.
   */
  fallbackReason: string | null;
  /**
   * The policy that was actually applied. May differ from the requested
   * policy when a FIXED model is unavailable and strict=false (falls back
   * to AUTO). When strict=true, the router throws instead.
   */
  appliedPolicy: "auto" | "pinned" | "ask" | "budget" | "max";
}

// ─── Run-pinning ───────────────────────────────────────────────────
/**
 * Once a run begins, the model is pinned for that operation. Switching models
 * mid-run is forbidden — it breaks log reproducibility and debugging. The
 * next run picks up the new selection.
 */
export interface RunModelPin {
  runId: string;
  modelId: string;
  /** ISO timestamp the pin was created. */
  pinnedAt: string;
}
