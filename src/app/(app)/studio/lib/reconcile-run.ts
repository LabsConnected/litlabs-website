"use client";

import type { ConversationMessage, MessageStatus } from "@/lib/studio/types";

/**
 * Reconcile canonical run state after an SSE transport loss.
 *
 * When the browser loses the event stream after the server already
 * accepted a message send, the server-side LiTT execution keeps running.
 * The client must NOT declare "no work completed" and must NOT resend the
 * mutation — it reloads the canonical conversation state (GET messages,
 * scoped by clientRequestId → parentMessageId) until the persisted
 * assistant message reaches a terminal status or the bounded poll budget
 * is exhausted.
 */

export interface ReconcileSnapshot {
  messages: ConversationMessage[];
  revision: number;
}

export interface ReconcileResult {
  /**
   * - completed / failed / cancelled / awaiting_approval: persisted
   *   terminal state of the assistant message.
   * - running: the exact run was identified (persisted user message for
   *   this clientRequestId) and the assistant message is still
   *   streaming/pending or not yet visible — the run is alive.
   * - unknown: canonical state could not be determined — repeated fetch
   *   failures, OR the exact run identity could not be established (no
   *   persisted user message with this clientRequestId). NEVER reported
   *   as a terminal state.
   */
  state: "completed" | "failed" | "cancelled" | "awaiting_approval" | "running" | "unknown";
  userMessage: ConversationMessage | null;
  assistantMessage: ConversationMessage | null;
  revision: number | null;
  /** True when at least one canonical snapshot was successfully read. */
  sawServerState: boolean;
}

const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_BASE_DELAY_MS = 1_200;
const MAX_DELAY_MS = 6_000;
/** Give up early when the server is unreachable this many times in a row —
 *  a dead network won't heal within the poll window. */
const MAX_CONSECUTIVE_FETCH_FAILURES = 3;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll the canonical conversation state until the run started by
 * `clientRequestId` resolves to a terminal assistant status, the poll
 * budget is exhausted, or the server proves unreachable.
 *
 * This function only ever READS state — it never resends a mutation and
 * never mints a new clientRequestId, so no duplicate work can be kicked
 * off by reconciliation.
 */
export async function reconcileRunState(options: {
  clientRequestId: string;
  fetchSnapshot: () => Promise<ReconcileSnapshot | null>;
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ReconcileResult> {
  const {
    clientRequestId,
    fetchSnapshot,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    sleep = defaultSleep,
  } = options;

  let lastUserMessage: ConversationMessage | null = null;
  let lastAssistantMessage: ConversationMessage | null = null;
  let lastRevision: number | null = null;
  let sawServerState = false;
  let consecutiveFetchFailures = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const snapshot = await fetchSnapshot().catch(() => null);

    if (!snapshot) {
      consecutiveFetchFailures++;
      if (consecutiveFetchFailures >= MAX_CONSECUTIVE_FETCH_FAILURES) {
        return {
          state: "unknown",
          userMessage: lastUserMessage,
          assistantMessage: lastAssistantMessage,
          revision: lastRevision,
          sawServerState,
        };
      }
    } else {
      consecutiveFetchFailures = 0;
      sawServerState = true;
      lastRevision = snapshot.revision ?? lastRevision;

      // Locate the persisted user message for THIS send. client_request_id
      // is persisted by insertMessage and returned by GET /messages, so it
      // is the authoritative run identity. There is deliberately NO
      // fallback to "the most recent user message" — guessing would
      // associate a different execution's outcome with this send.
      const userMessage =
        [...snapshot.messages].reverse().find(
          (m) => m.role === "user" && m.clientRequestId === clientRequestId,
        ) ?? null;

      if (userMessage) {
        lastUserMessage = userMessage;
        const assistantMessage =
          [...snapshot.messages].reverse().find(
            (m) => m.role === "assistant" && m.parentMessageId === userMessage.id,
          ) ?? null;
        lastAssistantMessage = assistantMessage ?? lastAssistantMessage;

        if (assistantMessage) {
          switch (assistantMessage.status) {
            case "completed":
            case "failed":
            case "cancelled":
            case "awaiting_approval":
              return {
                state: assistantMessage.status,
                userMessage,
                assistantMessage,
                revision: snapshot.revision ?? lastRevision,
                sawServerState: true,
              };
            default:
              // "streaming" / "pending" — still running server-side.
              break;
          }
        }
      }
    }

    if (attempt < maxAttempts - 1) {
      await sleep(Math.min(baseDelayMs * (attempt + 1), MAX_DELAY_MS));
    }
  }

  // Poll budget exhausted. "running" is only claimed when the exact run
  // identity was established (the persisted user message for this
  // clientRequestId exists) — otherwise the truthful answer is "unknown",
  // never a guess and never a terminal state.
  return {
    state: lastUserMessage ? "running" : "unknown",
    userMessage: lastUserMessage,
    assistantMessage: lastAssistantMessage,
    revision: lastRevision,
    sawServerState,
  };
}

/**
 * Map a reconcile outcome to the status the optimistic assistant bubble
 * should display. Non-terminal outcomes ("running", "unknown") map to the
 * non-terminal "streaming" status — an inability to observe the server is
 * never a failure and never a cancellation.
 */
export function reconciledAssistantStatus(
  state: ReconcileResult["state"],
): MessageStatus {
  switch (state) {
    case "completed":
    case "awaiting_approval":
    case "failed":
    case "cancelled":
      return state;
    default:
      return "streaming";
  }
}
