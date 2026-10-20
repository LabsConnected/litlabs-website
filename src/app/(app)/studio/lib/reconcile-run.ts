"use client";

import type { ConversationMessage, MessageStatus } from "@/lib/studio/types";
import { useExecutionStore } from "../stores/useExecutionStore";
import type { ActionRunDisplayState } from "../components/ActionRunStatusPanel";

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

// ─────────────────────────────────────────────────────────────────────────────
// Mount-time canonical fold (R4 / E3-S5)
//
// The helpers above reconcile a run after an in-session SSE loss. This
// fold is the LOAD-TIME counterpart: when a conversation loads, the
// canonical action-run projection is fetched once and folded into the
// execution store, so the operator bar, mission panel, and tab badges —
// all store readers — reflect the server's truth instead of the empty
// post-reload store ("Idle" over a live run; a stale gate residue
// announcing "Approval needed" over a finished one).
//
// Monotonicity (stale-response protection): convergence here is
// one-directional. A snapshot may only supersede state that is itself
// snapshot-derived or empty — never a locally recorded outcome, never
// a live decision flow, and never a locally mounted gate. A stale
// response arriving after a newer terminal state was applied is
// dropped wholesale.
// ─────────────────────────────────────────────────────────────────────────────

/** The load-time view of the canonical action-run projection. */
export interface CanonicalRunSnapshot {
  runId: string | null;
  runStatus: string | null;
  displayState: ActionRunDisplayState;
  currentActivity: string | null;
  pendingApprovals: Array<{ id: string; toolId: string; reason: string }>;
}

const TERMINAL_DISPLAY_PHASES: Partial<
  Record<ActionRunDisplayState, "done" | "failed" | "cancelled">
> = {
  completed: "done",
  failed: "failed",
  stopped: "cancelled",
};

const ACTIVE_DISPLAY_STATES: ReadonlySet<ActionRunDisplayState> = new Set([
  "queued",
  "starting",
  "running",
  "waiting_for_user",
  "paused",
  "stopping",
  "awaiting_approval",
]);

/** Fetch the canonical action-run projection once. Null = no run / unreadable. */
export async function fetchCanonicalRunSnapshot(
  conversationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CanonicalRunSnapshot | null> {
  try {
    const resp = await fetchImpl(
      `/api/studio/conversations/${conversationId}/action-run`,
      { credentials: "include" },
    );
    if (!resp.ok) return null;
    const body = (await resp.json().catch(() => null)) as {
      projection?: {
        run?: { id?: string; status?: string };
        displayState?: ActionRunDisplayState;
        currentActivity?: string | null;
        pendingApprovals?: Array<{ id: string; toolId: string; reason?: string }>;
      } | null;
    } | null;
    const projection = body?.projection;
    if (!projection?.displayState) return null;
    return {
      runId: projection.run?.id ?? null,
      runStatus: projection.run?.status ?? null,
      displayState: projection.displayState,
      currentActivity: projection.currentActivity ?? null,
      pendingApprovals: (projection.pendingApprovals ?? []).map((a) => ({
        id: a.id,
        toolId: a.toolId,
        reason: a.reason ?? "",
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Fold one canonical snapshot into the execution store. Guard summary
 * (each guard is a stale-response scenario in the regression suite):
 *  - a live local decision flow (submitting/executing) owns the state —
 *    the fold never touches it;
 *  - a TERMINAL snapshot acts only from an empty (idle) store or a
 *    gate-waiting store whose gate is itself snapshot-derived
 *    (`rehydrated`) — a locally mounted gate converges through its own
 *    watcher/poll, and any other phase is a locally recorded outcome
 *    the snapshot must not rewrite;
 *  - a NON-terminal snapshot never applies over a locally recorded
 *    terminal phase (done/failed/cancelled), never replaces a mounted
 *    gate, and never resurrects a gate this client already decided
 *    (resolvedPausedRunIds).
 */
export function foldCanonicalRunIntoExecutionStore(
  conversationId: string,
  snapshot: CanonicalRunSnapshot,
): void {
  const exec = useExecutionStore.getState();
  if (exec.approvalPhase === "submitting" || exec.approvalPhase === "executing") {
    return;
  }

  const terminalPhase = TERMINAL_DISPLAY_PHASES[snapshot.displayState];
  if (terminalPhase) {
    if (exec.phase !== "idle" && exec.phase !== "awaiting_approval") return;
    const gate = exec.pendingApproval;
    if (gate) {
      // Only a snapshot-derived gate may be cleared by a snapshot; a
      // locally mounted gate is newer evidence than any fetch.
      if (!gate.rehydrated) return;
      if (gate.conversationId && gate.conversationId !== conversationId) return;
      exec.setPendingApproval(null);
    }
    useExecutionStore.getState().endRun(
      terminalPhase === "cancelled"
        ? "cancelled"
        : terminalPhase === "failed"
          ? "failed"
          : undefined,
    );
    return;
  }

  // Non-terminal snapshot: terminal truth already recorded locally wins.
  if (exec.phase === "done" || exec.phase === "failed" || exec.phase === "cancelled") {
    return;
  }

  const liveGate = snapshot.pendingApprovals[0];
  if (liveGate) {
    if (exec.pendingApproval || exec.isRunning) return;
    // A gate this client already decided never re-arms from a snapshot.
    if (exec.resolvedPausedRunIds.includes(liveGate.id)) return;
    exec.setPendingApproval({
      toolId: liveGate.toolId,
      reason: liveGate.reason,
      pausedRunId: liveGate.id,
      conversationId,
      rehydrated: true,
    });
    return;
  }

  // Active run, no gate: an untouched store must not claim idle while
  // the server is working (the post-reload operator-bar truth).
  if (
    ACTIVE_DISPLAY_STATES.has(snapshot.displayState) &&
    exec.phase === "idle" &&
    !exec.isRunning &&
    !exec.pendingApproval
  ) {
    useExecutionStore.setState({ isRunning: true, phase: "running" });
  }
}

/** Fetch + fold on conversation load. Never throws. */
export async function reconcileConversationRunOnLoad(
  conversationId: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const snapshot = await fetchCanonicalRunSnapshot(conversationId, fetchImpl);
  if (snapshot) foldCanonicalRunIntoExecutionStore(conversationId, snapshot);
}
