/**
 * Slash-command result rendering.
 *
 * Shell-backed slash commands (/run, /status, …) stream their output
 * through CommandExecutor events → SessionEventBridge → transcript.
 * Non-shell tools (android.*, dex.*) return a ToolResult with no
 * streamed events — without this, `/devices` executes correctly but
 * the result is never rendered: the input clears and nothing appears.
 *
 * This helper renders non-shell results into the transcript and the
 * activity feed. Shell tools are untouched — they render via streams.
 */

import type { ToolResult } from "@litt/agent-core";

export interface SlashRenderStore {
  addChatMessage(msg: {
    role: "assistant";
    content: string;
    ts: number;
    status: "complete" | "error";
    servedModel: string;
  }): void;
  addActivity(ev: {
    id: string;
    ts: number;
    type: "info" | "error";
    tag: string;
    text: string;
    fullText?: string;
  }): void;
}

/**
 * Render a non-shell tool result for the user. Returns true when it
 * rendered (i.e. the tool produces no stream events). Callers must NOT
 * call this for project.run — its output already arrives via streams.
 */
export function renderSlashToolResult(
  store: SlashRenderStore,
  toolId: string,
  result: ToolResult,
): boolean {
  if (toolId === "project.run") return false;
  const content = result.message?.trim()
    ? result.message
    : result.success
      ? `${toolId} completed.`
      : `${toolId} failed without a message.`;
  store.addChatMessage({
    role: "assistant",
    content,
    ts: Date.now(),
    status: result.success ? "complete" : "error",
    servedModel: "system",
  });
  store.addActivity({
    id: `act_${Date.now()}_slash`,
    ts: Date.now(),
    type: result.success ? "info" : "error",
    tag: "DEVICE",
    text: content.length > 80 ? content.slice(0, 77) + "…" : content,
    fullText: content,
  });
  return true;
}
