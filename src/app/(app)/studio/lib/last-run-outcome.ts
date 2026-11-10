/**
 * Settled-run truth derived from the persisted conversation.
 *
 * The execution store (useExecutionStore) is fed by live SSE events only —
 * after a reload it is empty and every surface reading it reports
 * Idle / "No activity yet", even when the conversation's last run failed
 * minutes ago. The persisted messages are the durable record: the latest
 * settled assistant message IS the last run's outcome.
 *
 * These helpers are the one derivation every post-reload surface (header
 * pill, operator bar, Activity tab) uses, so they can never disagree
 * with the transcript the user is looking at.
 */

import type { ChatMessage } from "../stores/useStudioAgentStore";

export type RunOutcome = "failed" | "completed";

/**
 * Minimal settled-message shape shared by the UI transcript messages
 * (useStudioAgentStore) and the canonical store messages
 * (useConversationStore) — the scan below only ever reads these fields,
 * so both message families feed the ONE derivation.
 */
type SettledMessageLike = {
  role: string;
  status?: string | null;
  content?: string | null;
};

/** The latest settled run in one message list, with its raw content. */
function scanLatestSettled(
  messages: readonly SettledMessageLike[],
): { outcome: RunOutcome; content: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") continue;
    if (message.status === "failed") return { outcome: "failed", content: message.content ?? "" };
    if (message.status === "completed") return { outcome: "completed", content: message.content ?? "" };
  }
  return null;
}

export type ToolActivityRecord = {
  toolId: string;
  success?: boolean;
  summary: string;
};

/**
 * The outcome of the most recent SETTLED run in the conversation.
 * Streaming/pending messages are skipped — a run in flight has no
 * outcome yet (live surfaces own that state). Returns null when no
 * assistant message has settled.
 */
export function latestRunOutcome(
  messages: readonly ChatMessage[],
): RunOutcome | null {
  return scanLatestSettled(messages)?.outcome ?? null;
}

export interface ProjectRunTruth {
  outcome: RunOutcome;
  /** Why the run failed — the failed message's own words, bounded. Null
   *  for a completed run or a failure that carried no explanation. */
  failureNote: string | null;
}

const FAILURE_NOTE_MAX = 220;

function toFailureNote(content: string): string | null {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > FAILURE_NOTE_MAX
    ? `${collapsed.slice(0, FAILURE_NOTE_MAX)}…`
    : collapsed;
}

/**
 * The PROJECT's last run truth, across its conversations.
 *
 * Wave-3 Finding 3 (Larry's screenshot, 2026-11-10): the header derived
 * run outcome from the OPEN conversation only, so a fresh conversation
 * in a project whose only build had failed headlined a green "Ready".
 * The project header must reflect the project's last run when the open
 * conversation has none of its own.
 *
 * `messageSets` are given in recency order — the open conversation
 * first, then the project's other conversations (the list is already
 * updated_at-desc). The first set with a settled run IS the project's
 * last run; every set is judged by the same scanLatestSettled
 * derivation as latestRunOutcome, so surfaces can never disagree.
 * Sets whose messages are not loaded yet are skipped — callers load
 * them (bounded) and re-derive.
 */
export function projectLastRun(
  messageSets: readonly (readonly SettledMessageLike[] | undefined)[],
): ProjectRunTruth | null {
  for (const messages of messageSets) {
    if (!messages) continue;
    const settled = scanLatestSettled(messages);
    if (!settled) continue;
    return {
      outcome: settled.outcome,
      failureNote: settled.outcome === "failed" ? toFailureNote(settled.content) : null,
    };
  }
  return null;
}

/**
 * The most recent run that left execution evidence (recorded tool
 * activity), with its outcome and the factual per-step records.
 * Conversational replies carry no evidence and are skipped — a chat
 * reply is not a run. Returns null when no run has recorded activity.
 */
export function latestRunActivity(
  messages: readonly ChatMessage[],
): { outcome: RunOutcome; records: ToolActivityRecord[] } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") continue;
    if (message.status !== "failed" && message.status !== "completed") {
      continue;
    }
    const records = message.toolActivity ?? [];
    if (records.length === 0 && !message.execution) continue;
    return { outcome: message.status, records };
  }
  return null;
}
