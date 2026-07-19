"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowUp, ArrowUpRight, Clapperboard, Image as ImageIcon, Mic, Sparkles } from "lucide-react";
import type { StudioTool } from "./LITTTerminalShell";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import { cn } from "@/lib/utils";
import {
  createChatMessageBlock,
  createThinkingBlock,
  createImageBlock,
  type BuilderBlock,
} from "@/app/studio/lib/builder-blocks";
import BuilderStream from "./BuilderStream";
import SessionSidebar from "./SessionSidebar";
import StudioHealthPanel from "./StudioHealthPanel";
import type { BuilderSession } from "../hooks/useBuilderSessions";
import styles from "./ChatShell.module.css";

export type StudioMessage = {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string | number | Date;
  type?: "text" | "image" | "video" | "audio" | "error";
  mediaUrl?: string;
  status?: string;
  provider?: string;
  aspectRatio?: string;
  generationTimeMs?: number;
};

type Props = {
  messages: StudioMessage[];
  sending?: boolean;
  systemLines?: string[];
  onSend: (text: string) => string | Promise<string | void>;
  onToolSelect?: (tool: StudioTool) => void;
  onOpenImageGen?: () => void;
  onPromptSelectAction?: (prompt: string) => void;
  embedded?: boolean;
  hideDock?: boolean;
  builderMode?: boolean;
  selectedModel?: string;
  busy?: boolean;
  onNewChat?: () => void;
  onRegenerate?: () => void;
  onRouteTool?: (tool: StudioTool, command?: string) => void;
  requestedTool?: StudioTool;
  pendingCommand?: string;
  initialPrompt?: string;
  sessions?: BuilderSession[];
  activeSessionId?: string;
  onSelectSession?: (id: string) => void;
  onNewSession?: () => void;
  onRenameSession?: (id: string, title: string) => void;
  onPinSession?: (id: string) => void;
  onDuplicateSession?: (session: BuilderSession) => void;
  onDeleteSession?: (id: string) => void;
  onDeleteAllSessions?: () => void;
  shellAction?: { id: number; type: "terminal" | "sessions" } | null;
};

const actions = ["/scan", "/status", "/image", "/code", "/agent", "/voice"];

export function ChatShell({
  messages,
  sending: sendingProp = false,
  busy: busyProp,
  systemLines = [],
  onSend,
  onToolSelect,
  onOpenImageGen,
  onPromptSelectAction,
  embedded = false,
  hideDock = false,
  builderMode = false,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onNewChat,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onRegenerate,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onPinSession,
  onDuplicateSession,
  onDeleteSession,
  onDeleteAllSessions,
  shellAction,
}: Props) {
  const sending = busyProp ?? sendingProp;
  const [draft, setDraft] = useState("");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [busySeconds, setBusySeconds] = useState(0);
  const {
    voiceState,
    state,
    cooldownRemaining,
    startVoice,
    stopVoice,
    speakText,
    stopSpeaking,
    setOnTurn,
  } = useVoiceSession();
  const voiceLabel =
    voiceState === "speaking"
      ? "Speaking"
      : voiceState === "listening"
        ? "Listening"
        : voiceState === "transcribing"
          ? "Transcribing"
          : voiceState === "thinking"
            ? "Thinking"
            : voiceState === "cooldown"
              ? "Voice temporarily unavailable"
              : voiceState === "error"
                ? "Voice error"
                : "Voice ready";
  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role !== "system"),
    [messages],
  );

  const blocks: BuilderBlock[] = useMemo(() => {
    const list: BuilderBlock[] = visibleMessages.map((m, index) => {
      const id = m.id ?? `msg-${index}`;
      // If the message has a mediaUrl and image type, render as ImageBlock
      if (m.mediaUrl && (m.type === "image" || m.type === "video")) {
        return createImageBlock(
          m.mediaUrl,
          {
            prompt: m.content,
            provider: m.provider,
            aspectRatio: m.aspectRatio,
            generationTimeMs: m.generationTimeMs,
            status: m.status === "pending" ? "generating" : m.status === "error" ? "failed" : "completed",
          },
          id,
        );
      }
      return createChatMessageBlock(
        m.role === "user" || m.role === "assistant" ? m.role : "assistant",
        m.content,
        m.createdAt,
        id,
      );
    });
    if (sending) {
      list.push(createThinkingBlock("LiTT is working"));
    }
    return list;
  }, [visibleMessages, sending]);

  const voiceActive =
    voiceState !== "idle";

  const micDisabled =
    voiceState === "transcribing" ||
    voiceState === "thinking" ||
    voiceState === "speaking";

  useEffect(() => {
    if (!sending) {
      setBusySeconds(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setBusySeconds(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [sending]);

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

  useEffect(() => {
    if (!shellAction) return;
    if (shellAction.type === "terminal") setSessionsOpen(false);
    if (shellAction.type === "sessions") setSessionsOpen(true);
  }, [shellAction]);

  return (
    <main
      className={embedded ? `${styles.shell} ${styles.embedded}` : styles.shell}
    >
      {sessions && (
        <SessionSidebar
          sessions={sessions}
          activeId={activeSessionId || ""}
          onSelect={onSelectSession || (() => {})}
          onNew={onNewSession || (() => {})}
          onRename={onRenameSession || (() => {})}
          onPin={onPinSession || (() => {})}
          onDuplicate={onDuplicateSession || (() => {})}
          onDelete={onDeleteSession || (() => {})}
          onDeleteAll={onDeleteAllSessions || (() => {})}
          open={sessionsOpen}
          onOpenChange={setSessionsOpen}
        />
      )}
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
            <section className={styles.creativeHero}>
              <div className={styles.creativeEngine} />
              <div className={styles.creativeGlow} />
              <div className={styles.creativeOverlay} />

              <div className={styles.creativeContent}>
                <div className={styles.creativeBadge}>
                  <span className={styles.creativeBadgeDot} />
                  LiTT creative engine
                </div>
                <h1 className={styles.creativeTitle}>
                  Make something
                  <span className={styles.creativeTitleGradient}>
                    impossible to ignore.
                  </span>
                </h1>
                <p className={styles.creativeDesc}>
                  Describe the shot once. Create the image, bring it to life,
                  and keep building with LiTT in the same conversation.
                </p>

                <div className={styles.creativeActions}>
                  <button
                    onClick={() => builderMode ? (onOpenImageGen ? onOpenImageGen() : setDraft("/image create an image of ")) : onToolSelect?.("image")}
                    className={styles.creativeBtnPrimary}
                  >
                    <span className={styles.creativeBtnIcon}><ImageIcon size={17} /></span>
                    <span><b>Create an image</b><small>Art, logos, products</small></span>
                    <ArrowUpRight size={15} />
                  </button>
                  <button
                    onClick={() => builderMode ? setDraft("/video ") : onToolSelect?.("video")}
                    className={styles.creativeBtnSecondary}
                  >
                    <span className={styles.creativeBtnIconViolet}><Clapperboard size={17} /></span>
                    <span><b>Create a video</b><small>Animate any idea</small></span>
                    <ArrowUpRight size={15} />
                  </button>
                </div>
              </div>

              <div className={styles.creativeFooter}>
                <Sparkles size={11} /> Image · Video · Motion
              </div>
            </section>

            <div className={styles.promptStarters}>
              <span className={styles.promptStartersLabel}>Try</span>
              {["A cinematic product shot", "Turn my photo into a video", "Design a bold album cover", "Make a logo move"].map((item) => (
                <button
                  key={item}
                  onClick={() => onPromptSelectAction ? onPromptSelectAction(item) : setDraft(item)}
                  className={styles.promptStarter}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}
        <BuilderStream
          blocks={blocks}
          isSpeaking={state === "speaking"}
          onSpeak={speakText}
          stopSpeaking={stopSpeaking}
          busySeconds={busySeconds}
        />
      </section>

      {!hideDock && (
        <footer className={styles.dock}>
          <div className="px-3 pt-2 pb-1">
            <StudioHealthPanel />
          </div>
          <div className={styles.quickActions} aria-label="Quick commands">
            {actions.map((action) => (
              <button key={action} onClick={() => setDraft(`${action} `)}>
                {action}
              </button>
            ))}
          </div>
          <div className={styles.voiceStatus} role="status" aria-live="polite">
            {voiceState === "cooldown" ? (
              <span className="text-amber-400">Retry available in {cooldownRemaining}s</span>
            ) : (
              <>
                <i /> {voiceLabel} · clean speech
              </>
            )}
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
              className={cn(
                styles.mic,
                voiceState === "listening" && styles.listening,
                voiceState === "cooldown" && styles.cooldown,
              )}
              disabled={micDisabled}
              aria-label={
                voiceState === "cooldown"
                  ? "Voice limit reached — click to reset"
                  : micDisabled
                    ? "Voice busy"
                    : voiceActive
                      ? "Stop voice input"
                      : "Start voice input"
              }
              title={
                voiceState === "cooldown"
                  ? "Voice limit reached — click to reset"
                  : micDisabled
                    ? "Voice busy"
                    : voiceActive
                      ? "Stop voice"
                      : "Voice input"
              }
              onClick={() => {
                if (micDisabled) return;
                if (voiceState === "cooldown" || voiceActive) {
                  stopVoice();
                } else {
                  void startVoice();
                }
              }}
            >
              <Mic size={18} />
            </button>
            <button
              className={styles.send}
              disabled={!draft.trim() || sending}
              aria-label="Send message"
              title="Send"
            >
              <ArrowUp size={18} />
            </button>
          </form>
        </footer>
      )}
    </main>
  );
}

export default ChatShell;
