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
   * Append a delta to the LAST assistant message (streaming live preview).
   * No-op if the last message is not a streaming assistant message.
   * No-op on empty deltas.
   */
  appendDelta(text: string): void {
    if (!text) return;
    const last = this.last();
    if (!last || last.role !== "assistant" || last.status !== "streaming") return;
    this.messages = [
      ...this.messages.slice(0, -1),
      { ...last, content: last.content + text },
    ];
  }

  /**
   * Finalize the LAST assistant message with canonical content + status.
   * Called ONCE when the agent loop completes (success) or errors.
   * Replaces the streaming body with the authoritative final content so
   * the persisted message is exactly what the runtime produced — never a
   * partial stream, never duplicated. Also stamps the served model.
   *
   * No-op if the last message is not an assistant message (e.g. a user
   * message, or an empty transcript). This guards against finalize being
   * called when no streaming assistant message was opened.
   */
  finalize(options: {
    content: string;
    status: "complete" | "error";
    servedModel?: string | null;
  }): void {
    const last = this.last();
    if (!last || last.role !== "assistant") return;
    this.messages = [
      ...this.messages.slice(0, -1),
      {
        ...last,
        content: options.content,
        status: options.status,
        servedModel: options.servedModel ?? last.servedModel ?? null,
      },
    ];
  }

  /** Clear the transcript. */
  clear(): void {
    this.messages = [];
  }
}
