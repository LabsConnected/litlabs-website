"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, Bot, Code2, Image as ImageIcon, Sparkles } from "lucide-react";
import type { StudioTool } from "./LITTTerminalShell";
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
  onSend: (text: string) => string | Promise<string | void>;
  onToolSelect?: (tool: StudioTool) => void;
  embedded?: boolean;
  hideDock?: boolean;
  builderMode?: boolean;
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
  onToolSelect,
  embedded = false,
  hideDock = false,
  builderMode = false,
}: Props) {
  const [draft, setDraft] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const {
    voiceState,
    state,
    startVoice,
    stopVoice,
    speakText,
    stopSpeaking,
    setOnTurn,
  } = useVoiceSession();
  const voiceLabel =
    voiceState === "speaking"
      ? "Speaking"
      : voiceState === "listening" || voiceState === "speech_detected"
        ? "Listening"
        : voiceState === "transcribing"
          ? "Transcribing"
          : voiceState === "sending" || voiceState === "thinking"
            ? "Thinking"
            : voiceState === "error"
              ? "Voice error"
              : "Voice ready";
  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role !== "system"),
    [messages],
  );
  const voiceActive =
    voiceState !== "idle" &&
    voiceState !== "error" &&
    voiceState !== "complete";

  useEffect(() => {
    setOnTurn(async (text) => {
      const reply = await onSend(text);
      if (typeof reply === "string") speakText(reply);
    });
    return () => setOnTurn(() => {});
  }, [onSend, setOnTurn, speakText]);

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
        {visibleMessages.length === 0 && !sending && (
          <div className={styles.home}>
            <div className={styles.heroMark} aria-hidden="true">
              <Sparkles size={22} />
            </div>
            <p className={styles.eyebrow}>LiTT is ready</p>
            <h1>What do you want to create?</h1>
            <p className={styles.intro}>
              Start with an idea. Your AI crew will help you make it real.
            </p>

            <div className={styles.createGrid}>
              <button onClick={() => builderMode ? setDraft("/image create an image of ") : onToolSelect?.("image")}>
                <span className={styles.actionIcon}><ImageIcon size={21} /></span>
                <span><b>Create an image</b><small>Generate art, ads, and product visuals</small></span>
                <ArrowRight size={17} aria-hidden="true" />
              </button>
              <button onClick={() => builderMode ? setDraft("/build ") : onToolSelect?.("builder")}>
                <span className={styles.actionIcon}><Code2 size={21} /></span>
                <span><b>Build an app</b><small>Turn a plain-English idea into working code</small></span>
                <ArrowRight size={17} aria-hidden="true" />
              </button>
              <button onClick={() => builderMode ? setDraft("/agent ") : onToolSelect?.("agents")}>
                <span className={styles.actionIcon}><Bot size={21} /></span>
                <span><b>Launch an agent</b><small>Delegate research, coding, and repeat work</small></span>
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>

            <div className={styles.homeGrid}>
              <section className={styles.homePanel}>
                <div className={styles.panelHeading}>
                  <span>Recent projects</span>
                  <button className={styles.viewAll} onClick={() => onToolSelect?.("builder")}>View all</button>
                </div>
                <button className={styles.projectRow} onClick={() => onToolSelect?.("builder")}>
                  <span className={styles.projectBadge}>LL</span>
                  <span><b>LiTTree Lab Studios</b><small>Updated today</small></span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </section>

              <section className={styles.homePanel}>
                <div className={styles.panelHeading}><span>Your AI crew</span><i>Online</i></div>
                <div className={styles.agentRow}>
                  <span className={styles.agentAvatar}>Li</span>
                  <span><b>LiTT</b><small>Director · ready to help</small></span>
                  <span className={styles.statusDot} aria-label="Online" />
                </div>
              </section>
            </div>

            <button className={styles.askButton} onClick={() => setDraft("Help me create ")}>
              <Sparkles size={15} aria-hidden="true" /> Ask LiTT anything
            </button>
          </div>
        )}
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

      {!hideDock && (
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
              aria-label={
                voiceActive ? "Stop voice input" : "Start voice input"
              }
              title={voiceActive ? "Stop voice" : "Voice input"}
              onClick={voiceActive ? stopVoice : startVoice}
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
      )}
    </main>
  );
}

export default ChatShell;
