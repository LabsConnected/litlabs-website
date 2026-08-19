/**
 * ChatTranscript — the canonical assistant/user conversation renderer.
 *
 * This is the ONE place where the assistant response body is rendered.
 * The activity feed is a truncated operator log; this is the full,
 * persisted, multi-line conversation.
 *
 * Rendering rules:
 *   - User messages: dim, single-line, prefixed with ❯.
 *   - Assistant messages (complete): brand color, multi-line, prefixed
 *     with ⚡. The full content is rendered (not truncated).
 *   - Assistant messages (streaming): brand color with a trailing cursor
 *     so the user sees live text arriving.
 *   - Assistant messages (error): error color, prefixed with ✗. The
 *     error text is rendered in full — never blank.
 *   - Routing trace: when present, a dim one-line footer under the
 *     assistant message showing REQUESTED → RESOLVED → SERVED and the
 *     fallback reason if any. This makes the routing sequence traceable.
 *
 * Safety:
 *   - Ink's <Text> renders string content as-is (no HTML injection risk
 *     in a terminal). Markdown is rendered as plain text — fenced code
 *     blocks are preserved as-is. No raw model protocol (tool_call json)
 *     reaches here; the controller filters it before persisting.
 *   - Content is bounded by the store (last 50 messages); individual
 *     message bodies are bounded by the agent loop's max_tokens.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./colors.js";
import type { ChatMessage } from "./cockpit-store.js";

/** Truncate a model label for the routing trace footer. */
function traceLabel(label: string | null | undefined, max = 24): string {
  if (!label) return "—";
  return label.length <= max ? label : label.slice(0, max - 1) + "…";
}

function AssistantMessage({ msg }: { msg: ChatMessage }): React.ReactElement {
  const isStreaming = msg.status === "streaming";
  const isError = msg.status === "error";
  const color = isError ? COLORS.error : COLORS.brand;
  const prefix = isError ? "✗" : "⚡";

  // Render the body as separate lines so multi-line content displays
  // correctly in the terminal (Ink <Text> wraps on \n).
  const lines = msg.content.split("\n");

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Box key={i}>
          {i === 0 ? (
            <Text color={color} bold> {prefix} </Text>
          ) : (
            <Text>   </Text>
          )}
          <Text color={color} dimColor={isError}>
            {line}
            {isStreaming && i === lines.length - 1 ? "▋" : ""}
          </Text>
        </Box>
      ))}

      {/* Routing trace footer — only when trace info is present */}
      {(msg.requestedModel || msg.resolvedModel || msg.servedModel) && (
        <Box>
          <Text dimColor>     </Text>
          <Text dimColor>
            REQUESTED {traceLabel(msg.requestedModel)} → RESOLVED {traceLabel(msg.resolvedModel)} → SERVED {traceLabel(msg.servedModel)}
          </Text>
        </Box>
      )}
      {msg.fallbackReason && (
        <Box>
          <Text dimColor>     </Text>
          <Text dimColor color={COLORS.warning}>
            FALLBACK {msg.fallbackReason}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function UserMessage({ msg }: { msg: ChatMessage }): React.ReactElement {
  // User messages are single-line; collapse newlines for the prompt echo.
  const single = msg.content.replace(/\n/g, " ").trim();
  return (
    <Box>
      <Text dimColor bold> ❯ </Text>
      <Text dimColor>{single}</Text>
    </Box>
  );
}

/**
 * Single chat message — unbordered, for embedding in any surface
 * (the minimal shell transcript, the bordered CHAT panel, overlays).
 */
export function ChatMessageView({ msg }: { msg: ChatMessage }): React.ReactElement {
  return (
    <Box flexDirection="column">
      {msg.role === "user"
        ? <UserMessage msg={msg} />
        : <AssistantMessage msg={msg} />}
    </Box>
  );
}

export interface ChatTranscriptProps {
  messages: ChatMessage[];
  /** Max messages to render (most recent). Default 6. */
  maxMessages?: number;
}

export function ChatTranscript({ messages, maxMessages = 6 }: ChatTranscriptProps): React.ReactElement | null {
  const visible = messages.slice(-maxMessages);

  if (visible.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={COLORS.brand} paddingX={1}>
      <Text bold color={COLORS.brand}>CHAT</Text>
      {visible.map((msg) => (
        <Box key={msg.id} flexDirection="column">
          <ChatMessageView msg={msg} />
        </Box>
      ))}
    </Box>
  );
}
