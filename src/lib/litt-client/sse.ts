import type { ProgressEvent } from "@/lib/litt-intelligence/progress-events";

/**
 * SSE frame parser for `/api/studio/conversations/.../messages`.
 *
 * The line split matches `useCanonicalConversation`'s reader:
 * append the chunk, split on `\n`, keep the incomplete tail, ignore
 * lines that are not `data:`, ignore the `[DONE]` sentinel as a
 * stream terminator, and skip JSON that does not parse. That loop
 * stays inside the Studio hook in Phase 0 — swapping it would risk
 * the live transcript. This module is the same rules, typed, for the
 * LiTT App.
 *
 * Wire events are not all `ProgressEvent`s. The route rewrites
 * `tool_start` / `tool_result` to `tool_execution`, and it also emits
 * `text`, `pending_approval`, `done`, and `error`. `toProgressEvent`
 * maps the overlapping ones back onto the progress union.
 */

export type ConversationTextEvent = { type: "text"; text?: string };
export type ConversationToolExecutionEvent = {
  type: "tool_execution";
  toolId?: string;
  success?: boolean;
  summary?: string;
  durationMs?: number;
};
export type ConversationPendingApprovalEvent = {
  type: "pending_approval";
  toolId?: string;
  reason?: string;
  pausedRunId?: string;
  inputs?: Record<string, unknown>;
};
export type ConversationDoneEvent = {
  type: "done";
  userMessage?: unknown;
  assistantMessage?: unknown;
  revision?: number;
};
export type ConversationErrorEvent = {
  type: "error";
  message?: string;
  code?: string;
  revision?: number;
  partialText?: string;
  detail?: { message?: string; partialText?: string };
};
export type ConversationActionsEvent = { type: "actions"; actions?: unknown[] };

/** Reasoning chunks on the conversation stream use `text`, not `summary`. */
export type ConversationReasoningEvent = { type: "reasoning"; summary?: string; text?: string };

export type ConversationStreamEvent =
  | Exclude<ProgressEvent, { type: "reasoning" }>
  | ConversationReasoningEvent
  | ConversationTextEvent
  | ConversationToolExecutionEvent
  | ConversationPendingApprovalEvent
  | ConversationDoneEvent
  | ConversationErrorEvent
  | ConversationActionsEvent;

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "phase",
  "tool_start",
  "tool_result",
  "approval_required",
  "checkpoint",
  "build_start",
  "build_result",
  "workspace_change",
  "repair_attempt",
  "preview_start",
  "preview_status",
  "preview_result",
  "deploy_start",
  "deploy_status",
  "deploy_result",
  "deploy_verify",
  "finished",
  "cancelled",
  "model_routing",
  "step_timing",
  "model_response",
  "model_failed",
  "reasoning",
  "status",
  "quality_verdict",
  "text",
  "tool_execution",
  "pending_approval",
  "done",
  "error",
  "actions",
]);

export interface SseConsumeResult {
  events: ConversationStreamEvent[];
  /** True once a `data: [DONE]` sentinel has been seen. */
  done: boolean;
  /** `data:` lines whose payload was not JSON. The Studio reader ignores these. */
  malformed: number;
  /** Incomplete trailing line, kept for the next chunk. */
  rest: string;
}

function asStreamEvent(value: unknown): ConversationStreamEvent | null {
  if (!value || typeof value !== "object") return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string" || !KNOWN_EVENT_TYPES.has(type)) return null;
  return value as ConversationStreamEvent;
}

/**
 * Consume one decoded chunk. Pass `rest` from the previous call as
 * `buffer`. A final chunk that does not end in a newline leaves its
 * last line in `rest` — Studio's reader drops that tail when the
 * stream closes, and this function does too unless the caller flushes.
 */
export function consumeSseChunk(buffer: string, chunk: string): SseConsumeResult {
  const combined = buffer + chunk;
  const lines = combined.split("\n");
  const rest = lines.pop() ?? "";
  const events: ConversationStreamEvent[] = [];
  let done = false;
  let malformed = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") {
      done = true;
      continue;
    }
    try {
      const event = asStreamEvent(JSON.parse(payload) as unknown);
      if (event) events.push(event);
    } catch {
      malformed += 1;
    }
  }

  return { events, done, malformed, rest };
}

/** Parse a complete SSE body, including a trailing line with no newline. */
export function parseSseBody(body: string): SseConsumeResult {
  const withNewline = body.endsWith("\n") ? body : `${body}\n`;
  return consumeSseChunk("", withNewline);
}

/**
 * Map a wire event onto `ProgressEvent` when it is one.
 * `tool_execution` becomes `tool_start` (no `success`) or `tool_result`.
 * Transcript-only events (`text`, `done`, `error`, `pending_approval`,
 * `actions`) return null — they are not progress events.
 */
export function toProgressEvent(event: ConversationStreamEvent): ProgressEvent | null {
  if (event.type === "tool_execution") {
    const toolId = event.toolId ?? "";
    const summary = event.summary ?? "";
    if (event.success === undefined) {
      return { type: "tool_start", toolId, summary };
    }
    return {
      type: "tool_result",
      toolId,
      success: event.success,
      summary,
      durationMs: event.durationMs ?? 0,
    };
  }

  if (event.type === "reasoning") {
    const summary = typeof event.summary === "string"
      ? event.summary
      : typeof event.text === "string"
        ? event.text
        : null;
    if (summary === null) return null;
    return { type: "reasoning", summary };
  }

  switch (event.type) {
    case "text":
    case "pending_approval":
    case "done":
    case "error":
    case "actions":
      return null;
    default:
      return event;
  }
}
