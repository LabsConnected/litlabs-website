"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { UserMessageAvatar } from "@/components/chat/MessageAvatar";
import { parseJarvisActions } from "@/lib/litt-context";
import { ActionChips } from "./canvas/ActionChips";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import { useTerminalStore } from "@/stores/useTerminalStore";
import {
  AGENT_META,
  type ChatMessage,
  type AgentId,
} from "../stores/useStudioAgentStore";
import type { StudioTool } from "./StudioSidebar";

function ReasoningBlock({ reasoning, color, streaming }: { reasoning: string; color: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  return (
    <div className="mb-1 w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.14em] transition hover:opacity-80"
        style={{ color: `${color}cc` }}
        aria-expanded={open}
      >
        <span
          className="inline-block h-0 w-0 border-y-[3px] border-l-[5px] border-y-transparent transition-transform"
          style={{ borderLeftColor: color, transform: open ? "rotate(90deg)" : "none" }}
        />
        {streaming ? "Thinking…" : "Thought process"}
      </button>
      {open && (
        <div
          className="mt-1 max-h-60 overflow-y-auto rounded-xl border px-3 py-2 text-[11px] leading-5 italic"
          style={{
            borderColor: `${color}1f`,
            background: `${color}08`,
            color: "var(--text-muted)",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        >
          {reasoning}
        </div>
      )}
    </div>
  );
}

export default function StudioTranscript({
  messages,
  busy,
  activeAgentId,
  onRouteToolAction,
  onRegenerateAction,
}: {
  messages: ChatMessage[];
  busy: boolean;
  activeAgentId: AgentId;
  onRouteToolAction?: (tool: StudioTool, command?: string) => void;
  onRegenerateAction?: () => void;
}) {
  const { speakText } = useVoiceSession();
  const ptyUsable = useTerminalStore((s) => s.isUsable());
  const agentMeta = AGENT_META[activeAgentId];
  const agentColor = agentMeta.color;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      style={{ color: "var(--text-primary)" }}
    >
      <div className="mx-auto flex w-full min-w-0 flex-col gap-5 pb-4" style={{ maxWidth: "var(--studio-composer-max-w)" }}>
        {messages.map((message, index) => {
          const isUser = message.role === "user";
          const isStreaming = message.status === "streaming";
          const hasContent = Boolean(message.content?.trim());
          if (!isUser && !hasContent && !isStreaming) {
            return null;
          }
          const isFailed = !isUser && message.status === "failed";
          const isLastAssistant = !isUser && index === messages.length - 1 && !busy;
          const showThinkingPlaceholder = !isUser && isStreaming && !hasContent;
          const command = !isUser ? parseJarvisActions(message.content).find((a) => a.command)?.command : undefined;
          const key = message.id || `msg_${index}`;
          return (
            <div
              key={key}
              className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
              data-testid={isUser ? "user-message" : "assistant-message"}
            >
              {isUser ? (
                <UserMessageAvatar size={30} />
              ) : (
                <div
                  className="grid shrink-0 place-items-center overflow-hidden rounded-full border"
                  style={{
                    width: 32,
                    height: 32,
                    borderColor: `${agentColor}30`,
                    backgroundColor: `${agentColor}10`,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activeAgentId === "spark" ? "/brand/spark-agent-portrait.png" : "/brand/litt/litt-avatar-64.webp"}
                    alt={agentMeta.displayName}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              <div
                className={`flex max-w-[88%] min-w-0 flex-col sm:max-w-[78%] ${isUser ? "items-end" : "items-start"}`}
              >
                <div
                  className={`mb-1 flex items-center gap-2 px-1 text-[9px] font-black uppercase tracking-[.14em] ${isUser ? "flex-row-reverse" : ""}`}
                  style={{ color: isUser ? "#fb923c" : agentColor }}
                >
                  <span>{isUser ? "You" : agentMeta.displayName}</span>
                  {!isUser && (
                    <span
                      className="rounded-full border px-1.5 py-0.5 text-[7px]"
                      style={{ borderColor: `${agentColor}20`, backgroundColor: `${agentColor}08`, color: `${agentColor}99` }}
                    >
                      AI
                    </span>
                  )}
                </div>
                {!isUser && command && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
                    <button
                      type="button"
                      onClick={() => onRouteToolAction?.("terminal", command)}
                      disabled={!ptyUsable}
                      className="rounded-lg border px-2.5 py-1.5 text-[9px] font-bold transition disabled:cursor-not-allowed disabled:opacity-35"
                      style={{ borderColor: "rgba(114,242,56,0.2)", backgroundColor: "rgba(114,242,56,0.05)", color: "#a3e635" }}
                      aria-label={`Run ${command} in terminal`}
                      title={`Run ${command} in terminal`}
                    >
                      Run in terminal
                    </button>
                    {!ptyUsable && <span className="text-[8px]" style={{ color: "#e3b341" }}>Terminal not connected</span>}
                  </div>
                )}
                {!isUser && message.reasoning && message.reasoning.trim() && (
                  <ReasoningBlock
                    reasoning={message.reasoning}
                    color={agentColor}
                    streaming={busy && index === messages.length - 1}
                  />
                )}
                <div
                  className="relative min-w-0 max-w-full overflow-hidden rounded-2xl border px-4 py-3 text-[13px] leading-6"
                  style={{
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                    borderColor: isFailed
                      ? "rgba(239,68,68,0.3)"
                      : isUser ? "rgba(249,115,22,0.25)" : `${agentColor}26`,
                    background: isFailed
                      ? "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.02))"
                      : isUser
                        ? "linear-gradient(135deg, rgba(249,115,22,0.12), rgba(249,115,22,0.05))"
                        : isStreaming
                          ? `linear-gradient(135deg, ${agentColor}14, rgba(255,255,255,0.03))`
                          : `linear-gradient(135deg, ${agentColor}0f, rgba(255,255,255,0.02))`,
                    color: isUser ? "#fff" : "var(--text-primary)",
                  }}
                  aria-busy={showThinkingPlaceholder}
                >
                  {isUser ? (
                    message.content
                  ) : showThinkingPlaceholder ? (
                    <div className="flex min-h-[2.25rem] items-center gap-2 text-[12px] text-white/55">
                      <span className="flex gap-1" aria-hidden>
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[color:var(--litt-primary)] [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[color:var(--litt-primary)] [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[color:var(--litt-primary)]" />
                      </span>
                      <span>LiTT is thinking…</span>
                    </div>
                  ) : (
                    <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-1">
                      <ReactMarkdown
                        components={{
                          img: ({ src, alt }) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={src} alt={alt} className="h-auto max-w-full rounded-lg object-contain" loading="lazy" />
                          ),
                          pre: ({ children }) => (
                            <pre className="overflow-x-auto rounded-lg bg-black/40 p-2 text-[11px]">{children}</pre>
                          ),
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
                {message.actions && message.actions.length > 0 && (
                  <ActionChips
                    actions={message.actions}
                    onExecute={(action) => {
                      window.dispatchEvent(new CustomEvent("canvas:execute-action", { detail: action }));
                    }}
                  />
                )}
                <div className="mt-1 flex items-center gap-2 px-1">
                  <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                    {message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                  </span>
                  {!isUser && !isFailed && message.content?.trim() && (
                    <button
                      type="button"
                      onClick={() => speakText(message.content)}
                      className="flex items-center gap-1 text-[9px] transition hover:opacity-80"
                      style={{ color: "var(--text-muted)" }}
                      title="Read aloud"
                      aria-label="Read aloud"
                    >
                      Read
                    </button>
                  )}
                  {!isUser && isFailed && onRegenerateAction && (
                    <button
                      type="button"
                      onClick={onRegenerateAction}
                      className="flex items-center gap-1 text-[9px] font-bold transition hover:opacity-80"
                      style={{ color: "#fca5a5" }}
                      title="Retry"
                      aria-label="Retry"
                    >
                      Retry
                    </button>
                  )}
                  {isLastAssistant && !isFailed && onRegenerateAction && (
                    <button
                      type="button"
                      onClick={onRegenerateAction}
                      className="flex items-center gap-1 text-[9px] transition hover:opacity-80"
                      style={{ color: "var(--text-muted)" }}
                      title="Regenerate response"
                      aria-label="Regenerate response"
                    >
                      Regenerate
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {busy && !messages.some((m) => m.status === "streaming") && (
          <div className="flex gap-3">
            <div
              className="grid shrink-0 place-items-center overflow-hidden rounded-full border"
              style={{ width: 32, height: 32, borderColor: `${agentColor}30`, backgroundColor: `${agentColor}10` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeAgentId === "spark" ? "/brand/spark-agent-portrait.png" : "/brand/litt/litt-avatar-64.webp"}
                alt={agentMeta.displayName}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex items-center gap-1.5 rounded-2xl border px-4 py-3" style={{ borderColor: `${agentColor}26` }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-pulse rounded-full"
                  style={{ backgroundColor: agentColor, animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}