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
  ToolDefinition,
} from "@litt/agent-core";
import { getProvider, type ProviderId } from "@litt/models";
import type { RoutedModel } from "./model-runtime.js";
import {
  type NativeToolSchema,
  type OpenAiToolNameMap,
  toOpenAiToolSchemas,
  resolveCanonicalToolId,
} from "./openai-tool-names.js";

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
  /** Max response tokens. Defaults to LITT_MAX_TOKENS env or 3000. */
  maxTokens?: number;
  /**
   * Native tool definitions (OpenAI-compatible `tools` request field).
   *
   * When provided, the API request declares these as REAL function tools
   * so the model sees actual tool schemas instead of relying on a
   * prompt-only protocol. Models that only emit native `tool_calls` now
   * work; the provider translates native calls back into LiTT's internal
   * `tool_call` fence blocks so the agent loop keeps ONE parsing path.
   *
   * Without this, frontier models often conclude "I have no tools in
   * this session" and answer in prose — the observed live dogfood
   * failure ("I'm unable to access the project status tool...").
   */
  tools?: ToolDefinition[];
  /**
   * Transport stall watchdog (ms): abort the stream when NO bytes arrive
   * for this long. Prevents a silently-dropped SSE connection from
   * leaving the run stuck in "Working" forever (dogfood P0). Real work
   * keeps producing bytes — this only fires on a true stall.
   * Default 90_000ms. Tests inject a tiny value.
   */
  idleStallMs?: number;
}

/** Default stall threshold — 90s without a single stream byte. */
export const DEFAULT_IDLE_STALL_MS = 90_000;

// ─── Max tokens policy ──────────────────────────────────────────────
//
// Configurable max response tokens. Previously hardcoded to 4096, which
// OpenRouter rejects when the remaining credit balance can't cover that
// many output tokens — the request dies BEFORE the model answers with an
// ugly "Model error" reaching the user.
//
//   LITT_MAX_TOKENS env var → explicit override (highest priority)
//   explicit option.maxTokens → caller override (tests, profiles)
//   DEFAULT_MAX_TOKENS        → 3000 (conservative production default)
//
// The configurable limit is the clean fix. The insufficient-credits
// retry ladder (below) is the graceful-degradation backstop on top of it.

/** Conservative default max response tokens (avoids OpenRouter credit rejections). */
export const DEFAULT_MAX_TOKENS = 3000;

/**
 * Resolve the max_tokens for a request.
 *
 * Priority: explicit numeric override > LITT_MAX_TOKENS env > DEFAULT_MAX_TOKENS.
 * A non-positive override is ignored (falls through to env/default) so a
 * misconfigured profile can't zero out the request.
 */
export function resolveMaxTokens(override?: number): number {
  if (typeof override === "number" && override > 0) return Math.floor(override);
  const env = Number(process.env.LITT_MAX_TOKENS);
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  return DEFAULT_MAX_TOKENS;
}

// ─── Insufficient-credits retry ─────────────────────────────────────
//
// OpenRouter rejects a request when the remaining credit balance can't
// cover the requested max_tokens. The error surfaces either as HTTP 402
// or as an SSE error chunk mentioning credits/balance. This is a
// SPECIFIC, identifiable condition — not a generic failure — so a
// graceful stepped retry is safe and never silently degrades other
// failure modes (rate limits, auth, network, model unavailable all
// still surface as hard errors).
//
// This is the ONLY place max_tokens is lowered, and ONLY on a confirmed
// insufficient-credits error. The resolver (resolveProviderAdapter)
// never lowers max_tokens — the existing "no silent max_tokens lowering"
// contract holds at the routing layer.

/**
 * Error thrown when the provider rejects a request because the remaining
 * credit/balance can't cover the requested max_tokens. Carries the
 * affordable token count when OpenRouter surfaces it.
 */
export class InsufficientCreditsError extends Error {
  /** Tokens the provider said the balance could cover, if reported. */
  readonly affordableTokens?: number;
  constructor(message: string, affordableTokens?: number) {
    super(message);
    this.name = "InsufficientCreditsError";
    this.affordableTokens = affordableTokens;
  }
}

/** True when `err` is an InsufficientCreditsError. */
export function isInsufficientCreditsError(err: unknown): err is InsufficientCreditsError {
  return err instanceof InsufficientCreditsError;
}

// Credit-error signature: HTTP 402, or message mentions credits/balance/
// "insufficient" tokens / "payment required". Kept deliberately narrow so
// unrelated failures (auth, rate limit, model gone) are NOT retried by
// lowering max_tokens — they surface as hard errors.
const CREDIT_ERROR_RE = /\b(credit|balance|insufficient|payment required|afford)\b/i;

/**
 * Promote a generic provider Error into an InsufficientCreditsError when
 * its message matches the credit-error signature. Returns the original
 * error unchanged otherwise. Never returns null — call sites rethrow.
 */
export function classifyStreamError(err: unknown): Error {
  if (err instanceof Error) {
    if (isInsufficientCreditsError(err)) return err;
    if (CREDIT_ERROR_RE.test(err.message)) {
      // OpenRouter's message often contains the affordable token count
      // (e.g. "...only supports 3624"). Pull the largest 3-4 digit number.
      const match = err.message.match(/(\d{3,5})/g);
      const affordable = match
        ? match.map((n) => Number(n)).reduce((a, b) => (b > a ? b : a), 0)
        : undefined;
      return new InsufficientCreditsError(
        err.message,
        affordable && Number.isFinite(affordable) ? affordable : undefined,
      );
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Stepped max_tokens fallback ladder for insufficient-credits retry.
 *   [initial, 75% of initial, 50% of initial] with a 256-token floor.
 * Dedups so a small initial never produces a no-op ladder. Each step is
 * only attempted when OpenRouter explicitly rejected the previous value
 * for insufficient credits — never for other failures.
 */
export function buildMaxTokensLadder(initial: number): number[] {
  const floor = 256;
  const rawSteps = [initial, Math.round(initial * 0.75), Math.round(initial * 0.5)];
  const seen = new Set<number>();
  const ladder: number[] = [];
  for (const s of rawSteps) {
    const v = Math.max(floor, Math.floor(s));
    if (!seen.has(v)) {
      seen.add(v);
      ladder.push(v);
    }
  }
  return ladder;
}

export function hasOpenRouterKey(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

/**
 * Check if any provider key is configured (OpenRouter or a direct
 * native provider key). Used by the controller to decide whether
 * local BYOK is available as a fallback to the managed remote.
 */
export function hasProviderKey(): boolean {
  return !!(
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY
  );
}

export class OpenRouterModelProvider implements ModelProvider {
  /** This adapter always serves via OpenRouter (source truth for the controller). */
  readonly providerId = "openrouter" as const;
  private readonly _apiKey: string;
  private readonly _model: string;
  private readonly _profile: ModelProfile;
  private readonly _maxTokens: number;
  private readonly _idleStallMs: number;
  /** Native OpenAI-compatible tool schemas — null when not provided. */
  private readonly _tools: NativeToolSchema[] | null;
  /**
   * Reverse map: OpenAI-safe function name -> canonical LiTT tool ID.
   * Used to translate incoming native `tool_calls` back to the canonical ID
   * the ToolRegistry expects. Null when no tools are provided.
   */
  private readonly _toolNameMap: OpenAiToolNameMap | null;
  /** The active model — set after the first stream() meta event. */
  private _activeModel: string | null = null;

  constructor(options: OpenRouterModelOptions = {}) {
    this._apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    if (!this._apiKey) {
      throw new Error("OPENROUTER_API_KEY is required for OpenRouterModelProvider");
    }
    this._profile = options.profile ?? "smart";
    this._maxTokens = resolveMaxTokens(options.maxTokens);
    this._idleStallMs = options.idleStallMs ?? DEFAULT_IDLE_STALL_MS;
    // Build sanitized OpenAI-safe tool schemas. toOpenAiToolSchemas throws
    // (here, in the constructor — BEFORE any API request) on collision or
    // invalid names so we never send an OpenAI-rejected tool set.
    if (options.tools && options.tools.length > 0) {
      const { schemas, map } = toOpenAiToolSchemas(options.tools);
      this._tools = schemas;
      this._toolNameMap = map;
    } else {
      this._tools = null;
      this._toolNameMap = null;
    }

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
    // Emit meta ONCE — this is where activeModel becomes known. Retries
    // (insufficient-credits stepped fallback) re-issue the fetch with a
    // lower max_tokens but do NOT re-emit meta; the model/provider are
    // unchanged, only the token budget is stepped down.
    emit({
      type: "meta",
      provider: "openrouter",
      model: this._model,
      profile: this._profile,
    });

    // ─── Insufficient-credits graceful retry ───────────────────────
    // OpenRouter rejects a request when the remaining credit balance
    // can't cover max_tokens — usually as HTTP 402 BEFORE the model
    // answers, killing the run with an ugly "Model error". We step
    // max_tokens down the ladder (initial → 75% → 50%) and retry, but
    // ONLY when no deltas have been emitted yet on the failing attempt
    // (otherwise retrying would corrupt the transcript with duplicated
    // partial content). Non-credit failures surface as hard errors.
    const ladder = buildMaxTokensLadder(this._maxTokens);
    let lastErr: unknown;
    for (let i = 0; i < ladder.length; i++) {
      const attemptMax = ladder[i];
      const state = { emittedDelta: false };
      if (i > 0) {
        // Surfaced (not silent) — consistent with the [litt-diag] pattern.
        // Gated by LITT_DIAG=1 for production quietness; the retry itself
        // is always attempted regardless of diagnostic visibility.
        if (process.env.LITT_DIAG === "1") {
          process.stderr.write(
            `[litt-diag][OR-CREDIT-RETRY] insufficient credits for max_tokens=${ladder[i - 1]} ` +
            `→ retrying at max_tokens=${attemptMax} (step ${i + 1}/${ladder.length})\n`,
          );
        }
      }
      try {
        return await this.streamOnce(messages, emit, attemptMax, state);
      } catch (err) {
        // Never retry once content has started streaming to the user —
        // a partial response must not be followed by a second one.
        if (state.emittedDelta) throw err;
        const classified = classifyStreamError(err);
        if (isInsufficientCreditsError(classified) && i < ladder.length - 1) {
          lastErr = classified;
          continue;
        }
        throw classified;
      }
    }
    // Unreachable when the ladder has ≥1 step, but keeps TS happy and
    // surfaces the last credit error if the ladder were ever empty.
    throw lastErr ?? new Error("OpenRouter stream exhausted credit-retry ladder with no result");
  }

  /**
   * Single streaming attempt against OpenRouter at a fixed max_tokens.
   * Throws on any error (HTTP non-ok, SSE error chunk, stall abort).
   * Sets `state.emittedDelta = true` on the first content delta so the
   * retry loop knows never to retry after partial content has streamed.
   */
  private async streamOnce(
    messages: ChatMessage[],
    emit: (event: ModelStreamEvent) => void,
    maxTokens: number,
    state: { emittedDelta: boolean },
  ): Promise<ModelResult> {
    // ─── Transport stall watchdog (dogfood P0) ─────────────────────
    // A silently-dropped SSE connection (network cut, proxy hang) can
    // otherwise leave reader.read() pending forever → the run stays
    // "Working" with no way out. Real work keeps producing bytes; this
    // only aborts when NOTHING has arrived for idleStallMs. The timer
    // is re-armed on every received chunk, so the abort fires exactly
    // idleStallMs after the last byte — no poll-interval quantization.
    const abort = new AbortController();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (!abort.signal.aborted) {
          abort.abort();
        }
      }, this._idleStallMs);
    };
    if (this._idleStallMs > 0) {
      armStallTimer();
    }

    try {
      // ─── DIAGNOSTIC (OpenRouter fetch) — gated by LITT_DIAG=1 ───
      if (process.env.LITT_DIAG === "1") {
        process.stderr.write(
          `[litt-diag][FETCH-OR] providerId=openrouter host=openrouter.ai ` +
          `model=${this._model} max_tokens=${maxTokens}\n`,
        );
      }
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
          max_tokens: maxTokens,
          // Declare the project tools NATIVELY (OpenAI function calling).
          // The model sees real tool schemas — it no longer has to guess
          // from a prompt-only protocol (the "unable to access the tool"
          // dogfood failure). tool_choice defaults to "auto".
          ...(this._tools ? { tools: this._tools } : {}),
        }),
        signal: abort.signal,
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
      // Native tool_calls arrive as fragmented deltas (per index): the
      // name arrives once, `arguments` may be split across many chunks.
      const nativeToolCalls: Array<{ name: string; args: string }> = [];
      const accumulateToolCalls = (calls: unknown): void => {
        if (!Array.isArray(calls)) return;
        for (const tc of calls as Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>) {
          const idx = tc.index ?? 0;
          nativeToolCalls[idx] ??= { name: "", args: "" };
          if (tc.function?.name) nativeToolCalls[idx].name = tc.function.name;
          if (tc.function?.arguments) nativeToolCalls[idx].args += tc.function.arguments;
        }
      };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        // Bytes arrived — restart the stall clock.
        armStallTimer();
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
            // Surface upstream errors embedded in SSE chunks (e.g. credit
            // limits, model unavailable). Without this the provider silently
            // returns empty content and the caller never learns why the
            // stream produced no deltas.
            if (parsed.error) {
              const errMsg = parsed.error.message ?? "OpenRouter stream error";
              throw new Error(`OpenRouter stream error: ${errMsg}`);
            }
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              if (!state.emittedDelta) state.emittedDelta = true;
              content += delta.content;
              emit({ type: "delta", text: delta.content });
            }
            // Native streaming tool_calls (OpenAI function-calling deltas).
            accumulateToolCalls(delta?.tool_calls);
            // Non-streaming shape (some proxies return it even in stream mode).
            accumulateToolCalls(parsed.choices?.[0]?.message?.tool_calls);
            // Capture the model the API actually used (may differ from configured
            // when profile is "auto" and OpenRouter routed to a specific model)
            if (parsed.model) {
              resolvedModel = parsed.model as string;
            }
            if (parsed.usage?.total_tokens) {
              totalTokens = parsed.usage.total_tokens;
            }
          } catch (e) {
            // Re-throw upstream provider errors so the agent loop can surface
            // them instead of silently retrying on empty content.
            if (e instanceof Error && e.message.startsWith("OpenRouter stream error:")) {
              throw e;
            }
            // Skip malformed/unparseable chunks
          }
        }
      }

      // ─── Native tool_calls → internal fence format ───────────────
      // The model called a tool natively (it saw the real schema). Render
      // each call as LiTT's `tool_call` fence block so the agent loop's
      // single parser executes it — the loop never learns about the
      // transport protocol, and the model output stays model-shaped.
      //
      // REVERSE MAPPING: OpenAI called the sanitized function name
      // (e.g. `project_status`). Translate it back to the canonical LiTT
      // tool ID (e.g. `project.status`) so ToolRegistry.execute() dispatches
      // to the right tool.
      const nativeBlocks = nativeToolCalls
        .filter((tc) => tc.name)
        .map((tc) => {
          let inputs: unknown = {};
          if (tc.args) {
            try {
              inputs = JSON.parse(tc.args);
            } catch {
              inputs = {};
            }
          }
          const canonicalToolId = resolveCanonicalToolId(tc.name, this._toolNameMap);
          return `\`\`\`tool_call\n${JSON.stringify({ tool: canonicalToolId, inputs }, null, 2)}\n\`\`\``;
        })
        .join("\n");
      if (nativeBlocks) {
        content = content ? `${content}\n${nativeBlocks}` : nativeBlocks;
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
    } catch (err) {
      // Distinguish a watchdog abort from a real API error — the run
      // must reconcile as a terminal error, not spin forever.
      if (abort.signal.aborted) {
        throw new Error(
          "OpenRouter stream stalled — no data received for a while. " +
          "The connection appears to have been dropped, so the run was stopped instead of hanging.",
        );
      }
      throw err;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
    }
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

// ─── Native OpenAI-compatible provider adapter ─────────────────────
//
// Many LiTT providers (OpenAI, xAI, DeepSeek, Kimi/Moonshot, Mistral,
// Qwen/DashScope) expose an OpenAI-compatible /chat/completions endpoint.
// This adapter calls the provider's NATIVE API directly with the user's
// direct (BYOK) key, using the provider-native model id (providerModelId),
// NOT the OpenRouter slug.
//
// This is what makes configured OpenAI BYOK take precedence over the
// OpenRouter fallback: when the registry resolves servedBy === "openai"
// (because OPENAI_API_KEY is set), the resolver below picks this adapter
// and the request goes to api.openai.com, never openrouter.ai.
//
// Anthropic and Google/Gemini have non-OpenAI-compatible APIs and are
// NOT handled here — they fall back to OpenRouter until dedicated
// adapters are added.

/**
 * Providers served by this native OpenAI-compatible adapter.
 * Each must have a `chatUrl` in PROVIDERS (from @litt/models).
 */
export const OPENAI_COMPATIBLE_NATIVE_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  "openai",
  "xai",
  "deepseek",
  "kimi",
  "mistral",
  "qwen",
]);

export interface OpenAICompatibleModelOptions {
  /** The native provider this adapter serves (e.g. "openai", "xai"). */
  providerId: ProviderId;
  /** The provider's chat completions endpoint (from PROVIDERS.chatUrl). */
  endpoint: string;
  /** Direct API key for the provider (BYOK). Required. */
  apiKey: string;
  /** The provider-native model id (e.g. "gpt-5.6-luna"). Required. */
  model: string;
  profile?: ModelProfile;
  maxTokens?: number;
  tools?: ToolDefinition[];
  idleStallMs?: number;
}

/**
 * OpenAI-compatible native provider adapter.
 *
 * Streams from the provider's own /chat/completions endpoint using the
 * user's direct key. Surfaces upstream errors (rate limits, credit
 * errors, model unavailable) by throwing — never converts a provider
 * error into an empty content response. Reports `provider: <providerId>`
 * in meta/result so the controller can display the REAL served provider.
 */
export class OpenAICompatibleModelProvider implements ModelProvider {
  readonly providerId: ProviderId;
  private readonly _endpoint: string;
  private readonly _apiKey: string;
  private readonly _model: string;
  private readonly _profile: ModelProfile;
  private readonly _maxTokens: number;
  private readonly _idleStallMs: number;
  private readonly _tools: NativeToolSchema[] | null;
  /**
   * Reverse map: OpenAI-safe function name -> canonical LiTT tool ID.
   * Used to translate incoming native `tool_calls` back to the canonical ID
   * the ToolRegistry expects. Null when no tools are provided.
   */
  private readonly _toolNameMap: OpenAiToolNameMap | null;
  private _activeModel: string | null = null;

  constructor(options: OpenAICompatibleModelOptions) {
    this.providerId = options.providerId;
    this._endpoint = options.endpoint;
    this._apiKey = options.apiKey;
    if (!this._apiKey) {
      throw new Error(`${options.providerId} API key is required for OpenAICompatibleModelProvider`);
    }
    this._model = options.model;
    if (!this._model) {
      throw new Error(`${options.providerId} model id is required for OpenAICompatibleModelProvider`);
    }
    this._profile = options.profile ?? "smart";
    this._maxTokens = resolveMaxTokens(options.maxTokens);
    this._idleStallMs = options.idleStallMs ?? DEFAULT_IDLE_STALL_MS;
    // Build sanitized OpenAI-safe tool schemas. toOpenAiToolSchemas throws
    // (here, in the constructor — BEFORE any API request) on collision or
    // invalid names so we never send an OpenAI-rejected tool set.
    if (options.tools && options.tools.length > 0) {
      const { schemas, map } = toOpenAiToolSchemas(options.tools);
      this._tools = schemas;
      this._toolNameMap = map;
    } else {
      this._tools = null;
      this._toolNameMap = null;
    }
  }

  get configuredModel(): string {
    return this._model;
  }

  get activeModel(): string | null {
    return this._activeModel;
  }

  get profile(): ModelProfile {
    return this._profile;
  }

  async stream(
    messages: ChatMessage[],
    emit: (event: ModelStreamEvent) => void,
  ): Promise<ModelResult> {
    // Emit meta — provider is the NATIVE provider actually serving.
    emit({
      type: "meta",
      provider: this.providerId,
      model: this._model,
      profile: this._profile,
    });

    // Transport stall watchdog (same discipline as OpenRouter adapter).
    const abort = new AbortController();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (!abort.signal.aborted) abort.abort();
      }, this._idleStallMs);
    };
    if (this._idleStallMs > 0) armStallTimer();

    try {
      // ─── DIAGNOSTIC (native OpenAI-compatible fetch) — gated by LITT_DIAG=1 ───
      let diagHost = this._endpoint;
      try { diagHost = new URL(this._endpoint).host; } catch { /* keep endpoint */ }
      if (process.env.LITT_DIAG === "1") {
        process.stderr.write(
          `[litt-diag][FETCH-NATIVE] providerId=${this.providerId} host=${diagHost} ` +
          `model=${this._model} max_tokens=${this._maxTokens}\n`,
        );
      }
      const response = await fetch(this._endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this._apiKey}`,
        },
        body: JSON.stringify({
          model: this._model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
          // Provider-boundary parameter translation: OpenAI's newer model
          // families (gpt-5.x, o1, o3, etc.) reject the legacy `max_tokens`
          // parameter and require `max_completion_tokens`. Other
          // OpenAI-compatible providers (xai, deepseek, kimi, mistral, qwen)
          // still use `max_tokens`. Send the right one per provider.
          ...(this.providerId === "openai"
            ? { max_completion_tokens: this._maxTokens }
            : { max_tokens: this._maxTokens }),
          ...(this._tools ? { tools: this._tools } : {}),
          // OpenAI reasoning models (gpt-5.x) default to a non-none
          // reasoning_effort that is incompatible with function tools on
          // /chat/completions. When tools are present, explicitly disable
          // reasoning so the model can call functions. Without this OpenAI
          // returns 400: "Function tools with reasoning_effort are not
          // supported ... set reasoning_effort to 'none'."
          ...(this.providerId === "openai" && this._tools
            ? { reasoning_effort: "none" }
            : {}),
        }),
        signal: abort.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error");
        throw new Error(`${this.providerId} API error ${response.status}: ${errorText}`);
      }
      if (!response.body) {
        throw new Error(`${this.providerId} returned no response body`);
      }

      let content = "";
      let totalTokens = 0;
      let resolvedModel = this._model;
      const nativeToolCalls: Array<{ name: string; args: string }> = [];
      const accumulateToolCalls = (calls: unknown): void => {
        if (!Array.isArray(calls)) return;
        for (const tc of calls as Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>) {
          const idx = tc.index ?? 0;
          nativeToolCalls[idx] ??= { name: "", args: "" };
          if (tc.function?.name) nativeToolCalls[idx].name = tc.function.name;
          if (tc.function?.arguments) nativeToolCalls[idx].args += tc.function.arguments;
        }
      };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        armStallTimer();
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
            // Surface upstream errors embedded in SSE chunks (rate limits,
            // credit errors, model unavailable). Without this the provider
            // silently returns empty content and the caller never learns
            // why the stream produced no deltas.
            if (parsed.error) {
              const errMsg = parsed.error.message ?? `${this.providerId} stream error`;
              throw new Error(`${this.providerId} stream error: ${errMsg}`);
            }
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              content += delta.content;
              emit({ type: "delta", text: delta.content });
            }
            accumulateToolCalls(delta?.tool_calls);
            accumulateToolCalls(parsed.choices?.[0]?.message?.tool_calls);
            if (parsed.model) resolvedModel = parsed.model as string;
            if (parsed.usage?.total_tokens) totalTokens = parsed.usage.total_tokens;
          } catch (e) {
            // Re-throw upstream provider errors so the agent loop surfaces
            // them instead of silently retrying on empty content.
            if (e instanceof Error && e.message.includes("stream error:")) {
              throw e;
            }
            // Skip malformed/unparseable chunks
          }
        }
      }

      // Native tool_calls → internal fence format (same as OpenRouter).
      //
      // REVERSE MAPPING: OpenAI called the sanitized function name
      // (e.g. `project_status`). Translate it back to the canonical LiTT
      // tool ID (e.g. `project.status`) so ToolRegistry.execute() dispatches
      // to the right tool.
      const nativeBlocks = nativeToolCalls
        .filter((tc) => tc.name)
        .map((tc) => {
          let inputs: unknown = {};
          if (tc.args) {
            try { inputs = JSON.parse(tc.args); } catch { inputs = {}; }
          }
          const canonicalToolId = resolveCanonicalToolId(tc.name, this._toolNameMap);
          return `\`\`\`tool_call\n${JSON.stringify({ tool: canonicalToolId, inputs }, null, 2)}\n\`\`\``;
        })
        .join("\n");
      if (nativeBlocks) {
        content = content ? `${content}\n${nativeBlocks}` : nativeBlocks;
      }

      this._activeModel = resolvedModel;

      return {
        content,
        model: resolvedModel,
        provider: this.providerId,
        usage: { total_tokens: totalTokens || Math.ceil(content.length / 4) },
        timing: { ttftMs: 0, generationMs: 0, totalMs: 0 },
        profile: this._profile,
      };
    } catch (err) {
      if (abort.signal.aborted) {
        throw new Error(
          `${this.providerId} stream stalled — no data received for a while. ` +
          "The connection appears to have been dropped, so the run was stopped instead of hanging.",
        );
      }
      throw err;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
    }
  }

  async health(): Promise<number> {
    const def = getProvider(this.providerId);
    if (!def?.modelsUrl) return 0;
    try {
      const response = await fetch(def.modelsUrl, {
        headers: { "Authorization": `Bearer ${this._apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok ? 1 : 0;
    } catch {
      return 0;
    }
  }
}

// ─── Provider resolver — picks the adapter by servedBy ──────────────
//
// This is the bridge between the routing layer (which knows servedBy:
// the provider that SHOULD serve the call) and the adapter layer (which
// actually issues the HTTP request). The resolver honors the routing
// decision: configured direct (BYOK) keys take precedence over the
// OpenRouter fallback because the registry already encodes that
// precedence into servedBy.
//
// Routing precedence (enforced here):
//   1. Explicit OpenRouter selection (servedBy === "openrouter") → OpenRouter
//   2. Native OpenAI-compatible provider with a direct key → native adapter
//   3. OpenRouter fallback only when the native provider has no adapter
//      (Anthropic/Google) OR no direct key, and OpenRouter can service it.
//
// The adapter's `providerId` is the source of truth for which provider
// ACTUALLY handled the request — the controller reads it after streaming
// to display the real served provider, not merely the intended one.

/** A union of both adapter types the resolver can return. */
export type ResolvedModelProvider = OpenRouterModelProvider | OpenAICompatibleModelProvider;

export interface ResolveProviderAdapterOptions {
  /** Native tool definitions to declare on the transport. */
  tools?: ToolDefinition[];
  /** Override max_tokens (defaults to LITT_MAX_TOKENS env or 3000). */
  maxTokens?: number;
  /** Override the stall watchdog (tests inject a tiny value). */
  idleStallMs?: number;
}

/**
 * Resolve which adapter should serve a routed model, and construct it.
 *
 * Throws a clear error when no adapter can service the model (e.g. the
 * native provider has no direct key AND no OpenRouter fallback is
 * available) — never silently falls back to a provider that will fail.
 */
export function resolveProviderAdapter(
  routed: RoutedModel,
  options: ResolveProviderAdapterOptions = {},
): ResolvedModelProvider {
  const tools = options.tools;
  const maxTokens = options.maxTokens;
  const idleStallMs = options.idleStallMs;
  const servedBy = routed.servedBy;

  // 1. Native OpenAI-compatible provider with a direct key → native adapter.
  if (OPENAI_COMPATIBLE_NATIVE_PROVIDERS.has(servedBy)) {
    const def = getProvider(servedBy);
    const apiKey = def?.envKey ? process.env[def.envKey] : undefined;
    if (def?.chatUrl && apiKey) {
      const modelId = routed.providerModelId ?? routed.openRouterModelId;
      if (!modelId) {
        throw new Error(`No provider model id for ${routed.label} (servedBy ${servedBy})`);
      }
      return new OpenAICompatibleModelProvider({
        providerId: servedBy,
        endpoint: def.chatUrl,
        apiKey,
        model: modelId,
        tools,
        maxTokens,
        idleStallMs,
      });
    }
    // Direct key missing — fall through to OpenRouter fallback below.
  }

  // 2. OpenRouter — either explicitly selected, or fallback for a native
  //    provider whose direct key is not configured / has no native adapter.
  if (routed.openRouterModelId && hasOpenRouterKey()) {
    return new OpenRouterModelProvider({
      model: routed.openRouterModelId,
      tools,
      maxTokens,
      idleStallMs,
    });
  }

  // 3. Nothing can service this model — surface a clear error instead of
  //    silently constructing an adapter that will fail with a confusing
  //    credit/auth error at stream time.
  const needed = servedBy === "openrouter"
    ? "OPENROUTER_API_KEY"
    : OPENAI_COMPATIBLE_NATIVE_PROVIDERS.has(servedBy)
      ? `${getProvider(servedBy)?.envKey ?? servedBy.toUpperCase() + "_API_KEY"} (or OPENROUTER_API_KEY as fallback)`
      : `a direct ${servedBy} key or OPENROUTER_API_KEY`;
  throw new Error(
    `No provider adapter can service ${routed.label}: ${needed} is not configured. ` +
    `Routing resolved servedBy="${servedBy}" but no matching credential is available.`,
  );
}

// ─── Provider display label ─────────────────────────────────────────

/**
 * Human label for a provider id, for the status bar / header.
 *   "openai" → "OpenAI", "openrouter" → "OpenRouter", etc.
 */
export function providerLabel(id: ProviderId | string | null | undefined): string {
  if (!id) return "";
  const def = getProvider(id as ProviderId);
  if (def) return def.label;
  return id.charAt(0).toUpperCase() + id.slice(1);
}
