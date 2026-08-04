/**
 * ConversationEngine — manages canonical message lifecycle.
 *
 * Responsibilities:
 * - Create canonical user and assistant messages
 * - Stream assistant text deltas into the existing message
 * - Persist final messages
 * - Link messages to Canvas blocks
 * - Emit events on the shared LiTTEventBus
 *
 * Rules (Ultra Handbook v11.0):
 * - One final user utterance creates exactly one user message.
 * - One assistant turn creates exactly one assistant message.
 * - Partial voice transcription is temporary UI state (not saved).
 * - Streaming updates the existing assistant message (not new messages).
 * - Transport events never become chat messages.
 * - Tool status events never become assistant dialogue.
 */

import type { ChatMessage, InputMode, MessageError } from "./types";
import { getEventBus } from "./event-bus";

export function generateId(prefix = "msg"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface ConversationEngineOptions {
  conversationId: string;
  agentId: string;
}

export class ConversationEngine {
  private conversationId: string;
  private agentId: string;
  private bus = getEventBus();
  private messages: ChatMessage[] = [];

  constructor(options: ConversationEngineOptions) {
    this.conversationId = options.conversationId;
    this.agentId = options.agentId;
    this.bus.emit({ type: "conversation.created", conversationId: this.conversationId });
  }

  getConversationId(): string {
    return this.conversationId;
  }

  getAgentId(): string {
    return this.agentId;
  }

  getMessages(): readonly ChatMessage[] {
    return this.messages;
  }

  /** Create a canonical user message. */
  createUserMessage(content: string, inputMode: InputMode = "text"): ChatMessage {
    const now = Date.now();
    const message: ChatMessage = {
      id: generateId("user"),
      conversationId: this.conversationId,
      role: "user",
      content,
      status: "complete",
      inputMode,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    };
    this.messages = [...this.messages, message];
    this.bus.emit({ type: "message.user.created", message });
    return message;
  }

  /** Start a canonical assistant message (status: streaming). */
  startAssistantMessage(inputMode: InputMode = "text", parentMessageId?: string): ChatMessage {
    const now = Date.now();
    const message: ChatMessage = {
      id: generateId("asst"),
      conversationId: this.conversationId,
      role: "assistant",
      content: "",
      status: "streaming",
      inputMode,
      parentMessageId,
      createdAt: now,
      updatedAt: now,
    };
    this.messages = [...this.messages, message];
    this.bus.emit({ type: "message.assistant.started", message });
    return message;
  }

  /** Append a text delta to an existing streaming assistant message. */
  appendDelta(messageId: string, delta: string): void {
    this.messages = this.messages.map((m) => {
      if (m.id !== messageId) return m;
      const updated = { ...m, content: m.content + delta, updatedAt: Date.now() };
      return updated;
    });
    this.bus.emit({ type: "message.assistant.delta", messageId, delta });
  }

  /** Finalize an assistant message (status: complete). */
  completeAssistantMessage(messageId: string, finalContent?: string): ChatMessage | null {
    const now = Date.now();
    let completed: ChatMessage | null = null;
    this.messages = this.messages.map((m) => {
      if (m.id !== messageId) return m;
      completed = {
        ...m,
        content: finalContent ?? m.content,
        status: "complete" as const,
        updatedAt: now,
        completedAt: now,
      };
      return completed;
    });
    if (completed) {
      this.bus.emit({ type: "message.assistant.completed", message: completed });
    }
    return completed;
  }

  /** Mark a message as failed. */
  failMessage(messageId: string, error: MessageError): void {
    this.messages = this.messages.map((m) => {
      if (m.id !== messageId) return m;
      const failed = { ...m, status: "failed" as const, error, updatedAt: Date.now() };
      this.bus.emit({ type: "message.failed", messageId, error });
      return failed;
    });
  }

  /** Link a Canvas block to a message. */
  linkCanvasBlock(messageId: string, canvasBlockId: string): void {
    this.messages = this.messages.map((m) =>
      m.id === messageId ? { ...m, canvasBlockId } : m,
    );
  }

  /** Clear all messages (for /clear or /new). */
  clear(): void {
    this.messages = [];
  }

  /** Replace messages (for regeneration or restore from persistence). */
  setMessages(messages: ChatMessage[]): void {
    this.messages = messages;
  }

  /** Get the message history formatted for LLM API calls. */
  getHistoryForApi(): Array<{ role: "user" | "assistant"; content: string }> {
    return this.messages
      .filter((m) => m.status === "complete" || m.status === "streaming")
      .map((m) => ({
        role: m.role === "system" ? "user" as const : m.role,
        content: m.content,
      }));
  }
}
