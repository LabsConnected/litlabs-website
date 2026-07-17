"use client";

import { BuilderBlock, ChatMessageBlock } from "@/app/studio/lib/builder-blocks";
import styles from "./ChatShell.module.css";

interface BuilderStreamProps {
  blocks: BuilderBlock[];
  isSpeaking?: boolean;
  onSpeak?: (text: string) => void;
  stopSpeaking?: () => void;
}

function timeLabel(value?: string | number | Date) {
  if (!value) return "Now";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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

export default function BuilderStream({
  blocks,
  isSpeaking,
  onSpeak,
  stopSpeaking,
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
          case "thinking":
            return <ThinkingBlockView key={block.id} content={block.content} />;
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
