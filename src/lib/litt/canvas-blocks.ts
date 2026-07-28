/**
 * Canvas transcript block helpers — create and update transcript_turn
 * blocks linked to canonical messages.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

function admin(): SupabaseClient {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase admin client is not configured");
  return client;
}

function genId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export interface TranscriptBlockInput {
  canvasId: string;
  userId: string;
  messageId: string;
  speaker: "user" | "litt" | "spark";
  content: string;
  status: "streaming" | "complete" | "failed";
}

export interface TranscriptBlockResult {
  id: string;
  canvasId: string;
  messageId: string;
  speaker: string;
  content: string;
  status: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create a transcript_turn block linked to a canonical message.
 * The block content stores { speaker, text, status, messageId }.
 */
export async function createTranscriptBlock(
  input: TranscriptBlockInput,
): Promise<TranscriptBlockResult> {
  const sb = admin();
  const blockId = genId();
  const timestamp = now();

  // Get current max position
  const { data: existing } = await sb
    .from("canvas_blocks")
    .select("position")
    .eq("canvas_id", input.canvasId)
    .order("position", { ascending: false })
    .limit(1);

  let position = 0;
  if (existing && existing.length > 0) {
    position = (existing[0] as { position: number }).position + 1;
  }

  const content = {
    speaker: input.speaker,
    text: input.content,
    status: input.status,
    messageId: input.messageId,
  };

  const { error } = await sb.from("canvas_blocks").insert({
    id: blockId,
    canvas_id: input.canvasId,
    user_id: input.userId,
    type: "transcript_turn",
    content,
    position,
    message_id: input.messageId,
    metadata: { speaker: input.speaker },
    created_at: timestamp,
    updated_at: timestamp,
  });

  if (error) throw new Error(`Failed to create transcript block: ${error.message}`);

  return {
    id: blockId,
    canvasId: input.canvasId,
    messageId: input.messageId,
    speaker: input.speaker,
    content: input.content,
    status: input.status,
    position,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Update a transcript block's content and status.
 */
export async function updateTranscriptBlock(
  blockId: string,
  canvasId: string,
  updates: { content?: string; status?: "streaming" | "complete" | "failed" },
): Promise<void> {
  const sb = admin();

  // Fetch previous content
  const { data: prev, error: prevErr } = await sb
    .from("canvas_blocks")
    .select("content")
    .eq("id", blockId)
    .eq("canvas_id", canvasId)
    .single();

  if (prevErr || !prev) return;
  const prevContent = prev.content as Record<string, unknown>;

  const newContent = { ...prevContent };
  if (updates.content !== undefined) newContent.text = updates.content;
  if (updates.status !== undefined) newContent.status = updates.status;

  const { error } = await sb
    .from("canvas_blocks")
    .update({ content: newContent, updated_at: now() })
    .eq("id", blockId)
    .eq("canvas_id", canvasId);

  if (error) throw new Error(`Failed to update transcript block: ${error.message}`);
}

/**
 * Get or create a canvas for a conversation.
 */
export async function getOrCreateCanvas(
  userId: string,
  conversationId: string,
  projectId?: string | null,
): Promise<string> {
  const sb = admin();

  // Try to find an existing active canvas for this conversation
  const { data: existing } = await sb
    .from("canvases")
    .select("id")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return (existing as { id: string }).id;

  // Create a new canvas
  const canvasId = genId();
  const timestamp = now();
  const { error } = await sb.from("canvases").insert({
    id: canvasId,
    user_id: userId,
    project_id: projectId ?? null,
    mission_id: null,
    conversation_id: conversationId,
    title: "LiTT Conversation Canvas",
    type: "document",
    status: "active",
    version: 1,
    metadata: {},
    created_at: timestamp,
    updated_at: timestamp,
  });

  if (error) throw new Error(`Failed to create canvas: ${error.message}`);

  return canvasId;
}
