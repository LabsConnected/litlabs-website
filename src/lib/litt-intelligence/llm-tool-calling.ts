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

// ─── Call LLM with tools ──────────────────────────────────────────

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

function getOpenRouterKey(): string {
  return process.env.OPENROUTER_API_KEY ?? "";
}

/**
 * Fallback model chain for tool-calling rounds.
 * When the primary model fails, we try these in order.
 * All models must support OpenRouter's native tool-calling API.
 */
const TOOL_CALLING_FALLBACK_MODELS = [
  "google/gemini-2.5-flash",
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-4o-mini",
  "meta-llama/llama-3.3-70b-instruct",
];

/**
 * Categorize an HTTP error for logging and fallback decisions.
 * Never includes request bodies or auth tokens — only status + category.
 */
function categorizeError(status: number | null, _message: string): string {
  if (status === null) return "network_error";
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
  },
): Promise<LLMToolCallResponse> {
  const key = getOpenRouterKey();
  if (!key) throw new Error("OPENROUTER_API_KEY not set — cannot make tool-calling LLM calls");

  const primaryModel = options?.model ?? "google/gemini-2.5-flash";
  const openRouterTools = toOpenRouterTools(tools);
  const toolIdMap = buildToolIdReverseMap(tools);

  // Build the attempt chain: primary model first, then fallbacks (deduped)
  const attemptChain = [primaryModel, ...TOOL_CALLING_FALLBACK_MODELS.filter((m) => m !== primaryModel)];

  const failures: Array<{ model: string; status: number | null; category: string; latencyMs: number; message: string }> = [];

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

    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": SITE_URL,
          "X-Title": "LiTT",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      const latencyMs = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      const category = categorizeError(null, msg);
      failures.push({ model, status: null, category, latencyMs, message: msg });
      // Network/timeout errors are retryable — try next model
      continue;
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const latencyMs = Date.now() - t0;
      const category = categorizeError(res.status, txt);
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
