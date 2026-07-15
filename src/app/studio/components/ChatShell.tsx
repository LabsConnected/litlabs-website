"use client";

import { FormEvent, useMemo, useState } from "react";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import styles from "./ChatShell.module.css";

export type StudioMessage = {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string | number | Date;
};

type Props = {
  messages: StudioMessage[];
  sending?: boolean;
  systemLines?: string[];
  onSend: (text: string) => void | Promise<void>;
  embedded?: boolean;
};

const actions = ["/scan", "/status", "/image", "/code", "/agent", "/voice"];

function timeLabel(value?: string | number | Date) {
  if (!value) return "Now";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ChatShell({
  messages,
  sending = false,
  systemLines = [],
  onSend,
  embedded = false,
}: Props) {
  const [draft, setDraft] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const { state, speakText, stopSpeaking } = useVoiceSession();
  const voiceLabel =
    state === "speaking"
      ? "Speaking"
      : state === "loading"
        ? "Preparing voice"
        : "Voice ready";
  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role !== "system"),
    [messages],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    await onSend(text);
  }

  return (
    <main
      className={embedded ? `${styles.shell} ${styles.embedded}` : styles.shell}
    >
      {!embedded && (
        <header className={styles.header}>
          <div className={styles.brand}>
            <span className={styles.prompt}>›_</span>
            <b>LiTT Studio</b>
          </div>
          <span className={styles.online}>
            <i /> 2 agents online
          </span>
          <button
            className={styles.iconButton}
            aria-label="Open menu"
            title="Menu"
          >
            ☰
          </button>
        </header>
      )}

      {systemLines.length > 0 && (
        <section className={styles.activity}>
          <button
            onClick={() => setActivityOpen((v) => !v)}
            aria-expanded={activityOpen}
            aria-label="Toggle system events"
          >
            <span>
              <i /> Systems nominal
            </span>
            <small>
              {systemLines.length} events {activityOpen ? "⌃" : "⌄"}
            </small>
          </button>
          {activityOpen && <pre>{systemLines.join("\n")}</pre>}
        </section>
      )}

      <section className={styles.messages} aria-live="polite">
        {visibleMessages.map((message, index) => (
          <article
            key={message.id ?? index}
            className={`${styles.message} ${styles[message.role]}`}
          >
            {message.role === "assistant" && (
              <div className={styles.avatar}>⌁</div>
            )}
            <div className={styles.bubble}>
              <div className={styles.copy}>{message.content}</div>
              <time>{timeLabel(message.createdAt)}</time>
              {message.role === "assistant" && (
                <div className={styles.messageActions}>
                  <button
                    onClick={() =>
                      state === "speaking"
                        ? stopSpeaking()
                        : speakText(message.content)
                    }
                    aria-label={
                      state === "speaking"
                        ? "Stop speaking"
                        : "Speak this message"
                    }
                    aria-pressed={state === "speaking"}
                  >
                    {state === "speaking" ? "■ Stop" : "◖ Speak"}
                  </button>
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(message.content)
                    }
                    aria-label="Copy message to clipboard"
                  >
                    ▣ Copy
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
        {sending && (
          <div className={styles.thinking}>
            <i />
            <i />
            <i /> LiTT is working
          </div>
        )}
      </section>

      <footer className={styles.dock}>
        <div className={styles.quickActions} aria-label="Quick commands">
          {actions.map((action) => (
            <button key={action} onClick={() => setDraft(`${action} `)}>
              {action}
            </button>
          ))}
        </div>
        <div className={styles.voiceStatus} role="status" aria-live="polite">
          <i /> {voiceLabel} · clean speech
        </div>
        <form className={styles.composer} onSubmit={submit}>
          <button type="button" aria-label="Attach file" title="Attach file">
            ⌕
          </button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask LiTT to build, fix, or create…"
            rows={1}
          />
          <button
            type="button"
            className={styles.mic}
            aria-label="Start voice input"
            title="Voice input"
          >
            🎙
          </button>
          <button
            className={styles.send}
            disabled={!draft.trim() || sending}
            aria-label="Send message"
            title="Send"
          >
            ➤
          </button>
        </form>
      </footer>
    </main>
  );
}

export default ChatShell;
