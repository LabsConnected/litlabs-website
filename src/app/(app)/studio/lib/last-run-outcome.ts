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
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") continue;
    if (message.status === "failed") return "failed";
    if (message.status === "completed") return "completed";
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
