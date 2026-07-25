"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { UserMessageAvatar } from "@/components/chat/MessageAvatar";
import {
  Zap,
  Copy,
  Check,
  RefreshCw,
  MoreHorizontal,
  Image as ImageIcon,
  Clapperboard,
  BrainCircuit,
  MessageSquareText,
  Layers3,
  CircleCheck,
  ChevronDown,
  History,
} from "lucide-react";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import ReactMarkdown from "react-markdown";
import MultimodalComposer from "./MultimodalComposer";
import type { StudioTool } from "./StudioSidebar";
import SessionSidebar from "./SessionSidebar";
import type { BuilderSession } from "../hooks/useBuilderSessions";
import { parseJarvisActions } from "@/lib/litt-context";
import {
  useStudioAgentStore,
  AGENT_META,
  type AgentId,
} from "../stores/useStudioAgentStore";
import { useTerminalStore } from "@/stores/useTerminalStore";
import { type ConnectionCapabilities } from "../hooks/useConnectionSummary";

type Message = {
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
};

interface ChatShellProps {
  selectedModel?: string;
  messages: Message[];
  busy: boolean;
  onSend: (value: string, attachments?: string[]) => Promise<string>;
  onNewChat?: () => void;
  onRegenerate?: () => void;
  onRouteTool?: (tool: StudioTool, command?: string) => void;
  requestedTool?: StudioTool;
  pendingCommand?: string;
  initialPrompt?: string;
  activeAgentId: AgentId;
  sessions: BuilderSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onRenameSession: (id: string, title: string) => void;
  onPinSession: (id: string) => void;
  onDuplicateSession: (session: BuilderSession) => void;
  onDeleteSession: (id: string) => void;
  onDeleteAllSessions: () => void;
  fallbackNotice?: string | null;
  capabilities?: ConnectionCapabilities;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-[9px] transition hover:text-cyan-300"
      title="Copy"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CapabilityChip({
  label,
  active,
  color = "#22c55e",
  title,
}: {
  label: string;
  active: boolean;
  color?: string;
  title?: string;
}) {
  return (
    <span
      className="inline-flex min-w-0 shrink-0 items-center gap-1 rounded-md border border-white/8 bg-black/30 px-2 py-0.5"
      title={title}
      aria-label={label}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: active ? color : "#6b7280" }}
        aria-hidden
      />
      <span className="whitespace-nowrap text-[9px] font-bold text-white/70">
        {label}
      </span>
    </span>
  );
}

export default function ChatShell({
  selectedModel = "adaptive",
  messages,
  busy,
  onSend,
  onNewChat,
  onRegenerate,
  onRouteTool,
  initialPrompt = "",
  activeAgentId,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onPinSession,
  onDuplicateSession,
  onDeleteSession,
  onDeleteAllSessions,
  fallbackNotice,
  capabilities: _capabilities,
}: ChatShellProps) {
  const { resolvedColors: T } = useTheme();
  const { profile } = useProfile();
  const { speakText } = useVoiceSession();
  const setActiveAgent = useStudioAgentStore((s) => s.setActiveAgent);
  const agentMeta = AGENT_META[activeAgentId];
  const agentColor = agentMeta.color;
  const [input, setInput] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [activityOpen, setActivityOpen] = useState(true);
  const [busySeconds, setBusySeconds] = useState(0);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const ptyUsable = useTerminalStore((s) => s.isUsable());
  const capabilities = _capabilities ?? { repository: "none", terminalExecution: "unavailable", writeAccess: false, connectionSummary: "No services connected." } as ConnectionCapabilities;

  // Close drawer on Escape
  useEffect(() => {
    if (!sessionsOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSessionsOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sessionsOpen]);

  useEffect(() => {
    if (initialPrompt) setInput((current) => current || initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    if (!busy) {
      setBusySeconds(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setBusySeconds(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [busy]);

  const displayName = useMemo(
    () => profile?.displayName || "Member",
    [profile],
  );


  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, busy]);

  const isEmpty = messages.length === 0;

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-[#0a0a0f]">
      {/* Session drawer — floating overlay, not permanent */}
      {sessionsOpen && (
        <>
          <button
            className="fixed inset-0 z-40 bg-black/55"
            onClick={() => setSessionsOpen(false)}
            aria-label="Close sessions"
          />
          <div
            className="fixed left-12 top-0 z-50 flex h-full w-75 flex-col overflow-y-auto border-r border-white/10 bg-[#090910]/98 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Chat sessions"
          >
            <SessionSidebar
              sessions={sessions}
              activeId={activeSessionId}
              open={true}
              onOpenChange={setSessionsOpen}
              onSelect={(id) => { onSelectSession(id); setSessionsOpen(false); }}
              onNew={() => { onNewSession(); setSessionsOpen(false); }}
              onRename={onRenameSession}
              onPin={onPinSession}
              onDuplicate={onDuplicateSession}
              onDelete={onDeleteSession}
              onDeleteAll={onDeleteAllSessions}
            />
          </div>
        </>
      )}

      {/* Main chat column */}
      <div
        className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0a0a0f]"
        style={{ color: T.textColor }}
      >
      {/* Animated circuit background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 80%, rgba(249,115,22,0.12) 0%, transparent 35%), radial-gradient(circle at 80% 20%, rgba(34,211,238,0.12) 0%, transparent 35%), linear-gradient(rgba(34,211,238,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.03) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 100% 100%, 44px 44px, 44px 44px",
        }}
      />

      {/* Header — LiTT panel (3-row) */}
      <header
        className="relative z-10 flex shrink-0 flex-col border-b bg-[#0a0a0f]/90 px-3 backdrop-blur-md"
        style={{ borderColor: `${agentColor}20` }}
      >
        {/* Row 1: LiTT avatar + agent switcher | history | more */}
        <div className="flex h-10 shrink-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {/* LiTT avatar */}
            <div
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border"
              style={{
                borderColor: `${agentColor}30`,
                backgroundColor: `${agentColor}10`,
              }}
            >
              <span className="text-[11px] font-black" style={{ color: agentColor }}>
                {agentMeta.displayName[0]}
              </span>
            </div>
            <span
              className="text-[11px] font-black leading-tight shrink-0"
              style={{ color: agentColor }}
            >
              LiTT
            </span>

            {/* Agent switcher */}
            <div
              className="flex shrink-0 items-center gap-0.5 rounded-lg border border-white/8 bg-black/40 p-0.5"
              role="tablist"
              aria-label="Select agent"
            >
              {(Object.keys(AGENT_META) as AgentId[]).map((id) => {
                const meta = AGENT_META[id];
                const active = activeAgentId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveAgent(id)}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-black transition-all"
                    style={{
                      backgroundColor: active ? `${meta.color}18` : "transparent",
                      color: active ? meta.color : "rgba(255,255,255,0.5)",
                    }}
                    title={`Switch to ${meta.displayName}`}
                    aria-label={`Switch to ${meta.displayName}`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor: meta.color,
                        boxShadow: active ? `0 0 6px ${meta.color}` : "none",
                      }}
                    />
                    {meta.displayName}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* History button */}
            <button
              type="button"
              onClick={() => setSessionsOpen(true)}
              className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/5"
              aria-label="Chat history"
              title="Chat history"
            >
              <History size={15} style={{ color: T.textMuted }} />
            </button>

            {/* More menu with Clear */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreMenuOpen((v) => !v)}
                className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/5"
                aria-label="More options"
                title="More options"
              >
                <MoreHorizontal size={15} style={{ color: T.textMuted }} />
              </button>
              {moreMenuOpen && (
                <>
                  <button className="fixed inset-0 z-40" onClick={() => setMoreMenuOpen(false)} aria-label="Close menu" />
                  <div className="absolute right-0 top-9 z-50 w-40 rounded-xl border border-white/10 bg-[#171721] p-1 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => { onNewChat?.(); setMoreMenuOpen(false); }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[10px] font-bold text-white/65 hover:bg-white/8"
                    >
                      <Zap size={12} style={{ color: agentColor }} /> Clear conversation
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSessionsOpen(true); setMoreMenuOpen(false); }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[10px] font-bold text-white/65 hover:bg-white/8"
                    >
                      <History size={12} style={{ color: T.textMuted }} /> Chat history
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Row 2: online indicator + agent/model name */}
        <div className="flex h-7 shrink-0 items-center gap-2 border-t border-white/6">
          <span
            className="flex items-center gap-1.5 text-[9px] font-bold text-white/60"
            title={capabilities.connectionSummary}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: capabilities.connectedProviders.length ? T.success : "#f59e0b",
                boxShadow: `0 0 4px ${capabilities.connectedProviders.length ? T.success : "#f59e0b"}`,
              }}
            />
            {capabilities.connectedProviders.length ? "Online" : "Standby"}
          </span>
          <span className="text-[9px] font-bold" style={{ color: agentColor }}>
            {agentMeta.displayName}
          </span>
          <span className="text-[9px] text-white/40">·</span>
          <span className="text-[9px] font-bold text-white/55">{selectedModel}</span>
        </div>

        {/* Row 3: scrollable status chips */}
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-white/6 py-1.5">
          <CapabilityChip
            label={capabilities.repository === "connected" ? "Repo: Connected" : "Repo: Disconnected"}
            active={capabilities.repository === "connected"}
            color={T.success}
            title={
              capabilities.repository === "connected"
                ? "Repository is connected and indexed"
                : "No repository connected"
            }
          />
          <CapabilityChip
            label={
              capabilities.terminalExecution === "available"
                ? "PTY: Connected"
                : capabilities.terminalExecution === "connecting"
                  ? "PTY: Connecting"
                  : capabilities.terminalExecution === "error"
                    ? "PTY: Error"
                    : "PTY: Disconnected"
            }
            active={capabilities.terminalExecution === "available"}
            color={capabilities.terminalExecution === "error" ? T.warning : T.success}
            title={
              capabilities.terminalExecution === "available"
                ? "Project terminal is ready for execution"
                : capabilities.terminalExecution === "error"
                  ? `PTY connection failed: ${capabilities.terminalStatus === "error" ? "Connection error" : "Unknown error"}`
                  : "Project terminal is not connected"
            }
          />
          <CapabilityChip
            label={capabilities.writeAccess ? "Writes: Allowed" : "Writes: Approval"}
            active={capabilities.writeAccess}
            color={T.success}
            title={
              capabilities.writeAccess
                ? "Write access is enabled"
                : "Write access requires approval"
            }
          />
        </div>
      </header>

      {/* Transcript */}
      <main
        ref={transcriptRef}
        className="relative z-10 min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      >
        {isEmpty ? (
          <div className="mx-auto flex w-full min-w-0 flex-col gap-3 py-2" style={{ maxHeight: "250px" }}>
            <section className="relative w-full min-w-0 overflow-hidden rounded-xl border border-white/10 bg-[#07070b] p-4">
              <div className="mb-2 flex w-fit items-center gap-1.5 rounded-full border border-cyan-300/20 bg-cyan-300/8 px-2 py-1 text-[8px] font-black uppercase tracking-[.18em] text-cyan-200">
                <span className="h-1 w-1 animate-pulse rounded-full bg-cyan-300" />
                LiTT creative engine
              </div>
              <h1 className="max-w-full text-balance text-sm font-black leading-tight tracking-tight text-white">
                Make something impossible to ignore.
              </h1>
              <p className="mt-1 max-w-full text-[10px] leading-4 text-white/55">
                Describe the shot once. Create the image, bring it to life, and keep building with LiTT.
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onRouteTool?.("image")}
                  className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-left text-black transition hover:bg-cyan-50"
                  aria-label="Create an image"
                  title="Create an image"
                >
                  <ImageIcon size={14} className="pointer-events-none" aria-hidden />
                  <span className="text-[10px] font-bold">Image</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRouteTool?.("video")}
                  className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/8 px-2.5 py-1.5 text-left text-white transition hover:bg-white/12"
                  aria-label="Create a video"
                  title="Create a video"
                >
                  <Clapperboard size={14} className="pointer-events-none" aria-hidden />
                  <span className="text-[10px] font-bold">Video</span>
                </button>
              </div>
            </section>
          </div>
        ) : (
          <div className="mx-auto flex w-full min-w-0 flex-col gap-5 pb-4">
            {fallbackNotice && (
              <div
                className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-[10px] font-bold text-amber-300"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                {fallbackNotice}
              </div>
            )}
            {messages.map((message, index) => {
              const isUser = message.role === "user";
              const isLastAssistant =
                !isUser && index === messages.length - 1 && !busy;
              const command = !isUser ? parseJarvisActions(message.content).find((action) => action.command)?.command : undefined;
              return (
                <div
                  key={index}
                  className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
                >
                  {isUser ? <UserMessageAvatar size={30} /> : (
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
                    <div className={`mb-1 flex items-center gap-2 px-1 text-[9px] font-black uppercase tracking-[.14em] ${isUser ? "flex-row-reverse" : ""}`} style={{ color: isUser ? "#fb923c" : agentColor }}>
                      <span>{isUser ? displayName : agentMeta.displayName}</span>
                      {!isUser && <span className="rounded-full border px-1.5 py-0.5 text-[7px]" style={{ borderColor: `${agentColor}20`, backgroundColor: `${agentColor}08`, color: `${agentColor}99` }}>AI</span>}
                    </div>
                    {!isUser && command && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
                        <button
                          type="button"
                          onClick={() => onRouteTool?.("terminal", command)}
                          disabled={!ptyUsable}
                          className="rounded-lg border border-emerald-300/20 bg-emerald-300/5 px-2.5 py-1.5 text-[9px] font-bold text-emerald-200 transition hover:bg-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-35"
                          aria-label={`Run ${command} in terminal`}
                          title={`Run ${command} in terminal`}
                        >
                          Run in terminal
                        </button>
                        {!ptyUsable && <span className="text-[8px] text-amber-300/65">Terminal not connected</span>}
                      </div>
                    )}
                    <div
                      className="relative min-w-0 max-w-full overflow-hidden rounded-2xl border px-4 py-3 text-[13px] leading-6 shadow-[0_12px_35px_rgba(0,0,0,.18)]"
                      style={{
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        borderColor: isUser
                          ? "rgba(249,115,22,0.25)"
                          : `${agentColor}26`,
                        background: isUser
                          ? "linear-gradient(135deg, rgba(249,115,22,0.12), rgba(249,115,22,0.05))"
                          : `linear-gradient(135deg, ${agentColor}0f, rgba(255,255,255,0.02))`,
                        color: isUser ? "#fff" : T.textColor,
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
                                <img
                                  src={src}
                                  alt={alt}
                                  className="h-auto max-w-full rounded-lg object-contain"
                                  loading="lazy"
                                />
                              ),
                              pre: ({ children }) => (
                                <pre className="overflow-x-auto rounded-lg bg-black/40 p-2 text-[11px]">
                                  {children}
                                </pre>
                              ),
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 px-1">
                      <span
                        className="text-[9px]"
                        style={{ color: T.textMuted }}
                      >
                        {message.createdAt
                          ? new Date(message.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </span>
                      {!isUser && (
                        <>
                          <CopyButton text={message.content} />
                          <button
                            type="button"
                            onClick={() => speakText(message.content)}
                            className="flex items-center gap-1 text-[9px] transition hover:text-cyan-300"
                            title="Read aloud"
                          >
                            <Zap size={10} className="pointer-events-none" /> Speak
                          </button>
                          {isLastAssistant && (
                            <button
                              type="button"
                              onClick={() => onRegenerate?.()}
                              disabled={busy}
                              className="flex items-center gap-1 text-[9px] transition hover:text-cyan-300 disabled:opacity-40"
                              title="Regenerate"
                            >
                              <RefreshCw size={10} className="pointer-events-none" /> Regen
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {busy && (() => {
              const stages = [
                { label: "Understanding your request", detail: "Identifying intent and the best response path", icon: MessageSquareText, at: 0 },
                { label: "Loading conversation context", detail: "Using the messages and attachments available to this run", icon: Layers3, at: 1 },
                { label: "Preparing the response", detail: "Building a clear, useful answer", icon: BrainCircuit, at: 3 },
              ];
              const activeStage = busySeconds >= 3 ? 2 : busySeconds >= 1 ? 1 : 0;
              return (
                <section className="ml-11 overflow-hidden rounded-2xl border border-cyan-300/15 bg-[linear-gradient(135deg,rgba(34,211,238,.07),rgba(139,92,246,.045),rgba(255,255,255,.015))] shadow-[0_18px_55px_rgba(0,0,0,.28)]">
                  <button type="button" onClick={() => setActivityOpen((open) => !open)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                    <span className="relative grid h-9 w-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/8 text-cyan-200">
                      <BrainCircuit size={17} className="pointer-events-none" />
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_10px_#67e8f9]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-black text-white">{agentMeta.displayName} is working</span>
                      <span className="block truncate text-[9px] text-white/42">Operational trace · {busySeconds}s</span>
                    </span>
                    <ChevronDown size={14} className={`pointer-events-none text-white/35 transition ${activityOpen ? "rotate-180" : ""}`} />
                  </button>
                  {activityOpen && (
                    <div className="border-t border-white/7 px-4 py-3">
                      <div className="space-y-3">
                        {stages.map((stage, index) => {
                          const Icon = stage.icon;
                          const complete = index < activeStage;
                          const active = index === activeStage;
                          return (
                            <div key={stage.label} className={`flex items-start gap-3 transition ${index > activeStage ? "opacity-30" : "opacity-100"}`}>
                              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg ${complete ? "bg-emerald-400/12 text-emerald-300" : active ? "bg-cyan-300/12 text-cyan-200" : "bg-white/5 text-white/40"}`}>
                                {complete ? <CircleCheck size={13} /> : <Icon size={12} className={active ? "animate-pulse" : ""} />}
                              </span>
                              <span className="min-w-0">
                                <span className="block text-[10px] font-bold text-white/85">{stage.label}</span>
                                <span className="block text-[9px] leading-4 text-white/55">{stage.detail}</span>
                              </span>
                              {active && <span className="ml-auto mt-2 flex gap-0.5"><i className="h-1 w-1 animate-bounce rounded-full bg-cyan-300" /><i className="h-1 w-1 animate-bounce rounded-full bg-cyan-300 [animation-delay:.12s]" /><i className="h-1 w-1 animate-bounce rounded-full bg-cyan-300 [animation-delay:.24s]" /></span>}
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-3 border-t border-white/7 pt-2 text-[8px] leading-4 text-white/45">Shows verifiable activity, context, and tool use—not private hidden reasoning.</p>
                    </div>
                  )}
                </section>
              );
            })()}
          </div>
        )}
      </main>

      {/* Composer */}
      <div className="relative z-20 shrink-0 bg-linear-to-t from-[#05060b] via-[#05060b]/95 to-transparent px-2 pt-2 sm:px-4">
        <MultimodalComposer
          value={input}
          onChange={setInput}
          onSend={onSend}
          busy={busy}
          modelName={selectedModel}
          onRouteTool={onRouteTool}
          activeAgentId={activeAgentId}
        />
      </div>
    </div>
    </div>
  );
}
