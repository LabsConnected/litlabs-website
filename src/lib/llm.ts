/**
 * Unified LLM client for litlabs.net.
 *
 * Strategy: try providers in order, fail over on 429 / 5xx / network error.
 *
 *   1. Gemini 2.5 Flash  — primary. You already have the key. Generous free tier, fast, 1M context.
 *   2. OpenRouter `openrouter/free` — auto-picks the best free model with tool use. Backup.
 *   3. OpenRouter specific model — for tasks that need a known model (e.g. qwen-coder for code).
 *
 * Tasks map to model defaults so callers don't have to think about it:
 *   - "creative" → Gemini 2.5 Flash (high temp)
 *   - "precise"   → Gemini 2.5 Flash (low temp)
 *   - "code"      → Qwen3 Coder (free) → Gemini 2.5 Flash
 *   - "chat"      → Gemini 2.5 Flash
 *   - "json"      → Gemini 2.5 Flash (response_mime_type=application/json)
 *
 * Usage:
 *   const r = await generateText("Write a haiku about Vercel", { task: "creative" });
 *   // r.text, r.provider, r.model, r.latencyMs
 *
 *   const obj = await generateJSON<{ title: string }>("Return JSON: { title: '...' }", { task: "json" });
 *
 *   await streamText("...", (chunk) => sendToClient(chunk));
 *
 * Env:
 *   GEMINI_API_KEY   — your Gemini key (preferred primary)
 *   GOOGLE_API_KEY   — alias used by @google/generative-ai if GEMINI_API_KEY not set
 *   OPENROUTER_API_KEY — enables the OpenRouter fallback chain
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { SITE_URL } from "@/lib/siteConfig";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export type LLMTask = "creative" | "precise" | "code" | "chat" | "json";

export type LLMProvider =
  | "gemini"
  | "openrouter-free"
  | "openrouter-qwen"
  | "openrouter-deepseek"
  | "openrouter-mistral"
  | "openrouter-llama"
  | "openrouter-trinity";

export interface LLMOptions {
  task?: LLMTask;
  /** Force a specific provider (skips the chain). */
  provider?: LLMProvider;
  /** Hint to prefer free tier even if a paid key is available. */
  preferFree?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Stop sequences (Gemini + OpenAI-style both support). */
  stop?: string[];
  /** Override the model on a specific provider. */
  modelOverride?: Partial<Record<LLMProvider, string>>;
  /** Per-request timeout in ms. Default 30s for non-streaming, 60s for streaming. */
  timeoutMs?: number;
}

export interface LLMUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface LLMResult {
  text: string;
  provider: LLMProvider;
  model: string;
  usage?: LLMUsage;
  latencyMs: number;
  /** Providers that were tried before the successful one (in order). */
  failover: LLMProvider[];
}

/* ------------------------------------------------------------------ */
/*  Env + provider config                                              */
/* ------------------------------------------------------------------ */
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  "gemini": "gemini-2.5-flash",
  "openrouter-free": "openrouter/free",
  "openrouter-qwen": "qwen/qwen-2.5-coder-32b-instruct:free",
  "openrouter-deepseek": "deepseek/deepseek-chat:free",
  "openrouter-mistral": "mistralai/mistral-small-3.2-24b-instruct:free",
  "openrouter-llama": "meta-llama/llama-3.3-70b-instruct:free",
  "openrouter-trinity": "microsoft/trinity-large-preview:free",
};

// Gemini 2.0-flash as stable fallback
const GEMINI_FALLBACK_MODEL = "gemini-2.0-flash";

/* Lazy singleton — don't construct until first use. */
let _genAI: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI | null {
  if (!GEMINI_KEY) return null;
  if (!_genAI) _genAI = new GoogleGenerativeAI(GEMINI_KEY);
  return _genAI;
}

/* ------------------------------------------------------------------ */
/*  Default chain per task                                             */
/* ------------------------------------------------------------------ */
function defaultChain(task: LLMTask, opts: LLMOptions): LLMProvider[] {
  if (opts.provider) return [opts.provider];
  if (opts.preferFree) {
    return ["openrouter-free", "openrouter-qwen", "gemini"];
  }
  switch (task) {
    case "code":
      // Code wants a code-tuned model first
      return ["openrouter-qwen", "gemini", "openrouter-free"];
    case "precise":
    case "json":
      return ["gemini", "openrouter-deepseek", "openrouter-free"];
    case "creative":
    case "chat":
    default:
      return ["gemini", "openrouter-free", "openrouter-deepseek"];
  }
}

/* ------------------------------------------------------------------ */
/*  Per-provider error helpers                                         */
/* ------------------------------------------------------------------ */
class ProviderError extends Error {
  constructor(public provider: LLMProvider, public status: number | null, message: string) {
    super(message);
  }
  get isRetryable() {
    if (this.status === null) return true; // network error
    if (this.status === 408 || this.status === 429) return true;
    if (this.status >= 500 && this.status < 600) return true;
    return false;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

/* ------------------------------------------------------------------ */
/*  Provider implementations                                            */
/* ------------------------------------------------------------------ */
interface GenerateParams {
  prompt: string;
  systemPrompt?: string;
  task: LLMTask;
  opts: LLMOptions;
}

async function generateViaGemini(p: GenerateParams, modelName: string): Promise<{ text: string; usage?: LLMUsage; model: string }> {
  const genAI = getGenAI();
  if (!genAI) throw new ProviderError("gemini", null, "GEMINI_API_KEY not set");
  const model = genAI.getGenerativeModel({ model: modelName });

  const generationConfig: Record<string, unknown> = {};
  if (p.opts.maxTokens) generationConfig.maxOutputTokens = p.opts.maxTokens;
  if (p.opts.temperature !== undefined) generationConfig.temperature = p.opts.temperature;
  else if (p.task === "creative") generationConfig.temperature = 0.9;
  else if (p.task === "precise" || p.task === "json") generationConfig.temperature = 0.2;
  else if (p.task === "code") generationConfig.temperature = 0.1;
  else if (p.task === "chat") generationConfig.temperature = 0.7;
  if (p.opts.stop) generationConfig.stopSequences = p.opts.stop;
  if (p.task === "json") generationConfig.responseMimeType = "application/json";

  const fullPrompt = p.systemPrompt
    ? `${p.systemPrompt}\n\n${p.prompt}`
    : p.prompt;

  const t0 = Date.now();
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    generationConfig,
  });
  const text = result.response.text();

  const usageMd = result.response.usageMetadata;
  const usage: LLMUsage | undefined = usageMd
    ? {
        prompt: usageMd.promptTokenCount ?? 0,
        completion: usageMd.candidatesTokenCount ?? 0,
        total: usageMd.totalTokenCount ?? 0,
      }
    : undefined;

  return { text, usage, model: modelName };
}

async function generateViaOpenRouter(
  p: GenerateParams,
  provider: LLMProvider,
  modelName: string,
  timeoutMs: number,
): Promise<{ text: string; usage?: LLMUsage; model: string }> {
  if (!OPENROUTER_KEY) {
    throw new ProviderError(provider, null, "OPENROUTER_API_KEY not set");
  }
  const body: Record<string, unknown> = {
    model: modelName,
    messages: [
      ...(p.systemPrompt ? [{ role: "system", content: p.systemPrompt }] : []),
      { role: "user", content: p.prompt },
    ],
  };
  if (p.opts.maxTokens) body.max_tokens = p.opts.maxTokens;
  if (p.opts.temperature !== undefined) body.temperature = p.opts.temperature;
  else if (p.task === "creative") body.temperature = 0.9;
  else if (p.task === "precise" || p.task === "json") body.temperature = 0.2;
  else if (p.task === "code") body.temperature = 0.1;
  else if (p.task === "chat") body.temperature = 0.7;
  if (p.opts.stop) body.stop = p.opts.stop;
  if (p.task === "json") body.response_format = { type: "json_object" };

  const res = await fetchWithTimeout(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "HTTP-Referer": SITE_URL,
      "X-Title": "LiTTree Lab Studios",
    },
    body: JSON.stringify(body),
  }, timeoutMs);

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new ProviderError(provider, res.status, `OpenRouter ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  const text: string = choice?.message?.content ?? "";
  const usage: LLMUsage | undefined = data.usage
    ? {
        prompt: data.usage.prompt_tokens ?? 0,
        completion: data.usage.completion_tokens ?? 0,
        total: data.usage.total_tokens ?? 0,
      }
    : undefined;
  return { text, usage, model: data.model ?? modelName };
}

async function dispatchProvider(
  provider: LLMProvider,
  p: GenerateParams,
  timeoutMs: number,
): Promise<{ text: string; usage?: LLMUsage; model: string }> {
  const modelName = p.opts.modelOverride?.[provider] ?? DEFAULT_MODELS[provider];

  if (provider === "gemini") {
    // Try the configured model first, then fall back to the lite variant
    try {
      return await generateViaGemini(p, modelName);
    } catch (err) {
      if (err instanceof ProviderError && modelName !== GEMINI_FALLBACK_MODEL) {
        try {
          return await generateViaGemini(p, GEMINI_FALLBACK_MODEL);
        } catch {
          throw err; // throw original
        }
      }
      throw err;
    }
  }
  // All others are OpenRouter
  return generateViaOpenRouter(p, provider, modelName, timeoutMs);
}

/* ------------------------------------------------------------------ */
/*  Public API: generateText                                           */
/* ------------------------------------------------------------------ */
export async function generateText(
  prompt: string,
  options: LLMOptions = {},
  systemPrompt?: string,
): Promise<LLMResult> {
  const task = options.task ?? "chat";
  const timeoutMs = options.timeoutMs ?? 30_000;
  const chain = defaultChain(task, options);
  const failover: LLMProvider[] = [];
  const t0 = Date.now();

  let lastErr: unknown = null;
  for (const provider of chain) {
    try {
      const r = await dispatchProvider(provider, { prompt, systemPrompt, task, opts: options }, timeoutMs);
      return {
        text: r.text,
        provider,
        model: r.model,
        usage: r.usage,
        latencyMs: Date.now() - t0,
        failover,
      };
    } catch (err) {
      lastErr = err;
      const isProviderError = err instanceof ProviderError;
      // Don't retry non-retryable errors (e.g. 400 bad request) — skip to next
      if (!isProviderError || !err.isRetryable) {
        // For non-retryable, skip to the next provider in the chain
        failover.push(provider);
        continue;
      }
      // Retryable: try the next provider
      failover.push(provider);
    }
  }
  throw new Error(
    `All LLM providers failed. Tried: ${[...failover].join(", ")}. Last error: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
}

/* ------------------------------------------------------------------ */
/*  Public API: generateJSON                                           */
/* ------------------------------------------------------------------ */
export async function generateJSON<T = unknown>(
  prompt: string,
  options: LLMOptions = {},
  systemPrompt?: string,
): Promise<T> {
  const jsonPrompt = `${prompt}\n\nRespond with valid JSON only. No markdown, no commentary, no code fences.`;
  const r = await generateText(jsonPrompt, { ...options, task: "json" }, systemPrompt);
  const text = r.text.trim();
  // Be lenient: strip code fences if the model added them despite the instruction
  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    // Last-ditch: try to find the first {...} block
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        throw new Error(`LLM did not return valid JSON. Raw: ${text.slice(0, 300)}`);
      }
    }
    throw new Error(`LLM did not return valid JSON. Raw: ${text.slice(0, 300)}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Public API: streamText                                             */
/* ------------------------------------------------------------------ */
export async function streamText(
  prompt: string,
  onChunk: (text: string) => void,
  options: LLMOptions = {},
  systemPrompt?: string,
): Promise<{ provider: LLMProvider; model: string; latencyMs: number; failover: LLMProvider[] }> {
  const task = options.task ?? "chat";
  const timeoutMs = options.timeoutMs ?? 60_000;
  const chain = defaultChain(task, options);
  const failover: LLMProvider[] = [];
  const t0 = Date.now();

  let lastErr: unknown = null;
  for (const provider of chain) {
    try {
      if (provider === "gemini") {
        return await streamViaGemini({ prompt, systemPrompt, task, opts: options }, onChunk, t0, failover);
      }
      return await streamViaOpenRouter(provider, { prompt, systemPrompt, task, opts: options }, onChunk, t0, failover, timeoutMs);
    } catch (err) {
      lastErr = err;
      const isProviderError = err instanceof ProviderError;
      if (!isProviderError || !err.isRetryable) {
        failover.push(provider);
        continue;
      }
      failover.push(provider);
    }
  }
  throw new Error(
    `All LLM streaming providers failed. Tried: ${[...failover].join(", ")}. Last error: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
}

async function streamViaGemini(
  p: GenerateParams,
  onChunk: (text: string) => void,
  t0: number,
  failover: LLMProvider[],
): Promise<{ provider: LLMProvider; model: string; latencyMs: number; failover: LLMProvider[] }> {
  const genAI = getGenAI();
  if (!genAI) throw new ProviderError("gemini", null, "GEMINI_API_KEY not set");
  const modelName = p.opts.modelOverride?.["gemini"] ?? DEFAULT_MODELS["gemini"];
  const model = genAI.getGenerativeModel({ model: modelName });
  const fullPrompt = p.systemPrompt ? `${p.systemPrompt}\n\n${p.prompt}` : p.prompt;
  const result = await model.generateContentStream(fullPrompt);
  for await (const chunk of result.stream) {
    const t = chunk.text();
    if (t) onChunk(t);
  }
  return { provider: "gemini", model: modelName, latencyMs: Date.now() - t0, failover };
}

async function streamViaOpenRouter(
  provider: LLMProvider,
  p: GenerateParams,
  onChunk: (text: string) => void,
  t0: number,
  failover: LLMProvider[],
  timeoutMs: number,
): Promise<{ provider: LLMProvider; model: string; latencyMs: number; failover: LLMProvider[] }> {
  if (!OPENROUTER_KEY) throw new ProviderError(provider, null, "OPENROUTER_API_KEY not set");
  const modelName = p.opts.modelOverride?.[provider] ?? DEFAULT_MODELS[provider];
  const body: Record<string, unknown> = {
    model: modelName,
    stream: true,
    messages: [
      ...(p.systemPrompt ? [{ role: "system", content: p.systemPrompt }] : []),
      { role: "user", content: p.prompt },
    ],
  };
  if (p.opts.maxTokens) body.max_tokens = p.opts.maxTokens;
  if (p.opts.temperature !== undefined) body.temperature = p.opts.temperature;

  const res = await fetchWithTimeout(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "HTTP-Referer": SITE_URL,
      "X-Title": "LiTTree Lab Studios",
    },
    body: JSON.stringify(body),
  }, timeoutMs);

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new ProviderError(provider, res.status, `OpenRouter stream ${res.status}: ${txt.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE lines separated by \n\n
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch {
        // ignore malformed chunk
      }
    }
  }
  return { provider, model: modelName, latencyMs: Date.now() - t0, failover };
}

/* ------------------------------------------------------------------ */
/*  Health check — useful for the /api/llm/health route                */
/* ------------------------------------------------------------------ */
export interface LLMHealth {
  gemini: { available: boolean; model: string };
  openrouter: { available: boolean; model: string };
  preferFree: boolean;
  primary: LLMProvider;
}

export function llmHealth(): LLMHealth {
  return {
    gemini: { available: !!GEMINI_KEY, model: DEFAULT_MODELS.gemini },
    openrouter: { available: !!OPENROUTER_KEY, model: DEFAULT_MODELS["openrouter-free"] },
    preferFree: !GEMINI_KEY, // if no Gemini key, force the free route
    primary: defaultChain("chat", {})[0],
  };
}
