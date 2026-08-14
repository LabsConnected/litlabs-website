/**
 * OpenRouterModelProvider — a ModelProvider implementation that calls
 * OpenRouter's chat completions API.
 *
 * This is the bridge between the agent loop and the LLM. The agent loop
 * calls model.stream() with the conversation, and this provider streams
 * the response back via the emit callback.
 *
 * MODEL TRUTH — the same philosophy as the VerificationGate:
 *   configured ≠ active ≠ proven
 *
 *   provider        — which API router is available (e.g. "openrouter")
 *   configuredModel — what the user/project/profile resolved to
 *   activeModel     — what the runtime actually executed (set on stream())
 *   profile         — fast / smart / long / auto
 *   source          — where the model resolution came from
 *
 * OPENROUTER_API_KEY means OpenRouter is AVAILABLE as a provider.
 * It does NOT mean any specific model (Claude, GPT, etc.) is active.
 * The activeModel is only known after the first stream() call returns
 * a meta event with the model the API actually used.
 *
 * Environment:
 *   OPENROUTER_API_KEY  — required for API calls (provider availability)
 *   LITT_MODEL          — explicit model override (highest priority)
 *   OPENROUTER_MODEL    — explicit model override (second priority)
 *
 * If no API key is set, the provider throws on construction.
 * Callers should check hasOpenRouterKey() before constructing.
 */

import type {
  ChatMessage,
  ModelProvider,
  ModelResult,
  ModelStreamEvent,
  ModelProfile,
} from "@litt/agent-core";

// ─── Model Truth Types ─────────────────────────────────────────────

/**
 * The source of a model resolution — for audit and display truth.
 *   runtime — the runtime actually executed a request and observed the model
 *   user    — the user explicitly set LITT_MODEL / OPENROUTER_MODEL
 *   project — a project-level config file set the model
 *   profile — the profile (fast/smart/long) resolved to a default model
 *   default — the internal fallback default (never displayed as "active")
 */
export type ModelSource = "runtime" | "user" | "project" | "profile" | "default";

/**
 * Separated model state — provider, configured, active, profile, source.
 *
 * This is the truthful model state. The cockpit displays activeModel ONLY
 * when source === "runtime" (i.e. the runtime actually executed a request).
 * Before that, it shows configuredModel (if any) or "unresolved".
 */
export interface ModelState {
  /** Which provider/router is available (e.g. "openrouter"), or null if none. */
  provider: string | null;
  /** What the resolution chain produced — may differ from activeModel. */
  configuredModel: string | null;
  /** What the runtime actually executed. null until the first stream() completes. */
  activeModel: string | null;
  /** The profile used for resolution. */
  profile: ModelProfile | null;
  /** Where the model resolution came from. */
  source: ModelSource | null;
}

// ─── Defaults (internal policy — never displayed as runtime truth) ──

/**
 * Internal default model. This is the LAST resort in the resolution chain.
 * It is NEVER presented as activeModel — only as configuredModel with
 * source: "default". activeModel is set only after a real API call.
 */
const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

/**
 * Profile → model mapping.
 *
 * `auto` is special: it does NOT map to a specific model. It means
 * "LiTT chooses based on task" — the provider routes dynamically.
 * We send the OpenRouter auto-route token so the router picks the model.
 */
const PROFILE_MODELS: Record<Exclude<ModelProfile, "auto">, string> = {
  fast: "~google/gemini-flash-latest",
  smart: "anthropic/claude-sonnet-5",
  long: "google/gemini-2.5-pro",
};

/**
 * OpenRouter's auto-routing model token. When profile is "auto", we send
 * this so OpenRouter's router picks the best model for the task — LiTT
 * does not secretly substitute Claude.
 */
const AUTO_ROUTE_MODEL = "openrouter/auto";

// ─── Model resolution ──────────────────────────────────────────────

/**
 * Resolve the configured model from the resolution chain.
 *
 * Priority:
 *   1. LITT_MODEL env var        → source: "user"
 *   2. OPENROUTER_MODEL env var  → source: "user"
 *   3. Profile mapping           → source: "profile" (or "auto" for auto)
 *   4. DEFAULT_MODEL             → source: "default"
 *
 * Returns the configured model + source. activeModel is NOT set here —
 * that only happens after a real stream() call.
 */
export function resolveConfiguredModel(profile: ModelProfile = "smart"): {
  model: string;
  source: ModelSource;
} {
  // 1. Explicit user override
  const userModel = process.env.LITT_MODEL ?? process.env.OPENROUTER_MODEL;
  if (userModel) {
    return { model: userModel, source: "user" };
  }

  // 2. Profile mapping
  if (profile === "auto") {
    // auto = routing, not a hardcoded model
    return { model: AUTO_ROUTE_MODEL, source: "profile" };
  }
  const profileModel = PROFILE_MODELS[profile];
  if (profileModel) {
    return { model: profileModel, source: "profile" };
  }

  // 3. Internal default — never displayed as "active"
  return { model: DEFAULT_MODEL, source: "default" };
}

/**
 * Build the truthful ModelState for display.
 *
 * - If the runtime has executed a request (activeModel set), source is "runtime".
 * - If a model is configured but not yet active, shows configuredModel.
 * - If no provider is available, everything is null/unresolved.
 *
 * This is what the cockpit calls to decide what to display.
 */
export function buildModelState(options?: {
  profile?: ModelProfile;
  activeModel?: string | null;
}): ModelState {
  // No provider available
  if (!hasOpenRouterKey()) {
    return {
      provider: null,
      configuredModel: null,
      activeModel: null,
      profile: options?.profile ?? null,
      source: null,
    };
  }

  const profile = options?.profile ?? "smart";
  const { model, source } = resolveConfiguredModel(profile);
  const activeModel = options?.activeModel ?? null;

  return {
    provider: "openrouter",
    configuredModel: model,
    activeModel,
    profile,
    source: activeModel ? "runtime" : source,
  };
}

/**
 * The display label for the cockpit.
 *
 *   activeModel set    → show activeModel (runtime truth)
 *   configuredModel set, no active → show configuredModel
 *   nothing            → "unresolved"
 */
export function modelDisplayLabel(state: ModelState): string {
  if (state.activeModel) return state.activeModel;
  if (state.configuredModel) return state.configuredModel;
  return "unresolved";
}

// ─── Provider ──────────────────────────────────────────────────────

export interface OpenRouterModelOptions {
  apiKey?: string;
  model?: string;
  profile?: ModelProfile;
}

export function hasOpenRouterKey(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

export class OpenRouterModelProvider implements ModelProvider {
  private readonly _apiKey: string;
  private readonly _model: string;
  private readonly _profile: ModelProfile;
  /** The active model — set after the first stream() meta event. */
  private _activeModel: string | null = null;

  constructor(options: OpenRouterModelOptions = {}) {
    this._apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    if (!this._apiKey) {
      throw new Error("OPENROUTER_API_KEY is required for OpenRouterModelProvider");
    }
    this._profile = options.profile ?? "smart";

    // Resolution: explicit override > profile > default
    if (options.model) {
      this._model = options.model;
    } else {
      const { model } = resolveConfiguredModel(this._profile);
      this._model = model;
    }
  }

  /** The configured model (what was requested). May differ from activeModel. */
  get configuredModel(): string {
    return this._model;
  }

  /** The active model (what the API actually used). null until first stream(). */
  get activeModel(): string | null {
    return this._activeModel;
  }

  /** The profile used for resolution. */
  get profile(): ModelProfile {
    return this._profile;
  }

  async stream(
    messages: ChatMessage[],
    emit: (event: ModelStreamEvent) => void,
  ): Promise<ModelResult> {
    // Emit meta — this is where activeModel becomes known
    emit({
      type: "meta",
      provider: "openrouter",
      model: this._model,
      profile: this._profile,
    });

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this._apiKey}`,
        "HTTP-Referer": "https://litlabs.net",
        "X-Title": "LiTT CLI",
      },
      body: JSON.stringify({
        model: this._model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error("OpenRouter returned no response body");
    }

    let content = "";
    let totalTokens = 0;
    let resolvedModel = this._model;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            emit({ type: "delta", text: delta.content });
          }
          // Capture the model the API actually used (may differ from configured
          // when profile is "auto" and OpenRouter routed to a specific model)
          if (parsed.model) {
            resolvedModel = parsed.model as string;
          }
          if (parsed.usage?.total_tokens) {
            totalTokens = parsed.usage.total_tokens;
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }

    // activeModel is now known from runtime execution
    this._activeModel = resolvedModel;

    return {
      content,
      model: resolvedModel,
      provider: "openrouter",
      usage: { total_tokens: totalTokens || Math.ceil(content.length / 4) },
      timing: { ttftMs: 0, generationMs: 0, totalMs: 0 },
      profile: this._profile,
    };
  }

  async health(): Promise<number> {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { "Authorization": `Bearer ${this._apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok ? 1 : 0;
    } catch {
      return 0;
    }
  }
}
