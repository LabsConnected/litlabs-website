"use client";

import {
  BuilderBlock,
  ChatMessageBlock,
  TerminalBlock,
} from "@/app/studio/lib/builder-blocks";
import styles from "./ChatShell.module.css";

interface BuilderStreamProps {
  blocks: BuilderBlock[];
  isSpeaking?: boolean;
  onSpeak?: (text: string) => void;
  stopSpeaking?: () => void;
  onExpandTerminal?: () => void;
}

function timeLabel(value?: string | number | Date) {
  if (!value) return "Now";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function TerminalBlockView({
  block,
  onExpand,
}: {
  block: TerminalBlock;
  onExpand?: () => void;
}) {
  const startedBy = block.startedBy === "user" ? "You" : "LiTT";
  const statusColor =
    block.status === "success"
      ? "#22c55e"
      : block.status === "failed"
        ? "#ef4444"
        : block.status === "running"
          ? "#22d3ee"
          : block.status === "queued"
            ? "#fbbf24"
            : "#64748b";
  const outputPreview = block.output
    ? block.output.length > 220
      ? block.output.slice(0, 220) + "…"
      : block.output
    : "";
  return (
    <div className={styles.message}>
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "6px",
            fontSize: "11px",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#9aa6b8",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: statusColor,
              boxShadow: `0 0 8px ${statusColor}`,
            }}
          />
          Terminal · {startedBy} · {block.status}
        </div>
        <div
          style={{
            fontFamily: 'ui-monospace, "Cascadia Code", "JetBrains Mono", monospace',
            fontSize: "13px",
            padding: "6px 8px",
            borderRadius: "8px",
            backgroundColor: "#0a0a0f",
            border: "1px solid #1f2937",
            color: "#e6e6f0",
            marginBottom: "8px",
          }}
        >
          <span style={{ color: "#64748b", userSelect: "none" }}>$ </span>
          {block.command}
        </div>
        {outputPreview && (
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontFamily: 'ui-monospace, "Cascadia Code", "JetBrains Mono", monospace',
              fontSize: "11px",
              color: "#9cb6b2",
              maxHeight: "96px",
              overflow: "auto",
              lineHeight: 1.4,
            }}
          >
            {outputPreview}
          </pre>
        )}
        <div className={styles.messageActions}>
          <button onClick={onExpand}>Expand Terminal</button>
        </div>
      </div>
    </div>
  );
}

function ChatMessageBlockView({
  block,
  isSpeaking,
  onSpeak,
  stopSpeaking,
}: {
  block: ChatMessageBlock;
  isSpeaking?: boolean;
  onSpeak?: (text: string) => void;
  stopSpeaking?: () => void;
}) {
  const role = block.role === "user" ? "user" : "assistant";
  return (
    <article className={`${styles.message} ${styles[role]}`}>
      {role === "assistant" && <div className={styles.avatar}>⌁</div>}
      <div className={styles.bubble}>
        <div className={styles.copy}>{block.content}</div>
        <time>{timeLabel(block.createdAt)}</time>
        {role === "assistant" && (
          <div className={styles.messageActions}>
            <button
              onClick={() =>
                isSpeaking ? stopSpeaking?.() : onSpeak?.(block.content)
              }
              aria-label={isSpeaking ? "Stop speaking" : "Speak this message"}
              aria-pressed={isSpeaking}
            >
              {isSpeaking ? "■ Stop" : "◖ Speak"}
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(block.content)}
              aria-label="Copy message to clipboard"
            >
              ▣ Copy
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function ThinkingBlockView({ content }: { content?: string }) {
  return (
    <div className={styles.thinking}>
      <i />
      <i />
      <i /> {content || "LiTT is working"}
    </div>
  );
}

function MediaBlockView({ block }: { block: Extract<BuilderBlock, { type: "image" | "video" | "audio" }> }) {
  return (
    <div className={styles.message}>
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "720px" }}>
        {block.type === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.url} alt={block.alt || "Generated image"} style={{ width: "100%", maxHeight: 520, objectFit: "contain", borderRadius: 12 }} />
        )}
        {block.type === "video" && <video src={block.url} controls style={{ width: "100%", borderRadius: 12 }} />}
        {block.type === "audio" && <audio src={block.url} controls style={{ width: "100%" }} />}
        <div className={styles.messageActions}>
          <a href={block.url} download>Download</a>
          {block.type === "image" && <button onClick={() => navigator.clipboard.writeText(block.prompt || block.alt || "")}>Reuse prompt</button>}
        </div>
      </div>
    </div>
  );
}

export default function BuilderStream({
  blocks,
  isSpeaking,
  onSpeak,
  stopSpeaking,
  onExpandTerminal,
}: BuilderStreamProps) {
  return (
    <>
      {blocks.map((block) => {
        switch (block.type) {
          case "chat-message":
            return (
              <ChatMessageBlockView
                key={block.id}
                block={block}
                isSpeaking={isSpeaking}
                onSpeak={onSpeak}
                stopSpeaking={stopSpeaking}
              />
            );
          case "terminal":
            return (
              <TerminalBlockView
                key={block.id}
                block={block}
                onExpand={onExpandTerminal}
              />
            );
          case "thinking":
            return <ThinkingBlockView key={block.id} content={block.content} />;
          case "image":
          case "video":
          case "audio":
            return <MediaBlockView key={block.id} block={block} />;
          default:
            // Unrecognized blocks are rendered as a compact placeholder.
            return (
              <div
                key={block.id}
                className={styles.message}
                style={{ opacity: 0.6 }}
              >
                <div className={styles.bubble}>
                  <div className={styles.copy}>
                    [{block.type}] block renderer not implemented yet
                  </div>
                </div>
              </div>
            );
        }
      })}
    </>
  );
}
