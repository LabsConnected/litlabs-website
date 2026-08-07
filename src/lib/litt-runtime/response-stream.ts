/**
 * LiTT Runtime — Response Stream
 *
 * SSE helpers for streaming LiTT runs. Produces the canonical event shape
 * consumed by Studio, the global companion, and voice transport adapters.
 *
 * Event types:
 *   { type: "text", text }            — assistant text chunk
 *   { type: "reasoning", text }       — reasoning chunk (when available)
 *   { type: "actions", actions }      — detected canvas/suggested actions
 *   { type: "done", ...metadata }     — final result with ids/revision
 *   { type: "error", message, ... }   — recoverable error with partial text
 *   data: [DONE]                      — terminal sentinel
 */

import { detectCanvasActions, detectSuggestedActions } from "@/lib/canvas/actions";

export interface StreamDonePayload {
  provider: string;
  model: string;
  latencyMs: number;
  actions?: unknown[];
  reasoning?: string;
  // Studio persistence fields (present when conversation persistence is wired)
  userMessage?: unknown;
  assistantMessage?: unknown;
  revision?: number;
}

export interface StreamErrorPayload {
  message: string;
  partialText?: string;
}

export function createLiTTStream() {
  const encoder = new TextEncoder();
  const event = (payload: Record<string, unknown>) =>
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  const done = () => encoder.encode("data: [DONE]\n\n");
  return { encoder, event, done };
}

/**
 * Detect actions for the response. Explicit user-message actions take
 * precedence over LLM-suggested actions (deduplicated).
 */
export function detectActions(message: string, assistantText: string, activeCanvasId: string | null | undefined): unknown[] {
  const explicit = detectCanvasActions(message, activeCanvasId ?? null);
  const suggested = detectSuggestedActions(assistantText);
  return explicit.length > 0 ? explicit : suggested;
}

export function buildSseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  };
}
