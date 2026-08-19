/**
 * ChatTranscript — the canonical assistant/user conversation renderer.
 *
 * The conversation is the visual hero. Everything else (activity feed,
 * status bar) is subordinate to this. Structure per turn:
 *
 * ```
 *   You
 *   What's slowing down my PC?
 *
 *   LiTT
 *   I'm checking the processes using the most CPU and memory.
 *   GPT-5.6 Luna · 9.0s
 * ```
 *
 * Rendering rules:
 *   - Speaker labels ("You" / "LiTT") are bold but small; "LiTT" is the
 *     one permitted brand accent per message (the identity mark).
 *   - User text: bright warm white. Assistant body: near-white.
 *   - Assistant body is word-wrapped to the content measure (never the
 *     full terminal width on wide screens).
 *   - Streaming: a steady trailing cursor so the user sees live text.
 *   - Errors: red body, never blank.
 *   - Routing is COLLAPSED to `Model · seconds` (dim, one line). The
 *     full REQUESTED → RESOLVED → SERVED chain lives in /status and
 *     /route diagnostics — never in the conversation.
 *   - Mission IDs, run IDs, and raw protocol never render here.
 *
 * Safety:
 *   - Ink's <Text> renders string content as-is (no HTML injection risk
 *     in a terminal). Markdown renders as plain text — fenced code
 *     blocks are preserved. No raw model protocol (tool_call json)
 *     reaches here; the controller filters it before persisting.
 *   - Content is bounded by the store (last 50 messages); individual
 *     bodies are bounded by the agent loop's max_tokens.
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { COLORS } from "./colors.js";
import { wrapText, shortModelName, singleLine, CONTENT_MEASURE } from "./text-wrap.js";
import { markdownLine, type MarkdownSegment } from "../lib/markdown.js";
import type { ChatMessage } from "./cockpit-store.js";

export { CONTENT_MEASURE };

/**
 * Collapsed routing footer — the ONLY routing surface in conversation:
 *   "GPT-5.6 Luna · 9.0s"   (complete)
 *   "GPT-5.6 Luna"          (streaming / no duration yet)
 *   null                    (error turns — the error text is the message)
 * Truth order: served → resolved → requested (the runtime's actual model
 * wins; the policy label is the last resort).
 */
export function routingFooter(msg: ChatMessage): string | null {
  if (msg.status === "error") return null;
  const model = msg.servedModel ?? msg.resolvedModel ?? msg.requestedModel ?? null;
  if (!model) return null;
  const label = shortModelName(model);
  if (msg.durationMs == null) return label;
  return `${label} · ${(msg.durationMs / 1000).toFixed(1)}s`;
}

/**
 * Estimated rendered height of a message at a given content width.
 * Pure — used by the shell to fit messages into the fixed content
 * region (the composer never moves).
 */
export function estimateMessageHeight(msg: ChatMessage, width: number): number {
  if (msg.role === "user") {
    const lines = Math.max(1, wrapText(singleLine(msg.content), width).length);
    return 1 + lines; // label + body
  }
  const bodyLines = msg.content.length === 0 ? 0 : wrapText(msg.content, width).length;
  const label = 1;
  const footer = routingFooter(msg) ? 1 : 0;
  return label + bodyLines + footer;
}

function AssistantMessage({ msg, width }: { msg: ChatMessage; width: number }): React.ReactElement {
  const isStreaming = msg.status === "streaming";
  const isError = msg.status === "error";
  const bodyColor = isError ? COLORS.error : COLORS.text;
  const lines = msg.content.length === 0
    ? []
    : wrapText(msg.content, width);
  const footer = routingFooter(msg);

  // Render the body as styled markdown segments per line (code-fence
  // state threaded across lines). Errors render plain (never styled —
  // the error text is the message).
  const rendered = useMemo(() => {
    if (isError) return null;
    let inCode = false;
    return lines.map((line, i) => {
      const res = markdownLine(line, inCode);
      inCode = res.inCode;
      return (
        <Text key={i} color={bodyColor}>
          {res.segments.map((seg, j) => (
            <StyledSegment key={j} seg={seg} />
          ))}
          {isStreaming && i === lines.length - 1 ? "▋" : ""}
        </Text>
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.content, width, isStreaming, isError]);

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.brand}>LiTT</Text>
      {isError || rendered === null ? (
        lines.length === 0 ? (
          <Text color={bodyColor} dimColor={!isError}>…</Text>
        ) : (
          lines.map((line, i) => (
            <Text key={i} color={bodyColor}>
              {line}
              {isStreaming && i === lines.length - 1 ? "▋" : ""}
            </Text>
          ))
        )
      ) : (
        rendered
      )}
      {footer && (
        <Text dimColor>{footer}</Text>
      )}
    </Box>
  );
}

function StyledSegment({ seg }: { seg: MarkdownSegment }): React.ReactElement {
  if (seg.bold) {
    return <Text bold>{seg.text}</Text>;
  }
  if (seg.dim) {
    return <Text dimColor>{seg.text}</Text>;
  }
  return <Text>{seg.text}</Text>;
}

function UserMessage({ msg, width }: { msg: ChatMessage; width: number }): React.ReactElement {
  // User messages echo single-line (collapse newlines), wrapped to the
  // same measure as assistant content.
  const single = singleLine(msg.content);
  const lines = wrapText(single, width);
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.secondary}>You</Text>
      {lines.map((line, i) => (
        <Text key={i} color={COLORS.textBright}>{line}</Text>
      ))}
    </Box>
  );
}

export interface ChatMessageViewProps {
  msg: ChatMessage;
  /** Content width (defaults to the reading measure). */
  width?: number;
}

/**
 * Single chat message — unbordered, for embedding in any surface.
 */
export function ChatMessageView({ msg, width = CONTENT_MEASURE }: ChatMessageViewProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {msg.role === "user"
        ? <UserMessage msg={msg} width={width} />
        : <AssistantMessage msg={msg} width={width} />}
    </Box>
  );
}

export interface ChatTranscriptProps {
  messages: ChatMessage[];
  /** Max messages to render (most recent). Default 6. */
  maxMessages?: number;
}

/** Legacy bordered panel — kept for backward compatibility. */
export function ChatTranscript({ messages, maxMessages = 6 }: ChatTranscriptProps): React.ReactElement | null {
  const visible = messages.slice(-maxMessages);

  if (visible.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.secondary} paddingX={1}>
      <Text bold color={COLORS.text}>CHAT</Text>
      {visible.map((msg) => (
        <Box key={msg.id} flexDirection="column">
          <ChatMessageView msg={msg} />
        </Box>
      ))}
    </Box>
  );
}
