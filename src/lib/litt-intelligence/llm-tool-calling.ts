/**
 * LLM Tool Calling — native structured tool/function calling.
 *
 * Autonomous mutations require native structured tool calling.
 * Models without reliable tool calling are limited to conversation/PLAN
 * or routed to a capable provider.
 *
 * This module:
 *   1. Converts LiTT tool definitions to OpenAI-compatible function-calling format
 *   2. Calls OpenRouter with tools enabled (non-streaming for tool-call rounds)
 *   3. Parses tool_calls from the response
 *   4. Formats tool results for feeding back to the LLM
 *
 * No text-parsed fake tool calls. If the model doesn't return structured
 * tool_calls, there are no tool calls.
 */

import "server-only";

import { SchemaType } from "@google/generative-ai";
import { SITE_URL } from "@/lib/siteConfig";
import { logLLMCall, type LLMCallMetadata } from "@/lib/evals/braintrust";

// ─── Types ────────────────────────────────────────────────────────

export interface ToolDefinition {
  id: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallRequest {
  toolCallId: string;
  toolId: string;
  inputs: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  toolId: string;
  result: unknown;
  success: boolean;
  error?: string;
}

export interface LLMToolCallResponse {
  text: string;
  toolCalls: ToolCallRequest[];
  finishReason: string;
  model: string;
}

// ─── OpenRouter tool format ───────────────────────────────────────

interface OpenRouterTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export function toOpenRouterTools(tools: ToolDefinition[]): OpenRouterTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.id.replace(/\./g, "_"),
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

/**
 * Build a reverse map from OpenRouter function names back to original tool IDs.
 * OpenRouter names replace dots with underscores (project.scan → project_scan),
 * which is lossy for tools that use underscores natively (search_code → search_code).
 * This map lets us recover the original ID without guessing.
 */
export function buildToolIdReverseMap(tools: ToolDefinition[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const tool of tools) {
    const openRouterName = tool.id.replace(/\./g, "_");
    map.set(openRouterName, tool.id);
  }
  return map;
}

export function toToolDefinitionId(openRouterName: string): string {
  return openRouterName.replace(/_/g, ".");
}

// ─── Gemini API types (local so we can use raw fetch and still have safety) ───

type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters: {
    type: typeof SchemaType.OBJECT;
    properties: Record<string, unknown>;
    required: string[];
  };
};

type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
};

type GeminiCandidate = {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
};

type GeminiGenerateContentResponse = {
  candidates?: GeminiCandidate[];
};

// ─── Call LLM with tools ──────────────────────────────────────────

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_TIMEOUT_MS = 60_000;
const GEMINI_TIMEOUT_MS = 120_000;

/**
 * Race a `fetch` against a wall-clock timeout and an external abort signal.
 *
 * Deterministically settles in every path (timeout, abort, success, throw) and
 * cleans up the internal controller, timer, and external listener. No secrets,
 * request bodies, or full prompts are logged.
 *
 * @param label - Used in timeout/upstream errors so logs show which provider aborted.
 * @param externalSignal - Optional upstream/client AbortSignal to propagate.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = OPENROUTER_TIMEOUT_MS,
  label = "Provider",
  externalSignal?: AbortSignal,
): Promise<Response> {
  if (externalSignal?.aborted) {
    throw new UpstreamAbortError(label);
  }

  const controller = new AbortController();
  let onExternalAbort: (() => void) | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const externalAbortPromise = new Promise<never>((_, reject) => {
    onExternalAbort = () => {
      controller.abort();
      reject(new UpstreamAbortError(label));
    };
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  });
  externalAbortPromise.catch(() => {});

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError(label, timeoutMs));
    }, timeoutMs);
  });
  timeoutPromise.catch(() => {}); // avoid unhandled rejection when fetch wins

  try {
    return await Promise.race([fetch(url, { ...init, signal: controller.signal }), timeoutPromise, externalAbortPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (onExternalAbort) {
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

function getOpenRouterKey(): string {
  return process.env.OPENROUTER_API_KEY ?? "";
}

function getGeminiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GUARDRAIL_MS = 1_000;
const BUDGET_EXHAUSTED = "Agent runtime budget exhausted";

class ProviderTimeoutError extends Error {
  constructor(
    public readonly provider: string,
    public readonly timeoutMs: number,
  ) {
    super(`${provider} request timed out after ${timeoutMs}ms`);
  }
}

class UpstreamAbortError extends Error {
  constructor(public readonly provider: string) {
    super(`${provider} request aborted by upstream`);
  }
}

/**
 * Tracks the single agent runtime budget for all provider attempts in a call.
 */
class DeadlineBudget {
  constructor(private readonly deadline: number) {}

  remainingMs() {
    return Math.max(0, this.deadline - Date.now());
  }

  canAttempt() {
    return this.remainingMs() > GUARDRAIL_MS;
  }

  attemptTimeoutMs(defaultMs: number) {
    return Math.max(1, Math.min(defaultMs, this.remainingMs() - GUARDRAIL_MS));
  }

  canAffordRetry(delayMs: number, nextAttemptMs: number) {
    return Date.now() + delayMs + nextAttemptMs + GUARDRAIL_MS <= this.deadline;
  }
}

/**
 * Convert LiTT tool definitions to Gemini FunctionDeclaration format.
 * Gemini expects parameters as a JSON schema with type, properties, required.
 */
function toGeminiFunctionDeclarations(tools: ToolDefinition[]): GeminiFunctionDeclaration[] {
  return tools.map((tool) => {
    const schema = tool.inputSchema as Record<string, unknown>;
    return {
      name: tool.id.replace(/\./g, "_"),
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties: (schema?.properties ?? {}) as Record<string, unknown>,
        required: ((schema?.required ?? []) as string[]),
      },
    } as GeminiFunctionDeclaration;
  });
}

/**
 * Gemini direct API fallback for tool-calling.
 * Uses raw fetch with a hard wall-clock timeout and AbortController so the
 * underlying HTTP request is actually cancelled, not just raced. The whole
 * attempt chain is bounded by the caller's overall deadline so it cannot
 * outlive the agent runtime.
 */
async function callGeminiWithTools(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  tools: ToolDefinition[],
  toolIdMap: Map<string, string>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    evalMetadata?: LLMCallMetadata;
    /** Absolute timestamp after which this fallback call must not run. */
    deadline?: number;
    /** Optional upstream/client abort signal to propagate. */
    signal?: AbortSignal;
  },
): Promise<LLMToolCallResponse> {
  const key = getGeminiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY not set — cannot use Gemini direct fallback");
  }

  const model = "gemini-2.5-flash";
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents,
    systemInstruction: { role: "user", parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: options?.temperature ?? 0.15,
      maxOutputTokens: options?.maxTokens ?? 4096,
    },
  };

  const functionDeclarations = toGeminiFunctionDeclarations(tools);
  if (functionDeclarations.length > 0) {
    body.tools = [{ functionDeclarations }];
  }

  const budget = new DeadlineBudget(options?.deadline ?? Number.MAX_SAFE_INTEGER);

  if (!budget.canAttempt()) {
    throw new Error(BUDGET_EXHAUSTED);
  }

  console.log(`[llm-tool-calling] callGeminiWithTools: entering Gemini direct fallback model=${model} tools=${tools.length} budgetMs=${budget.remainingMs()} @ ${new Date().toISOString()}`);
  const totalT0 = Date.now();

  let lastErr: unknown = null;
  let result: GeminiGenerateContentResponse | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (!budget.canAttempt()) {
      throw new Error(BUDGET_EXHAUSTED);
    }

    const attemptTimeoutMs = budget.attemptTimeoutMs(GEMINI_TIMEOUT_MS);
    const attemptT0 = Date.now();
    console.log(`[llm-tool-calling] callGeminiWithTools: attempt ${attempt + 1} start timeoutMs=${attemptTimeoutMs} budgetMs=${budget.remainingMs()} @ ${new Date().toISOString()}`);

    try {
      const res = await fetchWithTimeout(
        `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify(body),
        },
        attemptTimeoutMs,
        "Gemini direct",
        options?.signal,
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Gemini direct request failed with status ${res.status}: ${errText.slice(0, 200)}`);
      }

      result = (await res.json()) as GeminiGenerateContentResponse;
      console.log(`[llm-tool-calling] callGeminiWithTools: attempt ${attempt + 1} success attemptLatencyMs=${Date.now() - attemptT0} totalElapsedMs=${Date.now() - totalT0} @ ${new Date().toISOString()}`);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const latencyMs = Date.now() - attemptT0;
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes("timed out");
      const isUpstreamAbort = msg.includes("aborted by upstream");
      const category = isTimeout ? "provider_timeout" : isUpstreamAbort ? "upstream_abort" : "gemini_direct_error";
      console.log(`[llm-tool-calling] callGeminiWithTools: attempt ${attempt + 1} failed category=${category} attemptLatencyMs=${latencyMs} msg=${msg.slice(0, 150)} @ ${new Date().toISOString()}`);

      if (msg.includes("429") || msg.includes("Too Many Requests")) {
        const delay = (attempt + 1) * 60_000;
        if (!budget.canAffordRetry(delay, GEMINI_TIMEOUT_MS)) {
          throw new Error(BUDGET_EXHAUSTED);
        }
        console.log(`[llm-tool-calling] callGeminiWithTools: 429 backoff attempt ${attempt + 1} delayMs=${delay} budgetMs=${budget.remainingMs()} @ ${new Date().toISOString()}`);
        const sleepT0 = Date.now();
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, delay);
          if (options?.signal) {
            const onAbort = () => { clearTimeout(t); reject(new UpstreamAbortError("Gemini 429 backoff")); };
            if (options.signal.aborted) {
              onAbort();
            } else {
              options.signal.addEventListener("abort", onAbort, { once: true });
            }
          }
        });
        console.log(`[llm-tool-calling] callGeminiWithTools: 429 backoff ended actualSleepMs=${Date.now() - sleepT0} budgetMs=${budget.remainingMs()} @ ${new Date().toISOString()}`);
        continue;
      }

      throw err;
    }
  }

  if (lastErr || !result) {
    throw lastErr ?? new Error("Gemini direct fallback returned no result");
  }

  const parts = result.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
  const functionCalls = parts
    .map((p) => p.functionCall)
    .filter((fc): fc is { name: string; args: Record<string, unknown> } => !!fc);

  const toolCalls: ToolCallRequest[] = functionCalls.map((fc) => ({
    toolCallId: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    toolId: toolIdMap.get(fc.name) ?? toToolDefinitionId(fc.name),
    inputs: fc.args ?? {},
  }));

  logLLMCall({
    prompt: messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
    systemPrompt,
    output: text,
    provider: "gemini-direct",
    model,
    latencyMs: Date.now() - totalT0,
    failover: [],
    metadata: options?.evalMetadata ?? {},
  });

  return {
    text,
    toolCalls,
    finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
    model,
  };
}

/**
 * Fallback model chain for tool-calling rounds.
 * When the primary model fails, we try these in order.
 * All models must support OpenRouter's native tool-calling API.
 */
const TOOL_CALLING_FALLBACK_MODELS = [
  "google/gemini-2.5-flash",
  "openai/gpt-5.6-luna",
  "anthropic/claude-sonnet-4.6",
  "meta-llama/llama-3.3-70b-instruct",
];

/**
 * Categorize an HTTP error for logging and fallback decisions.
 * Never includes request bodies or auth tokens — only status + category.
 */
function categorizeError(status: number | null, message: string): string {
  if (status === null) {
    if (message.includes("timed out after")) return "provider_timeout";
    if (message.includes("aborted by upstream")) return "upstream_abort";
    return "network_error";
  }
  if (status === 401 || status === 403) return "auth_error";
  if (status === 404) return "model_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_error";
  if (status === 400) return "bad_request";
  return `http_${status}`;
}

/**
 * Call OpenRouter with native tool calling support.
 * Non-streaming — used for tool-call rounds in the agent loop.
 *
 * If the model returns tool_calls, they are parsed and returned.
 * If the model returns text only (no tool_calls), toolCalls is empty.
 * We NEVER parse text to extract fake tool calls.
 *
 * Fallback: if the primary model fails, we try a chain of fallback models.
 * Each attempt is logged with provider, model, latency, and failure category.
 */
export async function callLLMWithTools(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  tools: ToolDefinition[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    toolChoice?: "auto" | "required" | "none";
    evalMetadata?: LLMCallMetadata;
    /** Absolute timestamp after which this call must not run (agent runtime budget). */
    deadline?: number;
    /** Optional upstream/client abort signal to propagate to all provider calls. */
    signal?: AbortSignal;
  },
): Promise<LLMToolCallResponse> {
  const key = getOpenRouterKey();
  if (!key) throw new Error("OPENROUTER_API_KEY not set — cannot make tool-calling LLM calls");

  const primaryModel = options?.model ?? "google/gemini-2.5-flash";
  const openRouterTools = toOpenRouterTools(tools);
  const toolIdMap = buildToolIdReverseMap(tools);

  // Build the attempt chain: primary model first, then fallbacks (deduped)
  const attemptChain = [primaryModel, ...TOOL_CALLING_FALLBACK_MODELS.filter((m) => m !== primaryModel)];

  // Absolute wall-clock deadline inherited from the agent loop so the entire
  // fallback chain (OpenRouter attempts + Gemini sleeps + generateContent)
  // cannot outlive the agent's maxRuntimeMs.
  const budget = new DeadlineBudget(options?.deadline ?? Number.MAX_SAFE_INTEGER);
  const failures: Array<{ model: string; status: number | null; category: string; latencyMs: number; message: string }> = [];

  if (!budget.canAttempt()) {
    throw new Error(BUDGET_EXHAUSTED);
  }

  for (const model of attemptChain) {
    const body: Record<string, unknown> = {
      model,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt } as OpenRouterMessage,
        ...messages.map((m) => ({ role: m.role, content: m.content }) as OpenRouterMessage),
      ],
      temperature: options?.temperature ?? 0.15,
    };

    if (options?.maxTokens) body.max_tokens = options.maxTokens;
    if (openRouterTools.length > 0) {
      body.tools = openRouterTools;
      body.tool_choice = options?.toolChoice ?? "auto";
    }

    if (!budget.canAttempt()) {
      throw new Error(BUDGET_EXHAUSTED);
    }
    const attemptTimeoutMs = budget.attemptTimeoutMs(OPENROUTER_TIMEOUT_MS);
    console.log(`[llm-tool-calling] callLLMWithTools: attempting OpenRouter model=${model} timeoutMs=${attemptTimeoutMs} budgetMs=${budget.remainingMs()} @ ${new Date().toISOString()}`);
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${OPENROUTER_BASE}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            "HTTP-Referer": SITE_URL,
            "X-Title": "LiTT",
          },
          body: JSON.stringify(body),
        },
        attemptTimeoutMs,
        "OpenRouter",
        options?.signal,
      );
      console.log(`[llm-tool-calling] callLLMWithTools: OpenRouter model=${model} response status=${res.status} latencyMs=${Date.now() - t0} @ ${new Date().toISOString()}`);
    } catch (err) {
      const latencyMs = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[llm-tool-calling] callLLMWithTools: OpenRouter model=${model} threw after ${latencyMs}ms: ${msg} @ ${new Date().toISOString()}`);
      const category = categorizeError(null, msg);
      failures.push({ model, status: null, category, latencyMs, message: msg });
      // Network/timeout errors are retryable — try next model
      continue;
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const latencyMs = Date.now() - t0;
      const category = categorizeError(res.status, txt);
      console.log(`[llm-tool-calling] callLLMWithTools: OpenRouter model=${model} not ok status=${res.status} category=${category} latencyMs=${latencyMs} @ ${new Date().toISOString()}`);
      failures.push({ model, status: res.status, category, latencyMs, message: txt.slice(0, 200) });

      // Log the failed attempt
      logLLMCall({
        prompt: messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
        systemPrompt,
        output: "",
        provider: "openrouter",
        model,
        latencyMs,
        failover: failures.slice(0, -1).map((f) => f.model),
        metadata: { ...options?.evalMetadata ?? {}, failureCategory: category } as LLMCallMetadata,
      });

      // Non-retryable errors (400 bad request) — skip to next model
      // Retryable errors (429, 5xx, network) — also skip to next model
      continue;
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) {
      // Empty response — try next model
      console.log(`[llm-tool-calling] callLLMWithTools: OpenRouter model=${model} empty response @ ${new Date().toISOString()}`);
      failures.push({ model, status: res.status, category: "empty_response", latencyMs: Date.now() - t0, message: "No choices in response" });
      continue;
    }

    const text: string = choice.message?.content ?? "";
    const rawToolCalls = choice.message?.tool_calls ?? [];
    const finishReason: string = choice.finish_reason ?? "stop";

    const toolCalls: ToolCallRequest[] = rawToolCalls.map((raw: {
      id: string;
      function: { name: string; arguments: string };
    }) => {
      let inputs: Record<string, unknown> = {};
      try {
        inputs = JSON.parse(raw.function.arguments);
      } catch {
        inputs = {};
      }
      return {
        toolCallId: raw.id,
        toolId: toolIdMap.get(raw.function.name) ?? toToolDefinitionId(raw.function.name),
        inputs,
      };
    });

    const result: LLMToolCallResponse = {
      text,
      toolCalls,
      finishReason,
      model: data.model ?? model,
    };

    console.log(`[llm-tool-calling] callLLMWithTools: OpenRouter model=${result.model} success latencyMs=${Date.now() - t0} toolCalls=${toolCalls.length} @ ${new Date().toISOString()}`);
    logLLMCall({
      prompt: messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
      systemPrompt,
      output: text,
      provider: "openrouter",
      model: result.model,
      latencyMs: Date.now() - t0,
      failover: failures.map((f) => f.model),
      metadata: options?.evalMetadata ?? {},
    });

    return result;
  }

  // All OpenRouter models failed — try Gemini direct API fallback
  const geminiKey = getGeminiKey();
  console.log("[llm-tool-calling] OpenRouter failures:", failures.map((f) => `${f.model}(${f.status})`).join(", "), "— trying Gemini direct fallback, key present:", !!geminiKey);
  if (geminiKey && openRouterTools.length > 0) {
    try {
      const geminiResult = await callGeminiWithTools(
        systemPrompt,
        messages,
        tools,
        toolIdMap,
        { temperature: options?.temperature, maxTokens: options?.maxTokens, evalMetadata: options?.evalMetadata, deadline: options?.deadline, signal: options?.signal },
      );
      // Log that we fell back to Gemini direct
      logLLMCall({
        prompt: messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
        systemPrompt,
        output: geminiResult.text,
        provider: "gemini-direct",
        model: "gemini-2.5-flash",
        latencyMs: 0,
        failover: failures.map((f) => f.model),
        metadata: { ...options?.evalMetadata ?? {}, failureCategory: "openrouter_all_failed_gemini_fallback" } as LLMCallMetadata,
      });
      return geminiResult;
    } catch (geminiErr) {
      const msg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
      console.log("[llm-tool-calling] Gemini direct fallback FAILED:", msg);
      failures.push({ model: "gemini-2.5-flash (direct)", status: null, category: "gemini_direct_error", latencyMs: 0, message: msg });
    }
  }

  // All models failed — throw with structured failure info (no secrets)
  const failureSummary = failures.map((f) => `${f.model}(${f.category}, ${f.latencyMs}ms)`).join("; ");
  throw new Error(
    `All tool-calling models failed. Attempts: ${failureSummary}. ` +
    `Last error: ${failures[failures.length - 1]?.message ?? "unknown"}`,
  );
}

// ─── Format tool results for LLM ──────────────────────────────────

export function buildToolResultMessage(
  result: ToolCallResult,
): OpenRouterMessage {
  const content = result.success
    ? JSON.stringify(result.result).slice(0, 10_000)
    : `Error: ${result.error ?? "Unknown error"}`;

  return {
    role: "tool",
    tool_call_id: result.toolCallId,
    content,
  };
}

export function buildAssistantToolCallMessage(
  toolCalls: ToolCallRequest[],
  text: string,
): OpenRouterMessage {
  return {
    role: "assistant",
    content: text,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.toolCallId,
      type: "function" as const,
      function: {
        name: tc.toolId.replace(/\./g, "_"),
        arguments: JSON.stringify(tc.inputs),
      },
    })),
  };
}

/**
 * Convert tool result to a human-readable summary for progress events.
 */
export function summarizeToolResult(toolId: string, result: unknown): string {
  if (typeof result === "string") return result.slice(0, 200);
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if ("entries" in obj && Array.isArray(obj.entries)) {
      return `${obj.entries.length} entries`;
    }
    if ("content" in obj) {
      const content = String(obj.content);
      return `${content.length} chars`;
    }
    if ("diff" in obj) {
      const diff = String(obj.diff);
      return `${diff.split("\n").length} diff lines`;
    }
    if ("exitCode" in obj) {
      return `exit ${obj.exitCode}`;
    }
    if ("saved" in obj) return obj.saved ? "saved" : "not saved";
    if ("deleted" in obj) return obj.deleted ? "deleted" : "not deleted";
  }
  return JSON.stringify(result).slice(0, 200);
}
