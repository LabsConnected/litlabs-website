/**
 * Utilities for copying and downloading conversation messages.
 *
 * These helpers operate on the original message content stored in the
 * conversation store — they never reconstruct text from the rendered DOM.
 */

import type { ChatMessage } from "@/app/studio/stores/useStudioAgentStore";

/**
 * Convert markdown to plain text by stripping formatting syntax without
 * changing the words. Preserves code content inside fenced blocks.
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    // Extract code blocks first and preserve their content verbatim
    .replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code: string) => `\n${code.trim()}\n`)
    // Inline code — remove backticks
    .replace(/`([^`]+)`/g, "$1")
    // Images — replace with alt text or remove
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // Links — keep link text, remove URL
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Headings — remove leading # marks
    .replace(/^#{1,6}\s+/gm, "")
    // Bold/italic — remove * and _ markers
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // Strikethrough
    .replace(/~~([^~]+)~~/g, "$1")
    // Blockquotes — remove leading >
    .replace(/^>\s?/gm, "")
    // Horizontal rules — replace with dashes
    .replace(/^---+$/gm, "—")
    // Unordered list markers — keep text, remove markers
    .replace(/^[\s]*[-*+]\s+/gm, "• ")
    // Ordered list markers — keep numbers
    .replace(/^[\s]*(\d+)\.\s+/gm, "$1. ")
    // Remove extra blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract code block content from a markdown string.
 * Returns the raw code inside the first fenced block, or null if none.
 */
export function extractCodeBlock(markdown: string, blockIndex = 0): string | null {
  const blocks: string[] = [];
  const regex = /```[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks[blockIndex] ?? null;
}

/**
 * Build a full conversation transcript as plain text for download.
 */
export function conversationToPlainText(messages: ChatMessage[], agentName = "LiTT"): string {
  const lines: string[] = [`Conversation exported ${new Date().toISOString()}`, ""];
  for (const msg of messages) {
    if (!msg.content?.trim()) continue;
    const speaker = msg.role === "user" ? "You" : agentName;
    const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : "";
    lines.push(`[${time}] ${speaker}:`);
    lines.push(markdownToPlainText(msg.content));
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Build a full conversation transcript as Markdown for download.
 */
export function conversationToMarkdown(messages: ChatMessage[], agentName = "LiTT"): string {
  const lines: string[] = [`# Conversation Export`, `> Exported ${new Date().toISOString()}`, ""];
  for (const msg of messages) {
    if (!msg.content?.trim()) continue;
    const speaker = msg.role === "user" ? "**You**" : `**${agentName}**`;
    const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : "";
    lines.push(`### ${speaker} _${time}_`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Trigger a browser download of a text blob.
 */
export function downloadTextFile(filename: string, content: string, mimeType = "text/plain"): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Copy text to the clipboard. Falls back to a textarea + execCommand for
 * environments where navigator.clipboard is unavailable (e.g. non-HTTPS).
 * Returns true on success, false on failure.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to fallback
    }
  }
  // Fallback for non-secure contexts
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
