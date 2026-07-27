/**
 * CanvasEngine — manages the Conversation Canvas.
 *
 * The Conversation Canvas has two areas:
 * - Live Transcript: linked transcript_turn blocks mirroring chat messages
 * - Work Surface: plans, tasks, decisions, code, images, etc.
 *
 * Each transcript block links to a canonical chat message via messageId.
 * Streaming updates a single block (not one block per delta).
 *
 * @see src/lib/litt/types.ts for CanvasBlock
 */

import type { CanvasBlock, ChatMessage, InputMode, BlockStatus, CanvasBlockType } from "../types";
import { getEventBus } from "../event-bus";
import { generateId } from "../conversation-engine";

export type ConversationCanvasMode = "off" | "final_turns" | "live_stream";

export interface CanvasEngineOptions {
  canvasId: string;
  mode?: ConversationCanvasMode;
}

export class CanvasEngine {
  private canvasId: string;
  private mode: ConversationCanvasMode;
  private bus = getEventBus();
  private blocks: CanvasBlock[] = [];

  constructor(options: CanvasEngineOptions) {
    this.canvasId = options.canvasId;
    this.mode = options.mode ?? "live_stream";
  }

  getCanvasId(): string {
    return this.canvasId;
  }

  getMode(): ConversationCanvasMode {
    return this.mode;
  }

  setMode(mode: ConversationCanvasMode): void {
    this.mode = mode;
  }

  getBlocks(): readonly CanvasBlock[] {
    return this.blocks;
  }

  getTranscriptBlocks(): readonly CanvasBlock[] {
    return this.blocks.filter((b) => b.type === "transcript_turn");
  }

  getWorkBlocks(): readonly CanvasBlock[] {
    return this.blocks.filter((b) => b.type !== "transcript_turn");
  }

  /** Create a transcript block linked to a chat message. */
  createTranscriptBlock(
    message: ChatMessage,
  ): CanvasBlock {
    const now = Date.now();
    const block: CanvasBlock = {
      id: generateId("block"),
      canvasId: this.canvasId,
      type: "transcript_turn",
      messageId: message.id,
      speaker: message.role === "user" ? "user" : "litt",
      content: message.content,
      status: message.status === "complete" ? "complete" : "streaming",
      inputMode: message.inputMode,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.blocks = [...this.blocks, block];
    this.bus.emit({ type: "canvas.block.created", block });
    return block;
  }

  /** Update a block's content (streaming delta accumulation). */
  updateBlockContent(blockId: string, content: string): void {
    this.blocks = this.blocks.map((b) => {
      if (b.id !== blockId) return b;
      const updated = { ...b, content, updatedAt: Date.now() };
      this.bus.emit({ type: "canvas.block.updated", blockId, patch: { content } });
      return updated;
    });
  }

  /** Finalize a block (status: complete). */
  finalizeBlock(blockId: string): void {
    this.blocks = this.blocks.map((b) => {
      if (b.id !== blockId) return b;
      const finalized = { ...b, status: "complete" as BlockStatus, updatedAt: Date.now() };
      return finalized;
    });
    this.bus.emit({ type: "canvas.block.finalized", blockId });
  }

  /** Find a transcript block by its linked message ID. */
  findBlockByMessageId(messageId: string): CanvasBlock | null {
    return this.blocks.find((b) => b.messageId === messageId) ?? null;
  }

  /** Create a work block (plan, task, code, image, etc.). */
  createWorkBlock(
    type: CanvasBlockType,
    content: string,
    metadata?: Record<string, unknown>,
  ): CanvasBlock {
    const now = Date.now();
    const block: CanvasBlock = {
      id: generateId("block"),
      canvasId: this.canvasId,
      type,
      content,
      status: "complete",
      revision: 1,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.blocks = [...this.blocks, block];
    this.bus.emit({ type: "canvas.block.created", block });
    return block;
  }

  /** Clear all blocks. */
  clear(): void {
    this.blocks = [];
  }

  /** Restore blocks from persistence. */
  setBlocks(blocks: CanvasBlock[]): void {
    this.blocks = blocks;
  }
}
