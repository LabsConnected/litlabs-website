"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { UserMessageAvatar } from "@/components/chat/MessageAvatar";
import { parseJarvisActions } from "@/lib/litt-context";
import { ActionChips } from "./canvas/ActionChips";
import { MessageEventCard } from "./MessageEventCards";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import { useTerminalStore } from "@/stores/useTerminalStore";
import {
  AGENT_META,
  type AgentId,
} from "../stores/useStudioAgentStore";
import type { StudioMessage } from "../types/conversation";
import type { StudioTool } from "./StudioSidebar";

/**
 * StudioTranscript — the single visible conversation transcript for
 * the Command Studio. Replaces the hidden opacity-0 ChatTool.
 *
 * Renders compact right-aligned user messages, full-width LiTT
 * responses, agent avatar + name, readable 13px response text, code
 * blocks, action chips, and a busy indicator. No invisible controls.
 */
export default function StudioTranscript({
  messages,
  busy,
  activeAgentId,
  onRouteTool,
  onRegenerate,
}: {
  messages: StudioMessage[];
  busy: boolean;
  activeAgentId: AgentId;
  onRouteTool?: (tool: StudioTool, command?: string) => void;
  onRegenerate?: () => void;
}) {
  const { speakText } = useVoiceSession();
  const ptyUsable = useTerminalStore((s) => s.isUsable());
  const agentMeta = AGENT_META[activeAgentId];
  const agentColor = agentMeta.color;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages / busy changes.
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
          const isLastAssistant = !isUser && index === messages.length - 1 && !busy;
          const command = !isUser ? parseJarvisActions(message.content).find((a) => a.command)?.command : undefined;
          return (
            <div
              key={index}
              className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
            >
              {isUser ? (
                <UserMessageAvatar size={30} />
              ) : (
                <div
                  className="grid place-items-center rounded-full border"
                  style={{
                    width: 32,
                    height: 32,
                    borderColor: `${agentColor}30`,
                    backgroundColor: `${agentColor}10`,
                  }}
                >
                  <span className="text-[13px] font-black" style={{ color: agentColor }}>
                    {agentMeta.displayName[0]}
                  </span>
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
                      onClick={() => onRouteTool?.("terminal", command)}
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
                <div
                  className="relative min-w-0 max-w-full overflow-hidden rounded-2xl border px-4 py-3 text-[13px] leading-6"
                  style={{
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                    borderColor: isUser ? "rgba(249,115,22,0.25)" : `${agentColor}26`,
                    background: isUser
                      ? "linear-gradient(135deg, rgba(249,115,22,0.12), rgba(249,115,22,0.05))"
                      : `linear-gradient(135deg, ${agentColor}0f, rgba(255,255,255,0.02))`,
                    color: isUser ? "#fff" : "var(--text-primary)",
                  }}
                >
                  {isUser ? (
                    message.content
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
                {/* Phase 2.6: structured event cards from typed data */}
                {message.event && <MessageEventCard event={message.event} />}
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
                  {!isUser && (
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
                  {isLastAssistant && onRegenerate && (
                    <button
                      type="button"
                      onClick={onRegenerate}
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
        {busy && (
          <div className="flex gap-3">
            <div
              className="grid place-items-center rounded-full border"
              style={{ width: 32, height: 32, borderColor: `${agentColor}30`, backgroundColor: `${agentColor}10` }}
            >
              <span className="text-[13px] font-black" style={{ color: agentColor }}>{agentMeta.displayName[0]}</span>
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
