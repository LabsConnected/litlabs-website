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

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
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
  /** The independent provider that actually served this response. */
  provider: "openrouter-free" | "gemini-direct" | "groq";
  /** Raw Gemini parts preserved for subsequent conversation rounds (thought signatures, ids). */
  rawParts?: GeminiPart[];
}

/** Normalized conversation message. Supports both OpenRouter and Gemini serialization. */
export type LLMMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Gemini-specific raw model parts preserved for subsequent turns. */
  parts?: GeminiPart[];
  /** OpenRouter assistant tool_calls for multi-turn tool use. */
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  /** OpenRouter tool result correlation id. */
  tool_call_id?: string;
};

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

function toOpenRouterMessage(m: LLMMessage): OpenRouterMessage {
  const om: OpenRouterMessage = { role: m.role, content: m.content };
  if (m.tool_calls) om.tool_calls = m.tool_calls;
  if (m.tool_call_id) om.tool_call_id = m.tool_call_id;
  return om;
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

export type GeminiPart = {
  text?: string;
  functionCall?: { id?: string; name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: unknown };
  thoughtSignature?: string;
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
const GROQ_BASE = "https://api.groq.com/openai/v1";

/**
 * Race an in-flight provider promise against a wall-clock timeout and an
 * external abort signal. Deterministically settles in every path (timeout,
 * abort, success, throw) and cleans up the timer and external listener.
 *
 * @param label - Used in timeout/upstream errors so logs show which provider aborted.
 * @param externalSignal - Optional upstream/client AbortSignal to propagate.
 */
async function raceProviderAttempt<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  externalSignal?: AbortSignal,
): Promise<T> {
  if (externalSignal?.aborted) {
    throw new UpstreamAbortError(label);
  }

  let onExternalAbort: (() => void) | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const externalAbortPromise = new Promise<never>((_, reject) => {
    onExternalAbort = () => reject(new UpstreamAbortError(label));
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  });
  externalAbortPromise.catch(() => {});

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new ProviderTimeoutError(label, timeoutMs)), timeoutMs);
  });
  timeoutPromise.catch(() => {}); // avoid unhandled rejection when the attempt wins

  try {
    return await Promise.race([promise, timeoutPromise, externalAbortPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (onExternalAbort) {
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

/**
 * Race a `fetch` against a wall-clock timeout and an external abort signal.
 * The underlying HTTP request is actually cancelled via AbortController, not
 * just raced, and the controller/timer/listener are cleaned up in every path.
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

// ─── Deadline / timeout constants ────────────────────────────────
/** Cleanup margin reserved after every provider attempt for stream finalization,
 *  tool-event emission, and controller cleanup. */
const CLEANUP_MARGIN_MS = 1_000;
/** Hard cap on a single Gemini generateContent attempt. */
const GEMINI_TIMEOUT_MS = 30_000;
/** Hard cap on a single OpenRouter chat/completions attempt. */
const OPENROUTER_TIMEOUT_MS = 30_000;
const GROQ_TIMEOUT_MS = 30_000;

export type ToolProviderHealthState = "healthy" | "degraded" | "cooldown" | "disabled";
type ToolProvider = LLMToolCallResponse["provider"];

interface ToolProviderHealth {
  state: ToolProviderHealthState;
  untilMs?: number;
  reason?: string;
}

const providerHealth = new Map<ToolProvider, ToolProviderHealth>();

function providerCanRun(provider: ToolProvider): boolean {
  const health = providerHealth.get(provider);
  if (!health || health.state === "healthy") return true;
  if (health.state === "disabled") return false;
  if (health.untilMs && health.untilMs > Date.now()) return false;
  providerHealth.delete(provider);
  return true;
}

function markProviderHealthy(provider: ToolProvider): void {
  providerHealth.set(provider, { state: "healthy" });
}

function retryAfterMs(value: string | null): number {
  if (!value) return 30_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1_000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(1_000, dateMs - Date.now()) : 30_000;
}

function markProviderFailure(
  provider: ToolProvider,
  status: number | null,
  category: string,
  retryAfter: string | null = null,
): void {
  if (status === 401 || status === 402 || status === 403) {
    providerHealth.set(provider, { state: "disabled", reason: category });
    return;
  }
  if (status === 429) {
    providerHealth.set(provider, {
      state: "cooldown",
      untilMs: Date.now() + retryAfterMs(retryAfter),
      reason: category,
    });
    return;
  }
  providerHealth.set(provider, {
    state: "degraded",
    untilMs: Date.now() + 15_000,
    reason: category,
  });
}

/** Diagnostics/test seam. Values never include credentials or response bodies. */
export function getToolProviderHealth(): Record<ToolProvider, ToolProviderHealthState> {
  return {
    "openrouter-free": providerHealth.get("openrouter-free")?.state ?? "healthy",
    "gemini-direct": providerHealth.get("gemini-direct")?.state ?? "healthy",
    groq: providerHealth.get("groq")?.state ?? "healthy",
  };
}

/** @internal Test-only reset for module-level circuit state. */
export function _resetToolProviderHealth(): void {
  providerHealth.clear();
}

/**
 * Canonical budget-exhaustion error.
 * Thrown when the agent's remaining deadline cannot accommodate another
 * provider attempt (including retry delay + next attempt + cleanup).
 * This is distinct from a provider 429 or timeout — the agent itself
 * has run out of time.
 */
export class AgentBudgetExhaustedError extends Error {
  constructor(
    public readonly remainingMs: number,
    public readonly reason: string,
  ) {
    super(
      `Agent budget exhausted: ${reason} (remaining ${Math.floor(remainingMs / 1000)}s)`,
    );
    this.name = "AgentBudgetExhaustedError";
  }
}

/**
 * Compute the bounded per-attempt timeout for a provider call.
 * Returns null if the remaining budget cannot accommodate the attempt.
 *
 * Formula: generateTimeoutMs = Math.min(MAX_TIMEOUT, remainingMs - CLEANUP_MARGIN_MS)
 * If generateTimeoutMs <= 0, the budget is exhausted.
 */
function computeAttemptTimeout(
  deadlineMs: number | undefined,
  maxTimeoutMs: number,
): number | null {
  if (!deadlineMs) return maxTimeoutMs; // no deadline → use max
  const remainingMs = deadlineMs - Date.now();
  const timeoutMs = Math.min(maxTimeoutMs, remainingMs - CLEANUP_MARGIN_MS);
  return timeoutMs > 0 ? timeoutMs : null;
}

/**
 * Compute whether a 429 retry fits within the remaining budget.
 * Returns the next-attempt timeout if it fits, or null if it does not.
 *
 * Formula: nextAttemptBudget = Math.min(MAX_TIMEOUT, remaining - delay - CLEANUP_MARGIN)
 * If nextAttemptBudget <= 0, the retry does not fit.
 */
function computeRetryBudget(
  deadlineMs: number | undefined,
  delayMs: number,
  maxTimeoutMs: number,
): number | null {
  if (!deadlineMs) return maxTimeoutMs; // no deadline → allow
  const remainingMs = deadlineMs - Date.now();
  const nextAttemptBudget = Math.min(
    maxTimeoutMs,
    remainingMs - delayMs - CLEANUP_MARGIN_MS,
  );
  return nextAttemptBudget > 0 ? nextAttemptBudget : null;
}

function getOpenRouterKey(): string {
  return process.env.OPENROUTER_API_KEY ?? "";
}

function getGeminiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function getGroqKey(): string {
  return process.env.GROQ_API_KEY || "";
}

function isGroqBasicEnabled(): boolean {
  // A Groq key may belong to a paid account. Basic only opts into this route
  // when operations explicitly classifies the configured allocation as free.
  return process.env.LITT_GROQ_BASIC_ENABLED === "1";
}

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

let _genAI: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI | null {
  const key = getGeminiKey();
  if (!key) return null;
  if (!_genAI) _genAI = new GoogleGenerativeAI(key);
  return _genAI;
}

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

class ProviderHttpError extends Error {
  constructor(
    public readonly provider: ToolProvider,
    public readonly status: number,
    public readonly retryAfter: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

// ─── Test seam: Gemini model factory override ──────────────────
// Tests can inject a mock model factory to exercise real Gemini
// timeout/retry behavior without hitting the network.
export type GeminiModelLike = {
  generateContent(
    request: Record<string, unknown>,
    requestOptions?: { timeout?: number; signal?: AbortSignal },
  ): Promise<{
    response: {
      functionCalls(): Array<{ id?: string; name: string; args?: Record<string, unknown> }>;
      text(): string;
      candidates?: GeminiCandidate[];
    };
  }>;
};

let _geminiModelFactoryOverride: ((
  config: Record<string, unknown>,
) => GeminiModelLike) | null = null;

/** @internal Test-only seam to override the Gemini model factory. */
export function _setGeminiModelFactory(
  factory: ((config: Record<string, unknown>) => GeminiModelLike) | null,
): void {
  _geminiModelFactoryOverride = factory;
}

function createGeminiModel(config: Record<string, unknown>): GeminiModelLike {
  if (_geminiModelFactoryOverride) return _geminiModelFactoryOverride(config);
  const genAI = getGenAI();
  if (!genAI) throw new Error("GEMINI_API_KEY not set — cannot use Gemini direct fallback");
  return genAI.getGenerativeModel(config as unknown as Parameters<typeof genAI.getGenerativeModel>[0]) as unknown as GeminiModelLike;
}

/**
 * Convert LiTT tool definitions to Gemini FunctionDeclaration format.
 * Gemini expects parameters as a JSON schema with type, properties, required.
 */
function toGeminiContent(m: LLMMessage): { role: "user" | "model"; parts: GeminiPart[] } {
  return {
    role: m.role === "assistant" ? "model" : "user",
    parts: m.parts ?? [{ text: m.content }],
  };
}

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
 * Normalize a seam/SDK generateContent result into the raw-response shape so
 * the shared parts/tool-call parsing path is identical for both transports.
 */
function normalizeGeminiModelResult(sdkResult: {
  response: {
    functionCalls(): Array<{ id?: string; name: string; args?: Record<string, unknown> }>;
    text(): string;
    candidates?: GeminiCandidate[];
  };
}): GeminiGenerateContentResponse {
  const res = sdkResult.response;
  if (res.candidates) return { candidates: res.candidates };
  const parts: GeminiPart[] = [];
  let fcs: Array<{ id?: string; name: string; args?: Record<string, unknown> }> = [];
  try {
    fcs = res.functionCalls() ?? [];
  } catch {
    // No function calls in this response.
  }
  for (const fc of fcs) {
    parts.push({ functionCall: { id: fc.id, name: fc.name, args: fc.args ?? {} } });
  }
  let text = "";
  try {
    text = res.text();
  } catch {
    // No text in this response.
  }
  if (text) parts.push({ text });
  return { candidates: [{ content: { parts } }] };
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
  messages: LLMMessage[],
  tools: ToolDefinition[],
  toolIdMap: Map<string, string>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    evalMetadata?: LLMCallMetadata;
    /** Absolute timestamp after which this fallback call must not run. */
    deadlineMs?: number;
    /** Optional upstream/client abort signal to propagate. */
    signal?: AbortSignal;
  },
): Promise<LLMToolCallResponse> {
  const key = getGeminiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY not set — cannot use Gemini direct fallback");
  }

  const model = process.env.GEMINI_TOOL_MODEL || "gemini-3.6-flash";
  const contents = messages.map(toGeminiContent);
  const functionDeclarations = toGeminiFunctionDeclarations(tools);

  const body: Record<string, unknown> = {
    contents,
    systemInstruction: { role: "user", parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: options?.temperature ?? 0.15,
      maxOutputTokens: options?.maxTokens ?? 4096,
    },
  };
  if (functionDeclarations.length > 0) {
    body.tools = [{ functionDeclarations }];
  }

  // Test seam: when a model factory override is injected, calls route through
  // it instead of the raw HTTP request so tests can exercise the real
  // timeout/retry/budget behavior without a network.
  const seamModel = _geminiModelFactoryOverride
    ? createGeminiModel({
        model,
        tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
        generationConfig: body.generationConfig,
      })
    : null;

  console.log(`[llm-tool-calling] callGeminiWithTools: entering Gemini direct fallback model=${model} tools=${tools.length} seam=${!!seamModel} @ ${new Date().toISOString()}`);
  const totalT0 = Date.now();
  const MAX_GEMINI_ATTEMPTS = 3;

  let lastErr: unknown = null;
  let result: GeminiGenerateContentResponse | undefined;

  for (let attempt = 0; attempt < MAX_GEMINI_ATTEMPTS; attempt++) {
    // Compute bounded per-attempt timeout from the absolute deadline
    const attemptTimeoutMs = computeAttemptTimeout(options?.deadlineMs, GEMINI_TIMEOUT_MS);
    if (attemptTimeoutMs === null) {
      const remainingMs = options?.deadlineMs ? options.deadlineMs - Date.now() : 0;
      console.log(`[llm-tool-calling] callGeminiWithTools: budget exhausted before attempt ${attempt + 1}`);
      throw new AgentBudgetExhaustedError(remainingMs, `Gemini attempt ${attempt + 1} cannot fit in remaining budget`);
    }

    // Track whether this attempt was deadline-constrained (shorter than the max)
    const wasDeadlineConstrained = options?.deadlineMs !== undefined && attemptTimeoutMs < GEMINI_TIMEOUT_MS;

    const attemptT0 = Date.now();
    console.log(`[llm-tool-calling] callGeminiWithTools: attempt ${attempt + 1} start timeoutMs=${attemptTimeoutMs} @ ${new Date().toISOString()}`);

    try {
      if (seamModel) {
        // The seam mirrors the SDK contract: requestOptions.timeout bounds the
        // attempt and requestOptions.signal propagates the upstream abort. The
        // outer race keeps settlement deterministic even if the promise hangs.
        const sdkResult = await raceProviderAttempt(
          seamModel.generateContent(
            { contents, systemInstruction: systemPrompt },
            { timeout: attemptTimeoutMs, signal: options?.signal },
          ),
          attemptTimeoutMs,
          "Gemini direct",
          options?.signal,
        );
        result = normalizeGeminiModelResult(sdkResult);
      } else {
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
          throw new ProviderHttpError(
            "gemini-direct",
            res.status,
            res.headers?.get?.("retry-after") ?? null,
            `Gemini direct request failed with status ${res.status}: ${errText.slice(0, 200)}`,
          );
        }

        result = (await res.json()) as GeminiGenerateContentResponse;
      }
      console.log(`[llm-tool-calling] callGeminiWithTools: attempt ${attempt + 1} success attemptLatencyMs=${Date.now() - attemptT0} totalElapsedMs=${Date.now() - totalT0} @ ${new Date().toISOString()}`);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const latencyMs = Date.now() - attemptT0;
      const msg = err instanceof Error ? err.message : String(err);
      const isUpstreamAbort = err instanceof UpstreamAbortError || (options?.signal?.aborted ?? false);
      const isTimeout =
        err instanceof ProviderTimeoutError ||
        msg.includes("timed out") ||
        (err instanceof Error && (err.name === "AbortError" || msg.includes("AbortError") || msg.includes("aborted")));
      const category = isUpstreamAbort ? "upstream_abort" : isTimeout ? "provider_timeout" : "gemini_direct_error";
      console.log(`[llm-tool-calling] callGeminiWithTools: attempt ${attempt + 1} failed category=${category} attemptLatencyMs=${latencyMs} msg=${msg.slice(0, 150)} @ ${new Date().toISOString()}`);

      // Upstream/client abort — stop immediately, no retries.
      if (isUpstreamAbort) {
        throw err instanceof UpstreamAbortError ? err : new UpstreamAbortError("Gemini direct");
      }

      // If the attempt was deadline-constrained and timed out, surface the
      // canonical budget-exhaustion error instead of a generic timeout.
      if (isTimeout && wasDeadlineConstrained) {
        const remainingMs = options?.deadlineMs ? options.deadlineMs - Date.now() : 0;
        console.log(`[llm-tool-calling] callGeminiWithTools: deadline-constrained timeout on attempt ${attempt + 1}`);
        throw new AgentBudgetExhaustedError(remainingMs, `Gemini attempt ${attempt + 1} timed out against agent budget (timeout=${attemptTimeoutMs}ms)`);
      }

      // Retry on 429 rate limit with exponential backoff — but only if
      // another attempt actually exists. On the final attempt, throw
      // immediately instead of sleeping for a retry that will never happen.
      if (msg.includes("429") || msg.includes("Too Many Requests")) {
        // A configured independent provider is preferable to consuming most
        // of the shared agent deadline in a provider-local sleep.
        if (isGroqBasicEnabled() && getGroqKey() && providerCanRun("groq")) {
          throw err;
        }
        const hasAnotherAttempt = attempt + 1 < MAX_GEMINI_ATTEMPTS;
        if (!hasAnotherAttempt) {
          console.log(`[llm-tool-calling] callGeminiWithTools: 429 on final attempt ${attempt + 1}, no retries left`);
          throw err;
        }
        const delay = (attempt + 1) * 60_000; // 60s, 120s
        // Check if the retry delay + next attempt + cleanup fits within remaining budget
        const retryBudgetMs = computeRetryBudget(options?.deadlineMs, delay, GEMINI_TIMEOUT_MS);
        if (retryBudgetMs === null) {
          const remainingMs = options?.deadlineMs ? options.deadlineMs - Date.now() : 0;
          console.log(`[llm-tool-calling] callGeminiWithTools: skipping retry, delay=${delay / 1000}s + attempt cannot fit in remaining ${Math.floor(remainingMs / 1000)}s`);
          throw new AgentBudgetExhaustedError(remainingMs, `429 retry delay=${delay / 1000}s + next attempt cannot fit in remaining budget`);
        }
        console.log(`[llm-tool-calling] callGeminiWithTools: 429 backoff attempt ${attempt + 1} delayMs=${delay} nextAttemptBudgetMs=${retryBudgetMs} @ ${new Date().toISOString()}`);
        const sleepT0 = Date.now();
        await new Promise<void>((resolve, reject) => {
          const signal = options?.signal;
          const onAbort = () => {
            clearTimeout(t);
            reject(new UpstreamAbortError("Gemini 429 backoff"));
          };
          const t = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          }, delay);
          if (signal) {
            if (signal.aborted) {
              onAbort();
            } else {
              signal.addEventListener("abort", onAbort, { once: true });
            }
          }
        });
        console.log(`[llm-tool-calling] callGeminiWithTools: 429 backoff ended actualSleepMs=${Date.now() - sleepT0} @ ${new Date().toISOString()}`);
        continue;
      }

      throw err;
    }
  }

  if (lastErr || !result) {
    throw lastErr ?? new Error("Gemini direct fallback returned no result");
  }

  const parts: GeminiPart[] = result.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
  const functionCallParts = parts.filter((p) => !!p.functionCall);

  const toolCalls: ToolCallRequest[] = functionCallParts.map((p) => {
    const fc = p.functionCall!;
    return {
      toolCallId: fc.id ?? `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId: toolIdMap.get(fc.name) ?? toToolDefinitionId(fc.name),
      inputs: fc.args ?? {},
    };
  });

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
    provider: "gemini-direct",
    rawParts: parts,
  };
}

/**
 * Fallback model chain for tool-calling rounds.
 * When the primary model fails, we try these in order.
 * All models must support OpenRouter's native tool-calling API.
 */
const BASIC_OPENROUTER_MODEL = "openrouter/free";
// Groq's named replacement for the retired llama-3.3-70b-versatile; supports
// tool calling on the free/developer tier.
const GROQ_TOOL_MODEL = "openai/gpt-oss-120b";

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
  if (status === 402) return "billing_required";
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
  messages: LLMMessage[],
  tools: ToolDefinition[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    toolChoice?: "auto" | "required" | "none";
    evalMetadata?: LLMCallMetadata;
    /** Absolute timestamp after which this call must not run (agent runtime budget). */
    deadlineMs?: number;
    /** Optional upstream/client abort signal to propagate to all provider calls. */
    signal?: AbortSignal;
  },
): Promise<LLMToolCallResponse> {
  if (options?.signal?.aborted) {
    throw new UpstreamAbortError("tool provider router");
  }
  if (options?.deadlineMs && computeAttemptTimeout(options.deadlineMs, 1) === null) {
    throw new AgentBudgetExhaustedError(
      options.deadlineMs - Date.now(),
      "No provider attempt can fit in remaining budget",
    );
  }
  const openRouterTools = toOpenRouterTools(tools);
  const toolIdMap = buildToolIdReverseMap(tools);
  const failures: Array<{
    provider: ToolProvider;
    model: string;
    status: number | null;
    category: string;
    latencyMs: number;
    message: string;
  }> = [];

  const recordFailure = (
    provider: ToolProvider,
    model: string,
    status: number | null,
    category: string,
    latencyMs: number,
    message: string,
    retryAfter: string | null = null,
  ) => {
    failures.push({ provider, model, status, category, latencyMs, message: message.slice(0, 200) });
    markProviderFailure(provider, status, category, retryAfter);
  };

  const parseOpenAICompatible = async (
    provider: "openrouter-free" | "groq",
    model: string,
    baseUrl: string,
    key: string,
    timeoutMs: number,
  ): Promise<LLMToolCallResponse | null> => {
    const body: Record<string, unknown> = {
      model,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt } as OpenRouterMessage,
        ...messages.map(toOpenRouterMessage),
      ],
      temperature: options?.temperature ?? 0.15,
    };

    if (options?.maxTokens) body.max_tokens = options.maxTokens;
    if (openRouterTools.length > 0) {
      body.tools = openRouterTools;
      body.tool_choice = options?.toolChoice ?? "auto";
    }

    const attemptTimeoutMs = computeAttemptTimeout(options?.deadlineMs, timeoutMs);
    if (attemptTimeoutMs === null) {
      const remainingMs = options?.deadlineMs ? options.deadlineMs - Date.now() : 0;
      throw new AgentBudgetExhaustedError(remainingMs, `${provider} attempt for ${model} cannot fit in remaining budget`);
    }
    console.log(`[llm-tool-calling] callLLMWithTools: attempting provider=${provider} model=${model} timeoutMs=${attemptTimeoutMs} @ ${new Date().toISOString()}`);
    const t0 = Date.now();

    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            ...(provider === "openrouter-free" ? { "HTTP-Referer": SITE_URL, "X-Title": "LiTT" } : {}),
          },
          body: JSON.stringify(body),
        },
        attemptTimeoutMs,
        provider,
        options?.signal,
      );
    } catch (err) {
      const latencyMs = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      const category = categorizeError(null, msg);
      if (category === "upstream_abort") throw err;
      recordFailure(provider, model, null, category, latencyMs, msg);
      return null;
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const latencyMs = Date.now() - t0;
      const category = categorizeError(res.status, txt);
      recordFailure(provider, model, res.status, category, latencyMs, txt, res.headers?.get?.("retry-after") ?? null);

      logLLMCall({
        prompt: messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
        systemPrompt,
        output: "",
        provider,
        model,
        latencyMs,
        failover: failures.slice(0, -1).map((f) => `${f.provider}:${f.model}`),
        metadata: { ...options?.evalMetadata ?? {}, failureCategory: category } as LLMCallMetadata,
      });
      return null;
    }

    let data: { model?: string; choices?: Array<{
      message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
      finish_reason?: string;
    }> } | null;
    try {
      data = (await res.json()) as typeof data;
    } catch {
      recordFailure(provider, model, res.status, "malformed_response", Date.now() - t0, "Response body was not valid JSON");
      return null;
    }
    const choice = data?.choices?.[0];
    if (!choice) {
      recordFailure(provider, model, res.status, "malformed_response", Date.now() - t0, "No choices in response");
      return null;
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
      model: data?.model ?? model,
      provider,
    };

    markProviderHealthy(provider);
    logLLMCall({
      prompt: messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
      systemPrompt,
      output: text,
      provider,
      model: result.model,
      latencyMs: Date.now() - t0,
      failover: failures.map((f) => `${f.provider}:${f.model}`),
      metadata: options?.evalMetadata ?? {},
    });

    return result;
  };

  // Basic is cost-class constrained. OpenRouter may only receive an explicit
  // :free model or its free router; paid model IDs are never attempted here.
  const requestedFreeModel = options?.model === BASIC_OPENROUTER_MODEL || options?.model?.endsWith(":free")
    ? options.model
    : BASIC_OPENROUTER_MODEL;
  const openRouterKey = getOpenRouterKey();
  if (openRouterKey && providerCanRun("openrouter-free")) {
    const result = await parseOpenAICompatible(
      "openrouter-free",
      requestedFreeModel,
      OPENROUTER_BASE,
      openRouterKey,
      OPENROUTER_TIMEOUT_MS,
    );
    if (result) return result;
  }

  const geminiKey = getGeminiKey();
  if (geminiKey && providerCanRun("gemini-direct")) {
    const geminiT0 = Date.now();
    try {
      const geminiResult = await callGeminiWithTools(
        systemPrompt,
        messages,
        tools,
        toolIdMap,
        { temperature: options?.temperature, maxTokens: options?.maxTokens, evalMetadata: options?.evalMetadata, deadlineMs: options?.deadlineMs, signal: options?.signal },
      );
      // Log that we fell back to Gemini direct
      logLLMCall({
        prompt: messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
        systemPrompt,
        output: geminiResult.text,
        provider: "gemini-direct",
        model: geminiResult.model,
        latencyMs: Date.now() - geminiT0,
        failover: failures.map((f) => `${f.provider}:${f.model}`),
        metadata: { ...options?.evalMetadata ?? {}, failureCategory: "openrouter_all_failed_gemini_fallback" } as LLMCallMetadata,
      });
      markProviderHealthy("gemini-direct");
      return geminiResult;
    } catch (geminiErr) {
      // Preserve AgentBudgetExhaustedError — do not hide agent-budget
      // exhaustion as a generic provider failure.
      if (geminiErr instanceof AgentBudgetExhaustedError) {
        throw geminiErr;
      }
      if (geminiErr instanceof UpstreamAbortError || options?.signal?.aborted) {
        throw geminiErr;
      }
      const msg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
      // The raw-fetch path throws ProviderHttpError with the real status; the
      // SDK/seam path surfaces status only inside the message text.
      const status = geminiErr instanceof ProviderHttpError
        ? geminiErr.status
        : msg.includes("429") ? 429 : null;
      const category = categorizeError(status, msg);
      recordFailure(
        "gemini-direct",
        process.env.GEMINI_TOOL_MODEL || "gemini-3.6-flash",
        status,
        category,
        Date.now() - geminiT0,
        msg,
        geminiErr instanceof ProviderHttpError ? geminiErr.retryAfter : null,
      );
    }
  }

  const groqKey = getGroqKey();
  if (isGroqBasicEnabled() && groqKey && providerCanRun("groq")) {
    const result = await parseOpenAICompatible(
      "groq",
      process.env.GROQ_TOOL_MODEL || GROQ_TOOL_MODEL,
      GROQ_BASE,
      groqKey,
      GROQ_TIMEOUT_MS,
    );
    if (result) return result;
  }

  // If the shared agent deadline can no longer fit any attempt, surface the
  // canonical budget error rather than a generic all-providers-failed error.
  if (options?.deadlineMs) {
    const remainingMs = options.deadlineMs - Date.now();
    if (remainingMs <= CLEANUP_MARGIN_MS) {
      throw new AgentBudgetExhaustedError(remainingMs, "Provider chain consumed the remaining agent budget");
    }
  }

  // All models failed — throw with structured failure info (no secrets)
  const failureSummary = failures.map((f) => `${f.provider}:${f.model}(${f.category}, ${f.latencyMs}ms)`).join("; ");
  throw new Error(
    `All Basic-eligible tool-calling providers failed. Attempts: ${failureSummary || "none configured"}. ` +
    `Last error: ${failures[failures.length - 1]?.message ?? "unknown"}`,
  );
}

// ─── Format tool results for LLM ──────────────────────────────────

export function buildToolResultMessage(
  result: ToolCallResult,
): LLMMessage {
  const content = result.success
    ? JSON.stringify(result.result).slice(0, 10_000)
    : `Error: ${result.error ?? "Unknown error"}`;

  const underscoredName = result.toolId.replace(/\./g, "_");
  const geminiResponse = result.success
    ? (result.result ?? null)
    : { error: result.error ?? "Unknown error" };

  return {
    role: "tool",
    content,
    tool_call_id: result.toolCallId,
    parts: [{ functionResponse: { name: underscoredName, response: geminiResponse } }],
  };
}

export function buildAssistantToolCallMessage(
  toolCalls: ToolCallRequest[],
  text: string,
  rawParts?: GeminiPart[],
): LLMMessage {
  return {
    role: "assistant",
    content: text,
    parts: rawParts,
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
