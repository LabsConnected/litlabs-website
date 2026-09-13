/**
 * LLM Tool Calling — provider-neutral structured tool/function calling.
 *
 * Autonomous mutations require native structured tool calling.
 * Models without reliable tool calling are limited to conversation/PLAN
 * or routed to a capable provider.
 *
 * This module:
 *   1. Converts LiTT tool definitions to the OpenAI-compatible
 *      function-calling format shared by OpenRouter, Groq, Mistral,
 *      Cloudflare Workers AI, Ollama (/v1), and OpenAI-compatible BYOK.
 *   2. Routes each request through the Basic provider registry — an ordered
 *      plan of eligible providers filtered by cost policy, capabilities,
 *      credentials, and circuit-breaker health.
 *   3. Parses tool_calls / functionCall parts from the response.
 *   4. Formats tool results for feeding back to the LLM.
 *
 * The canonical transcript (LLMMessage) carries BOTH wire encodings
 * (OpenAI-style tool_calls/tool_call_id AND Gemini parts), so a provider
 * failover mid-conversation never loses completed tool calls — the next
 * provider receives the full normalized history including tool results.
 *
 * No text-parsed fake tool calls. If the model doesn't return structured
 * tool_calls, there are no tool calls.
 */

import "server-only";

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { SITE_URL } from "@/lib/siteConfig";
import { logLLMCall, type LLMCallMetadata } from "@/lib/evals/braintrust";
import {
  planBasicRoutes,
  recordProviderSuccess,
  recordProviderFailure,
  recordModelFailure,
  isModelCoolingDown,
  classifyHttpFailure,
  classifyThrownFailure,
  parseRetryAfterMs,
  resolveBasicOllamaEndpoint,
  ProviderAttemptError,
  type FailureClass,
  type PlannedProvider,
  type ProviderFailure,
  type RouteRequirements,
} from "./provider-registry";

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
  /** Provider that produced this response (e.g. "gemini", "openrouter"). */
  provider?: string;
  /** Raw Gemini parts preserved for subsequent conversation rounds (thought signatures, ids). */
  rawParts?: GeminiPart[];
}

/** Normalized conversation message. Supports both OpenAI-compatible and Gemini serialization. */
export type LLMMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Gemini-specific raw model parts preserved for subsequent turns. */
  parts?: GeminiPart[];
  /** OpenAI-compatible assistant tool_calls for multi-turn tool use. */
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  /** OpenAI-compatible tool result correlation id. */
  tool_call_id?: string;
};

// ─── OpenAI-compatible tool format ────────────────────────────────
// Shared by OpenRouter, Groq, Mistral, Cloudflare Workers AI, Ollama /v1,
// and OpenAI-compatible BYOK endpoints. The OpenRouter names are kept for
// backwards compatibility with existing exports and tests.

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
 * Build a reverse map from OpenAI-compatible function names back to original tool IDs.
 * Function names replace dots with underscores (project.scan → project_scan),
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

// ─── Deadline / timeout plumbing ──────────────────────────────────

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const GROQ_BASE = "https://api.groq.com/openai/v1";
const MISTRAL_BASE = "https://api.mistral.com/v1";
const OPENAI_BASE = "https://api.openai.com/v1";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

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
  timeoutMs: number,
  label: string,
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
/** Fallback per-attempt cap when a route does not declare one. */
const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000;

/**
 * Canonical budget-exhaustion error.
 * Thrown when the agent's remaining deadline cannot accommodate another
 * provider attempt (including cleanup margin).
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
 * Formula: attemptTimeoutMs = Math.min(routeTimeoutMs, remainingMs - CLEANUP_MARGIN_MS)
 * If attemptTimeoutMs <= 0, the budget is exhausted.
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

function getGeminiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

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
    this.name = "ProviderTimeoutError";
  }
}

class UpstreamAbortError extends Error {
  constructor(public readonly provider: string) {
    super(`${provider} request aborted by upstream`);
    this.name = "UpstreamAbortError";
  }
}

// ─── Test seam: Gemini model factory override ──────────────────
// Tests can inject a mock model factory to exercise real Gemini
// timeout/failure behavior without hitting the network.
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
  if (!genAI) {
    throw new ProviderAttemptError("gemini", "unknown", {
      class: "auth_invalid",
      scope: "provider",
      message: "GEMINI_API_KEY not set — cannot use Gemini route",
    });
  }
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

// ─── Structured diagnostics ───────────────────────────────────────

/**
 * Emit a structured provider-routing diagnostic line. Fields are safe by
 * construction — provider/model/class/status/timings only, never headers,
 * request bodies, or secrets.
 */
function logRoute(event: string, fields: Record<string, unknown>): void {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`[provider-router] ${event} ${parts} @ ${new Date().toISOString()}`);
}

// ─── Adapters ─────────────────────────────────────────────────────

interface AttemptRequest {
  systemPrompt: string;
  messages: LLMMessage[];
  tools: ToolDefinition[];
  toolIdMap: Map<string, string>;
  temperature?: number;
  maxTokens?: number;
  toolChoice?: "auto" | "required" | "none";
}

interface AttemptContext {
  timeoutMs: number;
  signal?: AbortSignal;
  secrets: { userApiKey?: string; byokBaseUrl?: string };
}

function toGeminiResponse(
  result: GeminiGenerateContentResponse,
  model: string,
  toolIdMap: Map<string, string>,
): LLMToolCallResponse {
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

  return {
    text,
    toolCalls,
    finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
    model,
    provider: "gemini",
    rawParts: parts,
  };
}

/** Single Gemini generateContent attempt — bounded by ctx.timeoutMs and the
 *  upstream signal. No internal retries: 429s and timeouts route around the
 *  provider via the circuit breaker instead of sleeping inside the request. */
async function attemptGemini(
  model: string,
  req: AttemptRequest,
  ctx: AttemptContext,
): Promise<LLMToolCallResponse> {
  const key = getGeminiKey();
  if (!key && !_geminiModelFactoryOverride) {
    throw new ProviderAttemptError("gemini", model, {
      class: "auth_invalid",
      scope: "provider",
      message: "GEMINI_API_KEY not set",
    });
  }

  const contents = req.messages.map(toGeminiContent);
  const functionDeclarations = toGeminiFunctionDeclarations(req.tools);

  const body: Record<string, unknown> = {
    contents,
    systemInstruction: { role: "user", parts: [{ text: req.systemPrompt }] },
    generationConfig: {
      temperature: req.temperature ?? 0.15,
      maxOutputTokens: req.maxTokens ?? 4096,
    },
  };
  if (functionDeclarations.length > 0) {
    body.tools = [{ functionDeclarations }];
  }

  // Test seam: when a model factory override is injected, calls route through
  // it instead of the raw HTTP request so tests can exercise the real
  // timeout/budget behavior without a network.
  const seamModel = _geminiModelFactoryOverride
    ? createGeminiModel({
        model,
        tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
        generationConfig: body.generationConfig,
      })
    : null;

  let result: GeminiGenerateContentResponse;
  try {
    if (seamModel) {
      const sdkResult = await raceProviderAttempt(
        seamModel.generateContent(
          { contents, systemInstruction: req.systemPrompt },
          { timeout: ctx.timeoutMs, signal: ctx.signal },
        ),
        ctx.timeoutMs,
        "Gemini direct",
        ctx.signal,
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
        ctx.timeoutMs,
        "Gemini direct",
        ctx.signal,
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new ProviderAttemptError(
          "gemini",
          model,
          classifyHttpFailure(res.status, errText, parseRetryAfterMs(res.headers, errText)),
        );
      }

      result = (await res.json()) as GeminiGenerateContentResponse;
    }
  } catch (err) {
    if (
      err instanceof ProviderAttemptError ||
      err instanceof UpstreamAbortError ||
      err instanceof AgentBudgetExhaustedError
    ) {
      throw err;
    }
    throw new ProviderAttemptError("gemini", model, classifyThrownFailure(err));
  }

  if (!result.candidates?.length) {
    throw new ProviderAttemptError("gemini", model, {
      class: "bad_response",
      scope: "provider",
      message: "Gemini response contained no candidates",
    });
  }

  return toGeminiResponse(result, model, req.toolIdMap);
}

/** Provider-specific connection details for the shared OpenAI-compatible adapter. */
function compatEndpointFor(
  route: PlannedProvider,
  secrets: AttemptContext["secrets"],
): { baseUrl: string; headers: Record<string, string> } {
  switch (route.provider) {
    case "openrouter": {
      const key = process.env.OPENROUTER_API_KEY ?? "";
      if (!key) {
        throw new ProviderAttemptError("openrouter", route.models[0] ?? "unknown", {
          class: "auth_invalid",
          scope: "provider",
          message: "OPENROUTER_API_KEY not set",
        });
      }
      return {
        baseUrl: OPENROUTER_BASE,
        headers: {
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": SITE_URL,
          "X-Title": "LiTT",
        },
      };
    }
    case "groq": {
      const key = process.env.GROQ_API_KEY ?? "";
      if (!key) {
        throw new ProviderAttemptError("groq", route.models[0] ?? "unknown", {
          class: "auth_invalid",
          scope: "provider",
          message: "GROQ_API_KEY not set",
        });
      }
      return { baseUrl: GROQ_BASE, headers: { Authorization: `Bearer ${key}` } };
    }
    case "mistral": {
      const key = process.env.MISTRAL_API_KEY ?? "";
      if (!key) {
        throw new ProviderAttemptError("mistral", route.models[0] ?? "unknown", {
          class: "auth_invalid",
          scope: "provider",
          message: "MISTRAL_API_KEY not set",
        });
      }
      return { baseUrl: MISTRAL_BASE, headers: { Authorization: `Bearer ${key}` } };
    }
    case "cloudflare": {
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
      const token = process.env.CLOUDFLARE_AI_API_TOKEN ?? "";
      if (!accountId || !token) {
        throw new ProviderAttemptError("cloudflare", route.models[0] ?? "unknown", {
          class: "auth_invalid",
          scope: "provider",
          message: "Cloudflare Workers AI credentials not set",
        });
      }
      return {
        baseUrl: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1`,
        headers: { Authorization: `Bearer ${token}` },
      };
    }
    case "byok": {
      const key = secrets.userApiKey ?? "";
      if (!key) {
        throw new ProviderAttemptError("byok", route.models[0] ?? "unknown", {
          class: "auth_invalid",
          scope: "provider",
          message: "BYOK requested without a user-supplied key",
        });
      }
      // User-specified openai-compatible endpoint or api.openai.com.
      const baseUrl = secrets.byokBaseUrl?.replace(/\/+$/, "") || OPENAI_BASE;
      return { baseUrl, headers: { Authorization: `Bearer ${key}` } };
    }
    default:
      throw new ProviderAttemptError(route.provider, route.models[0] ?? "unknown", {
        class: "bad_response",
        scope: "provider",
        message: `No OpenAI-compatible endpoint configured for provider ${route.provider}`,
      });
  }
}

function parseOpenAiCompatibleResponse(
  data: Record<string, unknown>,
  model: string,
  route: PlannedProvider,
  toolIdMap: Map<string, string>,
): LLMToolCallResponse {
  const choice = (data.choices as Array<Record<string, unknown>> | undefined)?.[0];
  if (!choice) {
    throw new ProviderAttemptError(route.provider, model, {
      class: "bad_response",
      scope: "provider",
      message: "No choices in response",
    });
  }

  const message = choice.message as Record<string, unknown> | undefined;
  const text: string = (message?.content as string) ?? "";
  const rawToolCalls = (message?.tool_calls as Array<{
    id: string;
    function: { name: string; arguments: string };
  }>) ?? [];
  const finishReason: string = (choice.finish_reason as string) ?? "stop";

  const toolCalls: ToolCallRequest[] = rawToolCalls.map((raw) => {
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

  return {
    text,
    toolCalls,
    finishReason,
    model: (data.model as string) ?? model,
    provider: route.provider,
  };
}

/** Shared OpenAI-compatible chat/completions attempt for OpenRouter, Groq,
 *  Mistral, Cloudflare Workers AI, Ollama (/v1), and BYOK endpoints. */
async function attemptOpenAiCompatible(
  route: PlannedProvider,
  model: string,
  req: AttemptRequest,
  ctx: AttemptContext,
  endpoint: { baseUrl: string; headers: Record<string, string> },
): Promise<LLMToolCallResponse> {
  const openAiTools = toOpenRouterTools(req.tools);
  const body: Record<string, unknown> = {
    model,
    stream: false,
    messages: [
      { role: "system", content: req.systemPrompt } as OpenRouterMessage,
      ...req.messages.map(toOpenRouterMessage),
    ],
    temperature: req.temperature ?? 0.15,
  };

  if (req.maxTokens) body.max_tokens = req.maxTokens;
  if (openAiTools.length > 0) {
    body.tools = openAiTools;
    body.tool_choice = req.toolChoice ?? "auto";
  }

  const res = await fetchWithTimeout(
    `${endpoint.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...endpoint.headers,
      },
      body: JSON.stringify(body),
    },
    ctx.timeoutMs,
    route.provider,
    ctx.signal,
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new ProviderAttemptError(
      route.provider,
      model,
      classifyHttpFailure(res.status, txt, parseRetryAfterMs(res.headers, txt)),
    );
  }

  const data = (await res.json()) as Record<string, unknown>;
  return parseOpenAiCompatibleResponse(data, model, route, req.toolIdMap);
}

// ─── Ollama ───────────────────────────────────────────────────────

/** Local model families with reliable structured tool calling. */
const OLLAMA_TOOL_CAPABLE =
  /llama-?3\.[123]|llama3\.[123]|qwen|mistral|nemo|command-r|granite|phi-?4|functionary|deepseek|devstral|gpt-oss/i;

const OLLAMA_PROBE_TTL_MS = 5 * 60_000;
const OLLAMA_PROBE_TIMEOUT_MS = 1_500;
let _ollamaProbeCache: { at: number; models: string[] } | null = null;

/** Test seam: inject a probe result instead of calling /api/tags. */
let _ollamaProbeOverride: (() => Promise<string[]>) | null = null;

/** @internal Test-only seam to override the Ollama model probe. */
export function _setOllamaProbeForTests(probe: (() => Promise<string[]>) | null): void {
  _ollamaProbeOverride = probe;
}

async function probeOllamaModels(endpoint: string, ctx: AttemptContext): Promise<string[]> {
  if (_ollamaProbeOverride) return _ollamaProbeOverride();
  if (_ollamaProbeCache && Date.now() - _ollamaProbeCache.at < OLLAMA_PROBE_TTL_MS) {
    return _ollamaProbeCache.models;
  }
  const res = await fetchWithTimeout(
    `${endpoint}/api/tags`,
    { method: "GET" },
    Math.min(ctx.timeoutMs, OLLAMA_PROBE_TIMEOUT_MS),
    "Ollama probe",
    ctx.signal,
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new ProviderAttemptError(
      "ollama",
      "auto",
      classifyHttpFailure(res.status, txt, parseRetryAfterMs(res.headers, txt)),
    );
  }
  const data = (await res.json()) as { models?: Array<{ name?: string }> };
  const models = (data.models ?? [])
    .map((m) => m.name)
    .filter((n): n is string => !!n);
  _ollamaProbeCache = { at: Date.now(), models };
  return models;
}

/** Pick a local model. When the request requires tools, only tool-capable
 *  families are eligible — a model that cannot emit tool calls is never
 *  selected just because it is free. */
function pickOllamaModel(available: string[], toolsRequired: boolean): string | null {
  const override = process.env.OLLAMA_MODEL;
  if (override) return override;
  if (available.length === 0) return null;
  if (!toolsRequired) return available[0];
  return available.find((m) => OLLAMA_TOOL_CAPABLE.test(m)) ?? null;
}

async function attemptOllama(
  _model: string,
  req: AttemptRequest,
  ctx: AttemptContext,
): Promise<LLMToolCallResponse> {
  const endpoint = resolveBasicOllamaEndpoint();

  let available: string[];
  try {
    available = await probeOllamaModels(endpoint, ctx);
  } catch (err) {
    if (err instanceof ProviderAttemptError || err instanceof UpstreamAbortError) throw err;
    throw new ProviderAttemptError("ollama", "auto", classifyThrownFailure(err));
  }

  const model = pickOllamaModel(available, req.tools.length > 0);
  if (!model) {
    throw new ProviderAttemptError("ollama", "auto", {
      class: "model_unavailable",
      scope: "provider",
      message: req.tools.length > 0
        ? "No tool-capable local model loaded in Ollama"
        : "No local models loaded in Ollama",
    });
  }

  const route: PlannedProvider = {
    provider: "ollama",
    adapter: "ollama",
    costClass: "LOCAL",
    capabilities: { tools: true, vision: false, structuredOutput: false, coding: true },
    models: [model],
    timeoutMs: ctx.timeoutMs,
    health: "healthy",
    credentialState: "not_required",
  };
  return attemptOpenAiCompatible(route, model, req, ctx, {
    baseUrl: `${endpoint}/v1`,
    headers: {},
  });
}

// ─── All-routes failure ───────────────────────────────────────────

export interface RouteAttemptFailure {
  provider: string;
  model: string;
  class: FailureClass;
  httpStatus?: number;
  latencyMs: number;
  message: string;
}

/**
 * Every eligible provider route failed (or none were eligible). Carries the
 * structured per-attempt failure list for diagnostics and a truthful,
 * secret-free message for the user.
 */
export class AllRoutesFailedError extends Error {
  readonly userMessage =
    "LiTT couldn't complete this request because all currently available AI routes " +
    "were unavailable or reached their limits. Your project and completed work are " +
    "preserved — try again shortly, connect a local model, or use a personal provider key.";

  constructor(
    public readonly failures: RouteAttemptFailure[],
    public readonly excluded: Array<{ provider: string; reason: string }>,
  ) {
    super(buildAllFailedMessage(failures, excluded));
    this.name = "AllRoutesFailedError";
  }
}

function buildAllFailedMessage(
  failures: RouteAttemptFailure[],
  excluded: Array<{ provider: string; reason: string }>,
): string {
  const attempted = failures
    .map((f) => `${f.provider}/${f.model}(${f.class}${f.httpStatus ? ` http_${f.httpStatus}` : ""}, ${f.latencyMs}ms)`)
    .join("; ");
  const skipped = excluded.map((e) => `${e.provider}(${e.reason})`).join(", ");
  if (failures.length === 0) {
    return `All tool-calling models failed. No eligible provider routes were available` +
      (skipped ? ` — excluded: ${skipped}` : "") + `.`;
  }
  return (
    `All tool-calling models failed. Attempts: ${attempted}.` +
    (skipped ? ` Excluded: ${skipped}.` : "")
  );
}

// ─── Call LLM with tools ──────────────────────────────────────────

/**
 * Route a tool-calling request through the Basic provider plan.
 *
 * Providers are selected by the registry (cost policy → capabilities →
 * credentials → health). Each provider attempt shares the caller's absolute
 * deadline: attemptTimeout = min(routeTimeout, remainingBudget - margin).
 * A provider-scope failure (401/402/provider-403/408/timeout/429/5xx/network)
 * stops the whole provider for this call; a model-scope failure (400/404/
 * model-403) advances to the next candidate model inside the same provider.
 *
 * Failover is transparent to the agent: the normalized LLMMessage transcript
 * carries every completed tool call and result, so the replacement provider
 * continues exactly where the failed one stopped — no tool is re-executed.
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
    /** BYOK: user-supplied API key — opts this request into USER_FUNDED routes. */
    userApiKey?: string;
    /** BYOK: which provider the key belongs to (openai-compatible only for tools). */
    byokProvider?: "openai" | "openai-compatible";
    /** BYOK: model override on the user's account. */
    byokModel?: string;
    /** BYOK: base URL for an openai-compatible user endpoint. */
    byokBaseUrl?: string;
  },
): Promise<LLMToolCallResponse> {
  const requirements: RouteRequirements = {
    tools: tools.length > 0,
    coding: tools.length > 0,
  };

  const plan = planBasicRoutes(requirements, {
    model: options?.model,
    userApiKey: options?.userApiKey,
    byokProvider: options?.byokProvider,
    byokModel: options?.byokModel,
    byokBaseUrl: options?.byokBaseUrl,
  });

  if (plan.droppedModelHint) {
    logRoute("model_hint_dropped", {
      model: plan.droppedModelHint,
      reason: "not_eligible_under_basic_cost_policy",
    });
  }

  const failures: RouteAttemptFailure[] = [];
  const toolIdMap = buildToolIdReverseMap(tools);
  const req: AttemptRequest = {
    systemPrompt,
    messages,
    tools,
    toolIdMap,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    toolChoice: options?.toolChoice,
  };
  const ctx: AttemptContext = {
    timeoutMs: 0, // per-attempt value set below
    signal: options?.signal,
    secrets: { userApiKey: options?.userApiKey, byokBaseUrl: options?.byokBaseUrl },
  };

  if (plan.providers.length === 0) {
    logRoute("no_eligible_routes", {
      excluded: plan.excluded.map((e) => `${e.provider}:${e.reason}`).join(","),
      remainingBudgetMs: options?.deadlineMs ? Math.max(0, options.deadlineMs - Date.now()) : undefined,
    });
    throw new AllRoutesFailedError(failures, plan.excluded);
  }

  const promptLog = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

  for (let r = 0; r < plan.providers.length; r++) {
    const route = plan.providers[r];
    const nextProvider = plan.providers[r + 1]?.provider;

    for (const model of route.models) {
      if (isModelCoolingDown(route.provider, model)) {
        logRoute("model_skipped", { provider: route.provider, model, reason: "model_cooldown" });
        continue;
      }

      // Bounded per-attempt timeout from the shared absolute deadline.
      const attemptTimeoutMs = computeAttemptTimeout(
        options?.deadlineMs,
        route.timeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS,
      );
      if (attemptTimeoutMs === null) {
        const remainingMs = options?.deadlineMs ? options.deadlineMs - Date.now() : 0;
        logRoute("budget_exhausted", {
          provider: route.provider,
          model,
          remainingBudgetMs: Math.max(0, remainingMs),
        });
        throw new AgentBudgetExhaustedError(
          remainingMs,
          `${route.provider}/${model} attempt cannot fit in remaining budget`,
        );
      }
      const wasDeadlineConstrained =
        options?.deadlineMs !== undefined && attemptTimeoutMs < route.timeoutMs;

      ctx.timeoutMs = attemptTimeoutMs;
      const t0 = Date.now();
      logRoute("attempt_start", {
        provider: route.provider,
        model,
        costClass: route.costClass,
        timeoutMs: attemptTimeoutMs,
        remainingBudgetMs: options?.deadlineMs
          ? Math.max(0, options.deadlineMs - t0)
          : undefined,
      });

      try {
        const result =
          route.adapter === "gemini"
            ? await attemptGemini(model, req, ctx)
            : route.adapter === "ollama"
              ? await attemptOllama(model, req, ctx)
              : await attemptOpenAiCompatible(
                  route,
                  model,
                  req,
                  ctx,
                  compatEndpointFor(route, ctx.secrets),
                );

        recordProviderSuccess(route.provider);
        const latencyMs = Date.now() - t0;
        logRoute("attempt_success", {
          provider: route.provider,
          model: result.model,
          latencyMs,
          toolCalls: result.toolCalls.length,
          remainingBudgetMs: options?.deadlineMs
            ? Math.max(0, options.deadlineMs - Date.now())
            : undefined,
        });
        logLLMCall({
          prompt: promptLog,
          systemPrompt,
          output: result.text,
          provider: route.provider,
          model: result.model,
          latencyMs,
          failover: failures.map((f) => `${f.provider}/${f.model}`),
          metadata: options?.evalMetadata ?? {},
        });
        return result;
      } catch (err) {
        const latencyMs = Date.now() - t0;

        // Upstream/client abort — stop the whole chain immediately.
        if (err instanceof UpstreamAbortError || options?.signal?.aborted) {
          throw err instanceof UpstreamAbortError
            ? err
            : new UpstreamAbortError(route.provider);
        }
        // Agent budget is already exhausted — nothing else can run.
        if (err instanceof AgentBudgetExhaustedError) throw err;

        const failure: ProviderFailure =
          err instanceof ProviderAttemptError ? err.failure : classifyThrownFailure(err);

        // A timeout that was clipped by the shared deadline means no other
        // legitimate attempt can fit — surface the truthful budget error.
        if (failure.class === "timeout" && wasDeadlineConstrained) {
          const remainingMs = options?.deadlineMs ? options.deadlineMs - Date.now() : 0;
          throw new AgentBudgetExhaustedError(
            remainingMs,
            `${route.provider}/${model} timed out against agent budget (timeout=${attemptTimeoutMs}ms)`,
          );
        }

        failures.push({
          provider: route.provider,
          model,
          class: failure.class,
          httpStatus: failure.httpStatus,
          latencyMs,
          message: failure.message,
        });

        logRoute("attempt_failure", {
          provider: route.provider,
          model,
          class: failure.class,
          httpStatus: failure.httpStatus,
          scope: failure.scope,
          latencyMs,
          retryAfterMs: failure.retryAfterMs,
          remainingBudgetMs: options?.deadlineMs
            ? Math.max(0, options.deadlineMs - Date.now())
            : undefined,
        });
        logLLMCall({
          prompt: promptLog,
          systemPrompt,
          output: "",
          provider: route.provider,
          model,
          latencyMs,
          failover: failures.slice(0, -1).map((f) => `${f.provider}/${f.model}`),
          metadata: { ...(options?.evalMetadata ?? {}), failureCategory: failure.class } as LLMCallMetadata,
        });

        if (failure.scope === "provider") {
          recordProviderFailure(route.provider, failure);
          logRoute("fallback", {
            from: route.provider,
            to: nextProvider ?? "none",
            class: failure.class,
            cooldownUntil: failure.class === "rate_limited" && failure.retryAfterMs
              ? Date.now() + failure.retryAfterMs
              : undefined,
          });
          break; // next provider — no more models behind the same account
        }

        // Model-scope failure — cool the model, try the provider's next model.
        recordModelFailure(route.provider, model);
      }
    }
  }

  throw new AllRoutesFailedError(failures, plan.excluded);
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
