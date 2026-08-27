export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// ── NDJSON event protocol (emitted by streamLiTTCode) ───────────────────────
// {"type":"meta","provider":"ollama|openrouter|openai","model":"...","profile":"fast|smart|long|auto"}
// {"type":"delta","text":"chunk"}
// {"type":"done","model":"...","usage":{"total_tokens":N},"timing":{"ttftMs":N,"generationMs":N,"totalMs":N}}
// {"type":"error","message":"..."}
/**
 * `prompt_tokens`/`completion_tokens` are optional because Ollama's
 * local responses don't always report a split — `total_tokens` is the
 * only field every provider guarantees. OpenRouter and direct OpenAI
 * (the two providers ever billed) always populate all three.
 */
export type LiTTUsage = {
  total_tokens: number;
  prompt_tokens?: number;
  completion_tokens?: number;
};

export type LiTTProvider = "ollama" | "openrouter" | "openai";

export type LiTTEvent =
  | { type: "meta"; provider: LiTTProvider; model: string; profile: ModelProfile }
  | { type: "delta"; text: string }
  | { type: "tool_call_chunk"; index: number; id?: string; name?: string; argsChunk?: string }
  | { type: "done"; model: string; usage: LiTTUsage; timing: LiTTTiming }
  | { type: "error"; message: string };

export type LiTTResult = {
  content: string;
  model: string;
  provider: LiTTProvider;
  usage: LiTTUsage;
  timing: LiTTTiming;
  profile: ModelProfile;
};

export type LiTTTiming = {
  ttftMs: number;        // first token received - provider request start
  generationMs: number;  // last token - first token
  totalMs: number;       // last token - provider request start
};

// ── Model profiles — single source of truth ─────────────────────────────────
// Env overrides (never overwrite user-provided values):
//   LITT_MODEL_FAST / LITT_MODEL_SMART / LITT_MODEL_LONG / LITT_MODEL_DEFAULT
//   LITT_MODEL_OVERRIDE  — exact model string, wins over everything
//   LITT_PROFILE         — fast|smart|long|auto, wins over auto-routing
export type ModelProfile = "fast" | "smart" | "long" | "auto";

const MODEL_PROFILES: Record<Exclude<ModelProfile, "auto">, string> = {
  fast:  process.env.LITT_MODEL_FAST  || "openai/gpt-oss-20b:nitro",
  smart: process.env.LITT_MODEL_SMART || "openai/gpt-oss-120b:nitro",
  long:  process.env.LITT_MODEL_LONG  || "google/gemini-3.1-flash-lite:nitro",
};

const DEFAULT_PROFILE: ModelProfile =
  (process.env.LITT_MODEL_DEFAULT as ModelProfile) || "fast";

const DEFAULT_OLLAMA_MODEL = process.env.LITT_OLLAMA_MODEL || "llama3.2:3b";

// Resolve the model + profile for a given prompt.
// Precedence: LITT_MODEL_OVERRIDE > LITT_PROFILE > auto-routing > DEFAULT_PROFILE.
function resolveProfile(prompt: string): { profile: ModelProfile; model: string } {
  const override = process.env.LITT_MODEL_OVERRIDE?.trim();
  if (override) return { profile: "auto", model: override };

  const explicit = process.env.LITT_PROFILE?.trim().toLowerCase() as ModelProfile | undefined;
  if (explicit && explicit !== "auto") {
    const m = MODEL_PROFILES[explicit as Exclude<ModelProfile, "auto">];
    if (m) return { profile: explicit, model: m };
  }

  // Auto-routing (conservative): only escalate on clearly heavy requests.
  // Explicit user selection always wins; default stays FAST.
  if (explicit === "auto" || DEFAULT_PROFILE === "auto") {
    const auto = autoRoute(prompt);
    return { profile: auto, model: MODEL_PROFILES[auto] };
  }

  const def = DEFAULT_PROFILE as Exclude<ModelProfile, "auto">;
  return { profile: def, model: MODEL_PROFILES[def] };
}

// Conservative heuristics. Do NOT jump to heavy models for trivial questions.
function autoRoute(prompt: string): "fast" | "smart" | "long" {
  const len = prompt.length;
  const lower = prompt.toLowerCase();
  // Very large context / repo-wide operations → LONG
  if (len > 24000) return "long";
  if (/\b(whole repo|entire codebase|all files|full repository|monorepo wide)\b/.test(lower) && len > 6000) return "long";
  // Large debugging / architecture / refactor → SMART
  if (len > 6000) return "smart";
  if (/\b(architect|refactor|redesign|debug this|trace through|explain the architecture|design (a |the )?system|migration plan)\b/.test(lower) && len > 800) return "smart";
  // Everything else → FAST
  return "fast";
}

// ── Web search detection ────────────────────────────────────────────────────
// Detects when a prompt needs realtime web data. Conservative — don't trigger
// web search for coding questions that the model can answer from training data.
// Env overrides:
//   LITT_WEB_SEARCH=off   disables auto-detection entirely
//   LITT_WEB_ENGINE=exa|perplexity|native|parallel|firecrawl|auto  (default: perplexity)
function needsWebSearch(prompt: string): boolean {
  if (process.env.LITT_WEB_SEARCH === "off") return false;
  const lower = prompt.toLowerCase();
  // Explicit web search prefixes
  if (/^(\/web|\/search)\b/.test(lower)) return true;
  if (/\b(search the web|google this|look up|web search)\b/.test(lower)) return true;
  // Realtime data keywords
  if (/\b(today|right now|currently|latest|this week|this month|this year|2026|2025)\b/.test(lower) &&
      /\b(price|stock|news|weather|score|election|release|update|version|status of)\b/.test(lower)) return true;
  // Stock/crypto tickers
  if (/\b(bitcoin|btc|ethereum|eth|stock price|nasdaq|s&p|dow jones|crypto price)\b/.test(lower)) return true;
  // Current events
  if (/\b(breaking news|what happened|what's happening|current events)\b/.test(lower)) return true;
  return false;
}

// Build the web search tool config with the configured engine.
function buildWebSearchTool(): unknown {
  const engine = process.env.LITT_WEB_ENGINE || "perplexity";
  const maxResults = Number(process.env.LITT_WEB_MAX_RESULTS || 5);
  return {
    type: "openrouter:web_search",
    parameters: { engine, max_results: maxResults },
  };
}

// ── Non-streaming (kept for back-compat) ────────────────────────────────────
// Ollama is tried first but may not be running. Use a short connect timeout
// so the fallback to OpenRouter is fast (default Node fetch has no timeout
// and will hang ~20s on a dead localhost port).
const OLLAMA_TIMEOUT_MS = Number(process.env.LITT_OLLAMA_TIMEOUT_MS || 1500);

function emptyTiming(): LiTTTiming {
  return { ttftMs: -1, generationMs: -1, totalMs: -1 };
}

async function chatWithOllama(
  messages: ChatMessage[],
  model = DEFAULT_OLLAMA_MODEL,
): Promise<LiTTResult> {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Ollama failed: ${res.status}`);
  const data = await res.json();
  const total_tokens =
    (data.prompt_eval_count || 0) + (data.eval_count || 0);
  return {
    content: data.message?.content ?? "",
    model: data.model || model,
    provider: "ollama",
    usage: { total_tokens },
    timing: emptyTiming(),
    profile: "auto",
  };
}

async function chatWithOpenRouter(
  messages: ChatMessage[],
  model: string,
): Promise<LiTTResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not configured");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://litlabs.net",
    },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`OpenRouter failed: ${res.status}`);
  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    model: data.model || model,
    provider: "openrouter",
    usage: { total_tokens: data.usage?.total_tokens ?? 0 },
    timing: emptyTiming(),
    profile: "auto",
  };
}

// ── Streaming ───────────────────────────────────────────────────────────────
async function streamChatWithOllama(
  messages: ChatMessage[],
  emit: (e: LiTTEvent) => void,
  model: string,
  profile: ModelProfile,
): Promise<LiTTResult> {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const t0 = Date.now();
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama stream failed: ${res.status}`);

  emit({ type: "meta", provider: "ollama", model, profile });
  let content = "";
  let total_tokens = 0;
  let finalModel = model;
  let tFirst = -1;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.message?.content) {
        if (tFirst < 0) tFirst = Date.now();
        content += obj.message.content;
        emit({ type: "delta", text: obj.message.content });
      }
      if (obj.model) finalModel = obj.model;
      if (obj.done) {
        total_tokens = (obj.prompt_eval_count || 0) + (obj.eval_count || 0);
      }
    }
  }
  const tEnd = Date.now();
  const timing: LiTTTiming = {
    ttftMs: tFirst >= 0 ? tFirst - t0 : -1,
    generationMs: tFirst >= 0 ? tEnd - tFirst : -1,
    totalMs: tEnd - t0,
  };
  emit({ type: "done", model: finalModel, usage: { total_tokens }, timing });
  return { content, model: finalModel, provider: "ollama", usage: { total_tokens }, timing, profile };
}

async function streamChatWithOpenRouter(
  messages: ChatMessage[],
  emit: (e: LiTTEvent) => void,
  model: string,
  profile: ModelProfile,
  useWebSearch = false,
): Promise<LiTTResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not configured");

  const t0 = Date.now();
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    // Cap at 3000 output tokens — the canonical managed-remote default
    // shared by CLI (DEFAULT_MAX_TOKENS) and terminal-server. Leaving this
    // undefined causes OpenRouter to default to the model's max_output_tokens
    // (e.g. 65536), which wastes credits and causes 402 errors.
    max_tokens: 3000,

    // TEMPORARY compatibility routing:
    // Groq currently rejects this model when it attempts native tool use
    // while LiTT is still using the text-form tool_call protocol.
    //
    // Keep fallbacks enabled so OpenRouter can use another endpoint for
    // the same model. Remove this once LiTT moves to native tool calling.
    provider: {
      ignore: ["groq"],
      allow_fallbacks: true,
    },
  };
  if (useWebSearch) {
    body.tools = [buildWebSearchTool()];
  }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://litlabs.net",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`OpenRouter stream failed: ${res.status}`);

  emit({ type: "meta", provider: "openrouter", model, profile });
  let content = "";
  let total_tokens = 0;
  let prompt_tokens = 0;
  let completion_tokens = 0;
  let finalModel = model;
  let tFirst = -1;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line || !line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let obj: any;
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }

      // OpenRouter may report provider/rate-limit/etc. errors MID-STREAM
      // while the HTTP response itself remains 200.
      // Never convert those into a silent empty assistant response.
      if (obj.error) {
        const code =
          obj.error?.code ??
          obj.choices?.[0]?.finish_reason ??
          "unknown";

        const message =
          obj.error?.message ??
          "Unknown OpenRouter streaming error";

        throw new Error(
          `OpenRouter stream error ${code}: ${message}`,
        );
      }

      if (obj.choices?.[0]?.finish_reason === "error") {
        throw new Error(
          "OpenRouter stream terminated with finish_reason=error",
        );
      }

      if (obj.model) finalModel = obj.model;
      const delta = obj.choices?.[0]?.delta?.content;
      if (delta) {
        if (tFirst < 0) tFirst = Date.now();
        content += delta;
        emit({ type: "delta", text: delta });
      }
      if (obj.usage?.total_tokens) total_tokens = obj.usage.total_tokens;
      if (obj.usage?.prompt_tokens) prompt_tokens = obj.usage.prompt_tokens;
      if (obj.usage?.completion_tokens) completion_tokens = obj.usage.completion_tokens;
    }
  }
  // A successful provider stream must produce assistant content.
  // Do not emit "done" for a zero-content completion.
  if (!content.trim()) {
    throw new Error(
      `OpenRouter stream completed without assistant content (model=${finalModel})`,
    );
  }

  const tEnd = Date.now();
  const timing: LiTTTiming = {
    ttftMs: tFirst >= 0 ? tFirst - t0 : -1,
    generationMs: tFirst >= 0 ? tEnd - tFirst : -1,
    totalMs: tEnd - t0,
  };
  const usage: LiTTUsage = { total_tokens, prompt_tokens, completion_tokens };
  emit({ type: "done", model: finalModel, usage, timing });
  return { content, model: finalModel, provider: "openrouter", usage, timing, profile };
}

// ── Remote model proxy for the CLI's interactive cockpit ────────────────────
//
// The CLI's local project tools MUST execute on the user's own machine (the
// server has no access to it) — so this function is deliberately a PURE
// model-completion proxy: it streams text + relays OpenRouter's raw native
// tool_calls deltas back to the caller, and does NOT execute any tools or
// touch any gateway/filesystem itself. The CLI's own agent loop (unchanged)
// executes tool calls locally exactly as it does for local-provider mode;
// only the model call moves server-side.
//
// This mirrors the exact wire shape OpenRouter itself uses for streaming
// native tool_calls (index/id/function.name/function.arguments fragments),
// so the CLI's existing accumulation/fence-block logic
// (model-provider.ts's OpenRouterModelProvider) can be reused almost
// unchanged for the remote transport.

export type RemoteToolSchema = {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

export interface StreamModelForRemoteClientOptions {
  /**
   * The model id to use, already resolved by the CLIENT's own routing.
   * For direct OpenAI: the provider-native id (e.g. "gpt-5.6-luna").
   * For OpenRouter: the OpenRouter slug (e.g. "openai/gpt-5.6-luna").
   * Required — this function never re-derives a model from the conversation content.
   */
  model: string;
  /**
   * The provider the CLIENT routed to ("openai", "openrouter", etc.).
   * The server uses this as a HINT — if the direct credential is
   * available, it prefers direct transport; otherwise it falls back
   * to OpenRouter and reports the actual provider truthfully.
   */
  providerHint?: string;
  /**
   * The OpenRouter fallback model id, used when the server cannot
   * serve the request via direct transport and falls back to OpenRouter.
   */
  openRouterModelId?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Stream a model completion for the CLI's remote model transport.
 *
 * Server-side transport selection:
 *   - If the CLI routed to "openai" and OPENAI_API_KEY is configured,
 *     use the DIRECT OpenAI transport (api.openai.com) with the
 *     provider-native model id. This is the preferred path for managed
 *     OpenAI access — no OpenRouter intermediary, no :nitro suffix,
 *     truthful provider attribution.
 *   - Otherwise (or if the direct key is absent), fall back to the
 *     OpenRouter transport with the OpenRouter model slug. The meta
 *     event always reports the ACTUAL provider, never a hardcoded value.
 *
 * Never Ollama — this channel is for managed cloud model access only.
 * Throws on any upstream failure; the caller (server.ts) is responsible
 * for redacting the error message before it reaches the client.
 */
export async function streamModelForRemoteClient(
  messages: ChatMessage[],
  tools: RemoteToolSchema[],
  emit: (e: LiTTEvent) => void,
  options: StreamModelForRemoteClientOptions,
): Promise<LiTTResult> {
  const model = options.model;
  if (!model) throw new Error("model is required for streamModelForRemoteClient");
  const profile: ModelProfile = "auto";

  // ── Server-side transport selection ──────────────────────────────
  // The CLI sends a providerHint ("openai", "openrouter", etc.) and
  // both model IDs. The server decides the actual transport based on
  // which managed credentials are available — the CLI never sees the
  // raw keys (PTY allowlist blocks them), so the server is the authority.
  const hint = options.providerHint?.toLowerCase();
  const openaiKey = process.env.OPENAI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  // Direct OpenAI transport: preferred when the CLI routed to openai
  // AND a real OpenAI key is configured AND the model id is NOT an
  // OpenRouter slug (no "/" prefix — OpenRouter slugs are "openai/...").
  // We also guard against an OpenRouter key accidentally placed in
  // OPENAI_API_KEY by checking the prefix.
  const isOpenRouterKeyInOpenaiSlot =
    openaiKey && openaiKey.startsWith("sk-or-v1-");
  const canUseDirectOpenAI =
    hint === "openai" &&
    !!openaiKey &&
    !isOpenRouterKeyInOpenaiSlot &&
    !model.includes("/");

  // Log transport selection (no key values exposed)
  console.log(`[transport] hint=${hint} model=${model} hasOpenAIKey=${!!openaiKey} isOpenRouterInOpenAI=${!!isOpenRouterKeyInOpenaiSlot} hasSlash=${model.includes("/")} canUseDirect=${canUseDirectOpenAI} hasOpenRouterKey=${!!openrouterKey}`);

  if (canUseDirectOpenAI) {
    console.log(`[transport] → direct OpenAI (api.openai.com)`);
    return streamOpenAIDirect(messages, tools, emit, {
      model, // provider-native id (e.g. "gpt-5.6-luna")
      apiKey: openaiKey!,
      maxTokens: options.maxTokens,
      signal: options.signal,
      profile,
    });
  }

  console.log(`[transport] → OpenRouter fallback (openrouter.ai)`);

  // Fallback: OpenRouter transport
  if (!openrouterKey) {
    if (isOpenRouterKeyInOpenaiSlot) {
      throw new Error(
        "OPENAI_API_KEY contains an OpenRouter key (sk-or-v1-...) — cannot use direct OpenAI transport. " +
        "Set a real OpenAI key (sk-proj-...) or configure OPENROUTER_API_KEY for fallback.",
      );
    }
    throw new Error("OPENROUTER_API_KEY not configured and direct OpenAI transport unavailable");
  }

  // Use the OpenRouter slug if available, otherwise the model id as-is
  const orModel = options.openRouterModelId ?? model;
  return streamOpenRouterRemote(messages, tools, emit, {
    model: orModel,
    apiKey: openrouterKey,
    maxTokens: options.maxTokens,
    signal: options.signal,
    profile,
  });
}

/**
 * Direct OpenAI transport — calls api.openai.com/v1/chat/completions
 * with the provider-native model id. Emits truthful meta events with
 * provider: "openai". Never uses OpenRouter.
 */
async function streamOpenAIDirect(
  messages: ChatMessage[],
  tools: RemoteToolSchema[],
  emit: (e: LiTTEvent) => void,
  options: { model: string; apiKey: string; maxTokens?: number; signal?: AbortSignal; profile: ModelProfile },
): Promise<LiTTResult> {
  const { model, apiKey, profile } = options;
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    // Cap at 3000 output tokens by default — the canonical managed-remote
    // default shared by CLI (DEFAULT_MAX_TOKENS) and terminal-server.
    // Leaving this undefined causes OpenRouter to default to the model's
    // max_output_tokens (e.g. 65536), which wastes credits and causes 402 errors.
    max_tokens: options.maxTokens && options.maxTokens > 0 ? options.maxTokens : 3000,
    ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!res.ok || !res.body) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${errorText || res.statusText}`);
  }

  emit({ type: "meta", provider: "openai", model, profile });
  return consumeSSEStream(res, emit, model, "openai", t0, profile);
}

/**
 * OpenRouter transport for the remote model channel. Calls
 * openrouter.ai/api/v1/chat/completions with the OpenRouter model slug.
 * Emits truthful meta events with provider: "openrouter".
 */
async function streamOpenRouterRemote(
  messages: ChatMessage[],
  tools: RemoteToolSchema[],
  emit: (e: LiTTEvent) => void,
  options: { model: string; apiKey: string; maxTokens?: number; signal?: AbortSignal; profile: ModelProfile },
): Promise<LiTTResult> {
  const { model, apiKey, profile } = options;
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    // Cap at 3000 output tokens by default — the canonical managed-remote
    // default shared by CLI (DEFAULT_MAX_TOKENS) and terminal-server.
    // Leaving this undefined causes OpenRouter to default to the model's
    // max_output_tokens (e.g. 65536), which wastes credits and causes 402 errors.
    max_tokens: options.maxTokens && options.maxTokens > 0 ? options.maxTokens : 3000,
    ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://litlabs.net",
      "X-Title": "LiTT CLI (remote)",
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!res.ok || !res.body) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`OpenRouter API error ${res.status}: ${errorText || res.statusText}`);
  }

  emit({ type: "meta", provider: "openrouter", model, profile });
  return consumeSSEStream(res, emit, model, "openrouter", t0, profile);
}

/**
 * Shared SSE stream consumer for OpenAI-compatible streaming responses
 * (both direct OpenAI and OpenRouter use the same SSE format).
 * Emits delta, tool_call_chunk, and done events. Returns the final
 * LiTTResult with the actual provider that served the request.
 */
async function consumeSSEStream(
  res: Response,
  emit: (e: LiTTEvent) => void,
  model: string,
  provider: LiTTProvider,
  t0: number,
  profile: ModelProfile,
): Promise<LiTTResult> {
  let content = "";
  let total_tokens = 0;
  let prompt_tokens = 0;
  let completion_tokens = 0;
  let finalModel = model;
  let tFirst = -1;

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line || !line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let obj: any;
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }

      if (obj.error) {
        const code = obj.error?.code ?? obj.choices?.[0]?.finish_reason ?? "unknown";
        const message = obj.error?.message ?? "Unknown streaming error";
        throw new Error(`${provider} stream error ${code}: ${message}`);
      }
      if (obj.choices?.[0]?.finish_reason === "error") {
        throw new Error(`${provider} stream terminated with finish_reason=error`);
      }

      if (obj.model) finalModel = obj.model;
      const delta = obj.choices?.[0]?.delta;
      if (delta?.content) {
        if (tFirst < 0) tFirst = Date.now();
        content += delta.content;
        emit({ type: "delta", text: delta.content });
      }
      if (Array.isArray(delta?.tool_calls)) {
        for (const tc of delta.tool_calls as Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>) {
          emit({
            type: "tool_call_chunk",
            index: tc.index ?? 0,
            id: tc.id,
            name: tc.function?.name,
            argsChunk: tc.function?.arguments,
          });
        }
      }
      if (obj.usage?.total_tokens) total_tokens = obj.usage.total_tokens;
      if (obj.usage?.prompt_tokens) prompt_tokens = obj.usage.prompt_tokens;
      if (obj.usage?.completion_tokens) completion_tokens = obj.usage.completion_tokens;
    }
  }

  const tEnd = Date.now();
  const timing: LiTTTiming = {
    ttftMs: tFirst >= 0 ? tFirst - t0 : -1,
    generationMs: tFirst >= 0 ? tEnd - tFirst : -1,
    totalMs: tEnd - t0,
  };
  const usage: LiTTUsage = { total_tokens, prompt_tokens, completion_tokens };
  emit({ type: "done", model: finalModel, usage, timing });
  return { content, model: finalModel, provider, usage, timing, profile };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Stream an already-built canonical conversation through LiTT's EXISTING
 * provider/model routing.
 *
 * This is intentionally the shared provider boundary for higher-level
 * runtimes such as the Desktop agent loop. It does NOT create another
 * provider client or another LiTT brain.
 */
export async function streamLiTTMessages(
  messages: ChatMessage[],
  emit: (e: LiTTEvent) => void,
  routingPrompt?: string,
): Promise<LiTTResult> {
  const promptForRouting =
    routingPrompt ??
    messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n\n");

  const { profile, model } = resolveProfile(promptForRouting);
  const webSearch = needsWebSearch(promptForRouting);

  // ── Direct OpenAI preferred path ──────────────────────────────
  // When OPENAI_API_KEY is set and the resolved model is an OpenAI
  // model (OpenRouter slug "openai/..."), convert to the native id
  // and call api.openai.com directly — no OpenRouter intermediary.
  const openaiKey = process.env.OPENAI_API_KEY;
  const isOpenRouterKeyInOpenaiSlot = openaiKey?.startsWith("sk-or-v1-");
  const isOpenAIModel = model.startsWith("openai/") && !webSearch;
  const canUseDirectOpenAI = !!openaiKey && !isOpenRouterKeyInOpenaiSlot && isOpenAIModel;

  if (canUseDirectOpenAI) {
    // Convert "openai/gpt-oss-20b:nitro" → "gpt-oss-20b"
    const nativeModel = model.replace(/^openai\//, "").replace(/:nitro$/, "");
    console.log(`[transport] /api/chat → direct OpenAI (api.openai.com) model=${nativeModel}`);
    try {
      return await streamOpenAIDirect(messages, [], emit, {
        model: nativeModel,
        apiKey: openaiKey!,
        maxTokens: 3000,
        profile,
      });
    } catch (openaiErr) {
      console.log(`[transport] /api/chat direct OpenAI failed: ${openaiErr instanceof Error ? openaiErr.message : String(openaiErr)} → falling back to OpenRouter`);
      // Fall through to OpenRouter fallback below
    }
  }

  if (webSearch) {
    emit({ type: "meta", provider: "openrouter", model, profile });
  }

  try {
    return await streamChatWithOllama(
      messages,
      emit,
      model,
      profile,
    );
  } catch (ollamaErr) {
    try {
      return await streamChatWithOpenRouter(
        messages,
        emit,
        model,
        profile,
        webSearch,
      );
    } catch (orErr) {
      const msg =
        `Ollama: ${
          ollamaErr instanceof Error
            ? ollamaErr.message
            : String(ollamaErr)
        } | OpenRouter: ${
          orErr instanceof Error
            ? orErr.message
            : String(orErr)
        }`;

      emit({ type: "error", message: msg });
      throw new Error(msg);
    }
  }
}

/**
 * Normal direct LiTT chat.
 *
 * Builds the concise copilot system prompt, then delegates to the SAME
 * message-level provider boundary used by the operator.
 */
export async function streamLiTTCode(
  prompt: string,
  emit: (e: LiTTEvent) => void,
): Promise<LiTTResult> {
  const webSearch = needsWebSearch(prompt);

  const cleanPrompt = prompt
    .replace(/^(\/web|\/search)\s+/i, "")
    .trim();

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are LiTT, the lead AI copilot for LiTTree Lab Studios. " +
        "You help users build software. " +
        "When asked for commands, prefer safe, explainable commands. " +
        "Warn about destructive operations. Keep responses concise and actionable." +
        (webSearch
          ? " When web search results are available, cite sources with URLs."
          : ""),
    },
    {
      role: "user",
      content: cleanPrompt,
    },
  ];

  return streamLiTTMessages(messages, emit, prompt);
}
export async function askLiTTCode(prompt: string): Promise<string> {
  const { model } = resolveProfile(prompt);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are LiTT, the lead AI operator for LiTTree Lab Studios. " +
        "You are NOT a generic AI assistant — you are the project's operator. " +
        "When asked about project health, testing, or status, interpret this as a request to inspect the project. " +
        "When asked for commands, prefer safe, explainable commands. " +
        "Warn about destructive operations. Keep responses concise and actionable. " +
        "Never say 'I am an AI assistant' or 'I am not a software project'.",
    },
    { role: "user", content: prompt },
  ];
  try {
    return (await chatWithOllama(messages)).content;
  } catch {
    return (await chatWithOpenRouter(messages, model)).content;
  }
}

// Cheap reachability check for the heartbeat / ONLINE badge.
// Returns ms if reachable, or -1 if not. No model call.
export async function health(): Promise<number> {
  // Try Ollama first (short timeout — it may not be running).
  try {
    const baseUrl = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
    const ctrl = AbortSignal.timeout(2000);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: ctrl });
    if (res.ok) return Date.now() - 0;
  } catch {
    // Ollama unreachable (connection refused / timeout) — fall through to OpenRouter.
  }
  // Try OpenRouter.
  const key = process.env.OPENROUTER_API_KEY;
  if (key) {
    try {
      const t1 = Date.now();
      const ctrl2 = AbortSignal.timeout(3000);
      const r2 = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: ctrl2,
      });
      if (r2.ok) return Date.now() - t1;
    } catch {
      // OpenRouter also unreachable.
    }
  }
  return -1;
}

export async function handleLiTTCodeCommand(input: string): Promise<string> {
  const args = input.trim().split(/\s+/).slice(1);
  const command = args[0]?.toLowerCase();
  const rest = args.slice(1).join(" ");

  // Legacy fallback path — the canonical operator is in litt-operator.ts.
  // This is only used when no model provider is available for the agent
  // loop. The prompt still includes identity + project context to avoid
  // the "I am an AI assistant" / "I am not a software project" problem.
  const systemContext = `You are LiTT, the lead AI operator for LiTTree Lab Studios.
You are NOT a generic AI assistant. You are the project's operator.
The user typed: ${input}

You have access to the project workspace and can inspect it.
When the user asks about project health, testing, or status, interpret
this as a request to inspect the project — not a question about yourself.

Available commands:
- scan: scan the current workspace and explain what it contains
- fix: look at the project and suggest fixes
- build: run the build and explain any errors
- deploy: give deployment instructions
- commit <message>: generate a git commit command
- create-agent <name>: explain how to create an agent
- add-feature <name>: explain how to add a feature
- explain <command>: explain a shell command
- mobile:check: typecheck + Expo export for the LiTT Companion app
- mobile:start: start the Expo dev server
- mobile:build: EAS Android build
- mobile:doctor: run expo-doctor

Intent mapping:
- "test and see how you are" → explain how to run tests + report project status
- "how are you" / "status" → report project status
- "is it broken" / "what's wrong" → explain how to check for failures

Be concise. Never say "I am an AI assistant" or "I am not a software project".
`;

  const prompt = `${systemContext}\n\nCommand: ${command || "help"}\nArguments: ${rest || "none"}`;
  return await askLiTTCode(prompt);
}


/* ========================================================================
 * LiTT native OpenRouter tool transport
 *
 * This provider boundary is used by the authenticated Desktop operator.
 * Model-selected tools are converted into LiTT's canonical tool_call
 * envelope; runAgentLoop then dispatches through the canonical gateway.
 * ====================================================================== */

export type LiTTNativeTool = {
  toolId: string;
  functionName: string;
  description: string;
  parameters: Record<string, unknown>;
};

export async function streamLiTTMessagesWithTools(
  messages: ChatMessage[],
  nativeTools: LiTTNativeTool[],
  emit: (event: LiTTEvent) => void,
  routingPrompt?: string,
): Promise<LiTTResult> {
  const promptForRouting =
    routingPrompt ??
    messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n\n");

  const { profile, model } = resolveProfile(promptForRouting);

  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    const message = "OPENROUTER_API_KEY not configured";
    emit({ type: "error", message });
    throw new Error(message);
  }

  const tools = nativeTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.functionName,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  const requestBody: Record<string, unknown> = {
    model,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    stream: false,
    tools,
    tool_choice: nativeTools.length > 0 ? "auto" : "none",
    parallel_tool_calls: false,
  };

  const startedAt = Date.now();

  emit({
    type: "meta",
    provider: "openrouter",
    model,
    profile,
  });

  let response: Response;

  try {
    response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer":
            process.env.NEXT_PUBLIC_SITE_URL ||
            "https://litlabs.net",
          "X-Title": "LiTT Desktop Operator",
        },
        body: JSON.stringify(requestBody),
      },
    );
  } catch (error) {
    const message =
      `OpenRouter request failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`;

    emit({ type: "error", message });
    throw new Error(message);
  }

  if (!response.ok) {
    const errorBody =
      await response.text().catch(() => "");

    const message =
      `OpenRouter API error ${response.status}: ${
        errorBody || response.statusText
      }`;

    emit({ type: "error", message });
    throw new Error(message);
  }

  const data: any = await response.json();

  if (data?.error) {
    const message =
      `OpenRouter error ${
        data.error?.code ?? "unknown"
      }: ${
        data.error?.message ?? "unknown provider error"
      }`;

    emit({ type: "error", message });
    throw new Error(message);
  }

  const choice = data?.choices?.[0];

  if (!choice) {
    const message =
      "OpenRouter returned no completion choice";

    emit({ type: "error", message });
    throw new Error(message);
  }

  const responseMessage = choice.message ?? {};

  let content =
    typeof responseMessage.content === "string"
      ? responseMessage.content
      : "";

  const toolCalls =
    Array.isArray(responseMessage.tool_calls)
      ? responseMessage.tool_calls
      : [];

  if (toolCalls.length > 1) {
    const message =
      `OpenRouter returned ${toolCalls.length} tool calls ` +
      `while parallel_tool_calls=false`;

    emit({ type: "error", message });
    throw new Error(message);
  }

  if (toolCalls.length === 1) {
    const providerCall = toolCalls[0];

    const functionName =
      providerCall?.function?.name;

    if (
      typeof functionName !== "string" ||
      !functionName
    ) {
      const message =
        "OpenRouter returned a tool call without a function name";

      emit({ type: "error", message });
      throw new Error(message);
    }

    const toolSpec =
      nativeTools.find(
        (tool) =>
          tool.functionName === functionName,
      );

    if (!toolSpec) {
      const message =
        `Provider requested unknown tool: ${functionName}`;

      emit({ type: "error", message });
      throw new Error(message);
    }

    const rawArguments =
      providerCall?.function?.arguments;

    let inputs: Record<string, unknown> = {};

    if (
      typeof rawArguments === "string" &&
      rawArguments.trim()
    ) {
      try {
        const parsed = JSON.parse(rawArguments);

        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error(
            "arguments JSON was not an object",
          );
        }

        inputs =
          parsed as Record<string, unknown>;
      } catch (error) {
        const message =
          `Invalid arguments for ${toolSpec.toolId}: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`;

        emit({ type: "error", message });
        throw new Error(message);
      }
    } else if (
      typeof rawArguments === "object" &&
      rawArguments !== null &&
      !Array.isArray(rawArguments)
    ) {
      inputs =
        rawArguments as Record<string, unknown>;
    }

    /*
     * Compatibility envelope:
     *
     * runAgentLoop already understands this canonical format.
     * We therefore gain provider-native function calling without creating
     * a second execution path.
     */
    const canonicalToolCall = [
      "```tool_call",
      JSON.stringify({
        tool: toolSpec.toolId,
        inputs,
      }),
      "```",
    ].join("\n");

    content =
      content.trim()
        ? `${content}\n${canonicalToolCall}`
        : canonicalToolCall;
  }

  if (!content.trim()) {
    const message =
      `OpenRouter completed without assistant text or a native tool call ` +
      `(model=${data?.model ?? model})`;

    emit({ type: "error", message });
    throw new Error(message);
  }

  const finishedAt = Date.now();

  const finalModel =
    data?.model ?? model;

  const usage = {
    total_tokens:
      data?.usage?.total_tokens ?? 0,
  };

  const timing: LiTTTiming = {
    ttftMs: -1,
    generationMs: -1,
    totalMs: finishedAt - startedAt,
  };

  /*
   * ModelProvider expects stream events. For now the native tool transport
   * emits the completed model payload as one delta. Actual execution events
   * continue through Agent Core / the canonical gateway.
   */
  emit({
    type: "delta",
    text: content,
  });

  emit({
    type: "done",
    model: finalModel,
    usage,
    timing,
  });

  return {
    content,
    model: finalModel,
    provider: "openrouter",
    usage,
    timing,
    profile,
  };
}
