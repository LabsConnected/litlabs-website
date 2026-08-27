/**
 * ChatTranscriptStore — pure, framework-agnostic transcript state.
 *
 * This is the canonical assistant/user conversation state, extracted from
 * the React hook so the persistence/rendering invariants are testable
 * without a React renderer (the CLI test env is `node`, not jsdom).
 *
 * The CockpitStore hook delegates transcript mutations to an instance of
 * this class and mirrors its state into React state for rendering.
 *
 * Invariants enforced here (and covered by chat-transcript.test.ts):
 *   1. Exactly one assistant message per turn — never duplicated.
 *   2. The final response body is set once via finalize().
 *   3. Streaming deltas append to the pending assistant message only.
 *   4. The transcript is bounded (last MAX messages) — unbounded growth
 *      is prevented, but prior responses are NOT dropped prematurely.
 *   5. finalize() is idempotent against user messages and empty transcripts.
 *   6. appendDelta() is a no-op on finalized/empty transcripts.
 *   7. appendDelta() and finalize() are scoped to a specific message id —
 *      the one add() returned when THAT turn opened its own streaming
 *      assistant message. A superseded turn (cancelled, timed out, or
 *      simply slow) whose deltas arrive after a newer turn has already
 *      opened its message is a NO-OP: it cannot append to, overwrite, or
 *      finalize the newer message. Without id scoping these methods
 *      targeted whatever message happened to be LAST, so a late delta
 *      from an abandoned stream corrupted the live response.
 */

import type { ChatMessage } from "./cockpit-store.js";

export const MAX_CHAT_MESSAGES = 50;

export class ChatTranscriptStore {
  private messages: ChatMessage[] = [];

  /** Current transcript snapshot (most recent first-in-array order). */
  snapshot(): ChatMessage[] {
    return this.messages;
  }

  /** Number of messages. */
  length(): number {
    return this.messages.length;
  }

  /** True if the transcript is empty. */
  isEmpty(): boolean {
    return this.messages.length === 0;
  }

  /** The last message, or null. */
  last(): ChatMessage | null {
    return this.messages.length === 0 ? null : this.messages[this.messages.length - 1];
  }

  /** The message with this id, or null. */
  find(id: string): ChatMessage | null {
    const index = this.indexOf(id);
    return index === -1 ? null : this.messages[index];
  }

  /** Index of the message with this id, or -1. */
  private indexOf(id: string): number {
    return this.messages.findIndex((m) => m.id === id);
  }

  /**
   * Append a new user or assistant message. Returns the message id.
   * Bounds the transcript to the last MAX_CHAT_MESSAGES entries.
   */
  add(msg: Omit<ChatMessage, "id">): string {
    const id = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.messages = [...this.messages.slice(-(MAX_CHAT_MESSAGES - 1)), { ...msg, id }];
    return id;
  }

  /**
   * Append a delta to the assistant message identified by `id` (streaming
   * live preview).
   *
   * `id` MUST be the value add() returned when the caller opened ITS OWN
   * streaming assistant message. Every other case is a no-op:
   *   - unknown id (never existed, or aged out of the bounded transcript)
   *   - the id names a user message, or an already-finalized one
   *   - empty delta
   * This is invariant 7: a superseded turn's late deltas cannot touch a
   * newer turn's message.
   */
  appendDelta(id: string, text: string): void {
    if (!id || !text) return;
    const index = this.indexOf(id);
    if (index === -1) return;
    const target = this.messages[index];
    if (target.role !== "assistant" || target.status !== "streaming") return;
    const next = this.messages.slice();
    next[index] = { ...target, content: target.content + text };
    this.messages = next;
  }

  /**
   * Finalize the assistant message identified by `id` with canonical
   * content + status.
   * Called ONCE when the agent loop completes (success) or errors.
   * Replaces the streaming body with the authoritative final content so
   * the persisted message is exactly what the runtime produced — never a
   * partial stream, never duplicated. Also stamps the served model.
   *
   * `id` MUST be the value add() returned when the caller opened ITS OWN
   * streaming assistant message. No-op when the id is unknown (never
   * existed, or aged out of the bounded transcript) or names a user
   * message — which guards both against finalize being called when no
   * assistant message was opened, and against a superseded turn
   * finalizing a newer turn's message (invariant 7).
   */
  finalize(id: string, options: {
    content: string;
    status: "complete" | "error";
    servedModel?: string | null;
    durationMs?: number | null;
  }): void {
    if (!id) return;
    const index = this.indexOf(id);
    if (index === -1) return;
    const target = this.messages[index];
    if (target.role !== "assistant") return;
    const next = this.messages.slice();
    next[index] = {
      ...target,
      content: options.content,
      status: options.status,
      servedModel: options.servedModel ?? target.servedModel ?? null,
      durationMs: options.durationMs ?? target.durationMs ?? null,
    };
    this.messages = next;
  }

  /** Clear the transcript. */
  clear(): void {
    this.messages = [];
  }
}
