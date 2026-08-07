"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  copyToClipboard,
  downloadTextFile,
  conversationToPlainText,
  conversationToMarkdown,
  markdownToPlainText,
} from "@/lib/studio/message-copy";

/* ── Inline SVG icons for hover actions (lucide-react is pinned to ^1.24) ── */
function IconReply({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  );
}
function IconPin({ size = 12, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="17" x2="12" y2="22" /><path d="M5 17h14l-1.5-3h-11z" /><path d="M8 14V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v9" />
    </svg>
  );
}
function IconBranch({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}
function IconCopy({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function IconCheck({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function IconRefresh({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}
function IconSpeaker({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

/** Hover actions toolbar — appears on message hover with Copy, Reply, Pin, Regenerate, Branch. */
function MessageHoverActions({
  message,
  isUser,
  isFailed,
  isLastAssistant,
  isCopied,
  copiedKind,
  onCopyText,
  onCopyMarkdown,
  onSpeak,
  onRegenerate,
  onReply,
  onPin,
  onBranch,
  isPinned,
}: {
  message: ChatMessage;
  isUser: boolean;
  isFailed: boolean;
  isLastAssistant: boolean;
  isCopied: boolean;
  copiedKind: "text" | "markdown" | null;
  onCopyText: () => void;
  onCopyMarkdown: () => void;
  onSpeak: () => void;
  onRegenerate?: () => void;
  onReply?: () => void;
  onPin?: () => void;
  onBranch?: () => void;
  isPinned: boolean;
}) {
  if (isUser) return null;
  if (!message.content?.trim()) return null;
  const actions: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean; testId?: string }[] = [
    {
      icon: isCopied && copiedKind === "text" ? <IconCheck /> : <IconCopy />,
      label: isCopied && copiedKind === "text" ? "Copied" : "Copy",
      onClick: onCopyText,
      active: isCopied && copiedKind === "text",
      testId: `hover-copy-${message.id}`,
    },
    { icon: <IconReply />, label: "Reply", onClick: () => onReply?.() },
    { icon: <IconPin filled={isPinned} />, label: isPinned ? "Unpin" : "Pin", onClick: () => onPin?.(), active: isPinned },
    { icon: <IconSpeaker />, label: "Read", onClick: onSpeak },
  ];
  if (isCopied && copiedKind === "markdown") {
    actions[0] = { icon: <IconCheck />, label: "Copied", onClick: onCopyMarkdown, active: true };
  } else {
    actions.push({ icon: <IconCopy />, label: "MD", onClick: onCopyMarkdown, testId: `hover-md-${message.id}` });
  }
  if (isLastAssistant && !isFailed && onRegenerate) {
    actions.push({ icon: <IconRefresh />, label: "Regenerate", onClick: onRegenerate });
  }
  if (onBranch) {
    actions.push({ icon: <IconBranch />, label: "Branch", onClick: onBranch });
  }
  if (isFailed && onRegenerate) {
    actions.push({ icon: <IconRefresh />, label: "Retry", onClick: onRegenerate });
  }
  return (
    <div
      className="pointer-events-none absolute top-0 z-20 flex items-center gap-0.5 rounded-lg border p-0.5 opacity-0 shadow-xl transition-all duration-150 group-hover:opacity-100 group-hover:pointer-events-auto"
      style={{
        right: 0,
        transform: "translateY(-100%)",
        backgroundColor: "var(--studio-elevated, #1a1530)",
        borderColor: "var(--studio-border-strong, rgba(255,255,255,0.12))",
      }}
    >
      {actions.map((action, i) => (
        <button
          key={i}
          type="button"
          onClick={action.onClick}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-bold transition hover:bg-white/10"
          style={{ color: action.active ? "#a3e635" : "var(--text-muted, rgba(255,255,255,0.5))" }}
          title={action.label}
          aria-label={action.label}
          data-testid={action.testId}
        >
          {action.icon}
          <span className="hidden sm:inline">{action.label}</span>
        </button>
      ))}
    </div>
  );
}

function ReasoningBlock({ reasoning, color, streaming }: { reasoning: string; color: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  return (
    <div className="mb-1 w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.14em] transition hover:opacity-80"
        style={{ color: `${color}cc` }}
        aria-expanded={Boolean(open)}
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

/** Small "Copied" confirmation that fades after 2 seconds. */
function CopiedBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      className="select-none rounded px-1.5 py-0.5 text-[8px] font-bold transition-opacity"
      style={{ color: "#a3e635", backgroundColor: "rgba(114,242,56,0.1)" }}
      aria-live="polite"
    >
      Copied
    </span>
  );
}

/** A code block with a copy button in the top-right corner. */
function CodeBlockWithCopy({ code, children }: { code: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-1.5 top-1.5 z-10 rounded border px-1.5 py-0.5 text-[8px] font-bold opacity-0 transition group-hover:opacity-100 focus:opacity-100"
        style={{
          borderColor: "rgba(255,255,255,0.15)",
          backgroundColor: "rgba(0,0,0,0.5)",
          color: copied ? "#a3e635" : "rgba(255,255,255,0.6)",
        }}
        aria-label={copied ? "Code copied" : "Copy code"}
        title={copied ? "Copied!" : "Copy code"}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto rounded-lg bg-black/40 p-2 text-[11px]">{children}</pre>
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedKind, setCopiedKind] = useState<"text" | "markdown" | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const handleCopyText = useCallback(async (message: ChatMessage) => {
    const ok = await copyToClipboard(markdownToPlainText(message.content));
    if (ok) {
      setCopiedId(message.id ?? null);
      setCopiedKind("text");
      setTimeout(() => { setCopiedId(null); setCopiedKind(null); }, 2000);
    }
  }, []);

  const handleCopyMarkdown = useCallback(async (message: ChatMessage) => {
    const ok = await copyToClipboard(message.content);
    if (ok) {
      setCopiedId(message.id ?? null);
      setCopiedKind("markdown");
      setTimeout(() => { setCopiedId(null); setCopiedKind(null); }, 2000);
    }
  }, []);

  const handleDownloadTxt = useCallback(() => {
    const content = conversationToPlainText(messages, agentMeta.displayName);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadTextFile(`litt-conversation-${stamp}.txt`, content);
  }, [messages, agentMeta.displayName]);

  const handleDownloadMd = useCallback(() => {
    const content = conversationToMarkdown(messages, agentMeta.displayName);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadTextFile(`litt-conversation-${stamp}.md`, content, "text/markdown");
  }, [messages, agentMeta.displayName]);

  const handlePin = useCallback((message: ChatMessage) => {
    const id = message.id ?? "";
    if (!id) return;
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleReply = useCallback((message: ChatMessage) => {
    setReplyTarget(message);
    // Dispatch event so the composer can quote this message
    window.dispatchEvent(new CustomEvent("studio:reply-to", { detail: { id: message.id, content: message.content } }));
    // Focus the composer
    const composer = document.querySelector<HTMLTextAreaElement>("[data-testid='studio-command-composer'] textarea");
    if (composer) {
      composer.focus();
      const quote = message.content.slice(0, 200).trim();
      const current = composer.value;
      if (!current.startsWith(">")) {
        composer.value = `> ${quote.replace(/\n/g, "\n> ")}\n\n`;
        composer.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }, []);

  const handleBranch = useCallback((message: ChatMessage) => {
    window.dispatchEvent(new CustomEvent("studio:branch-from", { detail: { id: message.id, content: message.content } }));
  }, []);

  const hasDownloadableMessages = messages.some((m) => m.content?.trim());

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
          const isCopied = copiedId === message.id;
          const isPinned = pinnedIds.has(message.id ?? "");
          return (
            <div
              key={key}
              className={`group flex gap-3 studio-anim-in ${isUser ? "flex-row-reverse" : "flex-row"} ${isPinned ? "relative" : ""}`}
              data-testid={isUser ? "user-message" : "assistant-message"}
            >
              {isUser ? (
                <UserMessageAvatar size={30} />
              ) : (
                <div
                  className="grid shrink-0 place-items-center overflow-hidden rounded-xl border"
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
                    className="h-full w-full object-contain p-0.5"
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
                  className="relative min-w-0 max-w-full rounded-2xl border px-4 py-3 text-[13px] leading-6"
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
                    <span className="select-text">{message.content}</span>
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
                    <div className="prose prose-invert prose-sm max-w-none select-text prose-p:my-1 prose-pre:my-1">
                      <ReactMarkdown
                        components={{
                          img: ({ src, alt }) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={src} alt={alt} className="h-auto max-w-full rounded-lg object-contain" loading="lazy" />
                          ),
                          pre: ({ children }) => {
                            // Extract raw text from the code element for copying
                            let raw = "";
                            if (typeof children === "string") {
                              raw = children;
                            } else if (children && typeof children === "object" && "props" in children) {
                              const childProps = (children as React.ReactElement).props as { children?: React.ReactNode };
                              raw = typeof childProps.children === "string" ? childProps.children : "";
                            }
                            return <CodeBlockWithCopy code={raw}>{children}</CodeBlockWithCopy>;
                          },
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                      {isStreaming && hasContent && (
                        <span
                          className="studio-anim-blink ml-0.5 inline-block align-middle"
                          style={{ width: "2px", height: "14px", background: "var(--litt-primary)" }}
                          aria-hidden
                        />
                      )}
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
                {/* Pinned indicator badge */}
                {isPinned && (
                  <div
                    className="flex items-center gap-1 px-1 text-[8px] font-bold uppercase tracking-wider"
                    style={{ color: "#e3b341" }}
                  >
                    <IconPin size={8} filled /> Pinned
                  </div>
                )}
                {/* Reply quote indicator */}
                {replyTarget?.id === message.id && (
                  <div
                    className="px-1 text-[8px] font-bold uppercase tracking-wider"
                    style={{ color: agentColor }}
                  >
                    ↩ Replying to this message
                  </div>
                )}
                {/* Hover actions toolbar — replaces always-visible buttons */}
                <div className="relative">
                  <MessageHoverActions
                    message={message}
                    isUser={isUser}
                    isFailed={isFailed}
                    isLastAssistant={isLastAssistant}
                    isCopied={isCopied}
                    copiedKind={copiedKind}
                    onCopyText={() => void handleCopyText(message)}
                    onCopyMarkdown={() => void handleCopyMarkdown(message)}
                    onSpeak={() => speakText(message.content)}
                    onRegenerate={onRegenerateAction}
                    onReply={() => handleReply(message)}
                    onPin={() => handlePin(message)}
                    onBranch={() => handleBranch(message)}
                    isPinned={isPinned}
                  />
                  {/* Minimal timestamp — always visible, actions appear on hover */}
                  <div className="mt-0.5 flex items-center gap-1.5 px-1">
                    <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                      {message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                    </span>
                    {isCopied && <CopiedBadge show={isCopied} />}
                  </div>
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
        {hasDownloadableMessages && !busy && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleDownloadTxt}
              className="rounded-lg border px-2.5 py-1 text-[9px] font-bold transition hover:opacity-80"
              style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
              aria-label="Download conversation as text"
              title="Download as .txt"
              data-testid="download-txt"
            >
              Download .txt
            </button>
            <button
              type="button"
              onClick={handleDownloadMd}
              className="rounded-lg border px-2.5 py-1 text-[9px] font-bold transition hover:opacity-80"
              style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
              aria-label="Download conversation as Markdown"
              title="Download as .md"
              data-testid="download-md"
            >
              Download .md
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
