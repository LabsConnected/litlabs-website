"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { LiTTMessageAvatar, UserMessageAvatar } from "@/components/chat/MessageAvatar";
import {
  Sparkles,
  Zap,
  Copy,
  Check,
  RefreshCw,
  Menu,
  MoreHorizontal,
  Terminal as TerminalIcon,
  X,
  ChevronUp,
  Image as ImageIcon,
  Clapperboard,
  ArrowUpRight,
  BrainCircuit,
  MessageSquareText,
  Layers3,
  CircleCheck,
  ChevronDown,
} from "lucide-react";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import ReactMarkdown from "react-markdown";
import MultimodalComposer from "./MultimodalComposer";
import type { StudioTool } from "./StudioSidebar";
import { TerminalPanel, type TerminalPanelHandle } from "@/components/litt-terminal/TerminalPanel";
import type { TerminalBuilderBlock } from "../types/builder-blocks";
import SessionSidebar from "./SessionSidebar";
import type { BuilderSession } from "../hooks/useBuilderSessions";
import { parseJarvisActions } from "@/lib/litt-context";

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
  sessions: BuilderSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onRenameSession: (id: string, title: string) => void;
  onPinSession: (id: string) => void;
  onDuplicateSession: (session: BuilderSession) => void;
  onDeleteSession: (id: string) => void;
  onDeleteAllSessions: () => void;
  shellAction?: { id: number; type: "terminal" | "sessions" } | null;
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

export default function ChatShell({
  selectedModel = "adaptive",
  messages,
  busy,
  onSend,
  onNewChat,
  onRegenerate,
  onRouteTool,
  requestedTool = "chat",
  pendingCommand = "",
  initialPrompt = "",
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
}: ChatShellProps) {
  const { resolvedColors: T } = useTheme();
  const { profile } = useProfile();
  const { speakText } = useVoiceSession();
  const [input, setInput] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<TerminalPanelHandle>(null);
  const lastCommandRef = useRef("");
  const pendingTerminalCommandRef = useRef("");
  const pendingInsertCommandRef = useRef("");
  const terminalConnectedRef = useRef(false);
  const [terminalOpen, setTerminalOpen] = useState(requestedTool === "terminal");
  const [terminalBlocks, setTerminalBlocks] = useState<TerminalBuilderBlock[]>([]);
  const [activityOpen, setActivityOpen] = useState(true);
  const [busySeconds, setBusySeconds] = useState(0);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [ptyConnected, setPtyConnected] = useState(false);

  useEffect(() => {
    if (!shellAction) return;
    if (shellAction.type === "terminal") setTerminalOpen(true);
    if (shellAction.type === "sessions") setSessionsOpen(true);
  }, [shellAction]);

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

  const runTerminalCommand = useCallback((command: string) => {
    const clean = command.replace(/^\/run\s+/, "").trim();
    setTerminalOpen(true);
    if (!clean || clean === "/terminal" || lastCommandRef.current === clean) return;
    lastCommandRef.current = clean;
    const id = `terminal-${Date.now()}`;
    setTerminalBlocks((current) => [...current, {
      id, type: "terminal", command: clean,
      output: "Waiting for terminal output…", status: "running", startedBy: "user",
    }]);
    pendingTerminalCommandRef.current = clean;
    if (terminalConnectedRef.current) {
      terminalRef.current?.runCommand(clean);
      pendingTerminalCommandRef.current = "";
    }
  }, [setTerminalOpen, setTerminalBlocks]);

  useEffect(() => {
    if (requestedTool === "terminal") runTerminalCommand(pendingCommand);
  }, [pendingCommand, requestedTool, runTerminalCommand]);

  const displayName = useMemo(
    () => profile?.displayName || "Member",
    [profile],
  );

  const projectName = "LiTTree-LabStudios";
  const stateLabel = `${displayName} · Live mission`;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, busy]);

  const isEmpty = messages.length === 0;
  const currentSession = sessions.find((session) => session.id === activeSessionId);

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-[#0a0a0f]">
      <SessionSidebar
        sessions={sessions}
        activeId={activeSessionId}
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
        onSelect={onSelectSession}
        onNew={onNewSession}
        onRename={onRenameSession}
        onPin={onPinSession}
        onDuplicate={onDuplicateSession}
        onDelete={onDeleteSession}
        onDeleteAll={onDeleteAllSessions}
      />
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

      {/* Header */}
      <header className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-[#0a0a0f]/90 px-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            className="rounded-lg p-2 hover:bg-white/5 md:hidden"
            aria-label="Open sidebar"
          >
            <Menu size={18} style={{ color: T.textMuted }} />
          </button>
          <div className="flex items-center gap-2.5">
            <LiTTMessageAvatar size={34} />
            <div className="hidden flex-col sm:flex">
              <span
                className="text-[11px] font-black leading-tight"
                style={{ color: T.textColor }}
              >
                LiTT
              </span>
              <span
                className="text-[9px] font-medium leading-tight"
                style={{ color: T.textMuted }}
              >
                {projectName} · {stateLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onNewChat?.()}
            className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-bold hover:bg-white/5"
            aria-label="New chat"
          >
            <Zap size={12} style={{ color: T.accentColor }} /> New
          </button>
          <button
            className="rounded-full border border-white/10 p-2 hover:bg-white/5"
            aria-label="More options"
          >
            <MoreHorizontal size={14} style={{ color: T.textMuted }} />
          </button>
        </div>
      </header>

      <div className="relative z-10 flex shrink-0 items-center gap-2 overflow-x-auto border-b border-white/7 bg-black/20 px-3 py-1.5 text-[8px] font-bold text-white/38 scrollbar-hide">
        <span className={currentSession?.context.repositoryState === "connected" ? "text-emerald-300" : "text-amber-300"}>{currentSession?.context.repositoryState === "connected" ? "● Repository connected" : currentSession?.context.repositoryState === "partial" ? "◐ Repository partially indexed" : currentSession?.context.repositoryState === "read-only" ? "◐ Read-only repository" : "○ No repository connected"}</span>
        <span>·</span><span className={ptyConnected ? "text-emerald-300" : "text-white/35"}>{ptyConnected ? "● Terminal execution enabled" : "○ Terminal execution unavailable"}</span>
        <span>·</span><span className="text-white/35">Write access requires approval</span>
      </div>

      {/* Transcript */}
      <main
        ref={transcriptRef}
        className="relative z-10 min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      >
        {isEmpty ? (
          <div className="mx-auto flex h-full w-full max-w-6xl flex-col justify-center gap-3 py-2 sm:gap-4">
            <section className="creative-hero group relative min-h-[270px] overflow-hidden rounded-[24px] border border-white/10 bg-[#07070b] shadow-[0_30px_100px_rgba(0,0,0,.55)] sm:min-h-[430px] sm:rounded-[28px]">
              <div className="creative-engine absolute inset-0" />
              <div className="creative-glow absolute inset-0" />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,5,10,.96)_0%,rgba(4,5,10,.68)_34%,rgba(4,5,10,.08)_68%,rgba(4,5,10,.5)_100%)]" />
              <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(4,5,10,.82)_0%,transparent_50%)]" />

              <div className="relative z-10 flex h-full min-h-[270px] max-w-xl flex-col justify-center p-5 sm:min-h-[430px] sm:p-10 lg:p-12">
                <div className="mb-5 flex w-fit items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/8 px-3 py-1.5 text-[9px] font-black uppercase tracking-[.24em] text-cyan-200 backdrop-blur-xl">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_12px_#67e8f9]" />
                  LiTT creative engine
                </div>
                <h1 className="max-w-lg text-balance text-3xl font-black leading-[.94] tracking-[-.05em] text-white sm:text-6xl">
                  Make something
                  <span className="block bg-gradient-to-r from-cyan-300 via-violet-300 to-orange-300 bg-clip-text text-transparent">
                    impossible to ignore.
                  </span>
                </h1>
                <p className="mt-3 hidden max-w-md text-sm leading-6 text-white/58 sm:block sm:text-base">
                  Describe the shot once. Create the image, bring it to life,
                  and keep building with LiTT in the same conversation.
                </p>

                <div className="mt-5 flex flex-wrap gap-2 sm:mt-7 sm:gap-3">
                  <button
                    onClick={() => onRouteTool?.("image")}
                    className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left text-black shadow-[0_14px_40px_rgba(255,255,255,.12)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_50px_rgba(34,211,238,.22)]"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-400 text-black"><ImageIcon size={17} /></span>
                    <span><b className="block text-xs">Create an image</b><small className="text-[9px] text-black/55">Art, logos, products</small></span>
                    <ArrowUpRight size={15} className="ml-2" />
                  </button>
                  <button
                    onClick={() => onRouteTool?.("video")}
                    className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/8 px-4 py-3 text-left text-white backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-violet-300/40 hover:bg-white/12"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-400/20 text-violet-200"><Clapperboard size={17} /></span>
                    <span><b className="block text-xs">Create a video</b><small className="text-[9px] text-white/45">Animate any idea</small></span>
                    <ArrowUpRight size={15} className="ml-2" />
                  </button>
                </div>
              </div>

              <div className="absolute bottom-4 right-5 z-10 hidden items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-white/35 sm:flex">
                <Sparkles size={11} className="text-violet-300" /> Image · Video · Motion
              </div>
            </section>

            <div className="scrollbar-hide hidden max-w-full items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 sm:flex">
              <span className="shrink-0 px-1 text-[9px] font-black uppercase tracking-[.18em] text-white/35">Try</span>
              {["A cinematic product shot", "Turn my photo into a video", "Design a bold album cover", "Make a logo move"].map((item) => (
                <button
                  key={item}
                  onClick={() => setInput(item)}
                  className="shrink-0 rounded-full border border-white/10 bg-white/4 px-3 py-2 text-[10px] font-medium text-white/65 transition hover:border-cyan-300/30 hover:bg-white/8 hover:text-white"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 pb-4">
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
                  {isUser ? <UserMessageAvatar size={30} /> : <LiTTMessageAvatar size={32} />}
                  <div
                    className={`flex max-w-[88%] flex-col sm:max-w-[78%] ${isUser ? "items-end" : "items-start"}`}
                  >
                    <div className={`mb-1 flex items-center gap-2 px-1 text-[9px] font-black uppercase tracking-[.14em] ${isUser ? "flex-row-reverse" : ""}`} style={{ color: isUser ? "#fb923c" : "#67e8f9" }}>
                      <span>{isUser ? displayName : "LiTT"}</span>
                      {!isUser && <span className="rounded-full border border-cyan-300/15 bg-cyan-300/5 px-1.5 py-0.5 text-[7px] text-cyan-200/60">AI</span>}
                    </div>
                    {!isUser && command && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
                        <button onClick={() => { setTerminalOpen(true); if (terminalConnectedRef.current) terminalRef.current?.insertCommand(command); else pendingInsertCommandRef.current = command; }} className="rounded-lg border border-cyan-300/20 bg-cyan-300/5 px-2.5 py-1.5 text-[9px] font-bold text-cyan-200 hover:bg-cyan-300/10">Insert into terminal</button>
                        <button disabled={!ptyConnected} onClick={() => { if (window.confirm(`Run in the connected PTY?\n\n${command}`)) terminalRef.current?.runCommand(command); }} className="rounded-lg border border-emerald-300/20 bg-emerald-300/5 px-2.5 py-1.5 text-[9px] font-bold text-emerald-200 disabled:cursor-not-allowed disabled:opacity-35">Run in terminal</button>
                        {!ptyConnected && <span className="text-[8px] text-amber-300/65">Connect the real PTY to run</span>}
                      </div>
                    )}
                    <div
                      className="relative overflow-hidden rounded-2xl border px-4 py-3 text-[13px] leading-6 shadow-[0_12px_35px_rgba(0,0,0,.18)]"
                      style={{
                        borderColor: isUser
                          ? "rgba(249,115,22,0.25)"
                          : "rgba(34,211,238,0.15)",
                        background: isUser
                          ? "linear-gradient(135deg, rgba(249,115,22,0.12), rgba(249,115,22,0.05))"
                          : "linear-gradient(135deg, rgba(34,211,238,0.06), rgba(255,255,255,0.02))",
                        color: isUser ? "#fff" : T.textColor,
                      }}
                    >
                      {isUser ? (
                        message.content
                      ) : (
                        <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-1">
                          <ReactMarkdown>{message.content}</ReactMarkdown>
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
                            onClick={() => speakText(message.content)}
                            className="flex items-center gap-1 text-[9px] transition hover:text-cyan-300"
                            title="Read aloud"
                          >
                            <Zap size={10} /> Speak
                          </button>
                          {isLastAssistant && (
                            <button
                              onClick={() => onRegenerate?.()}
                              disabled={busy}
                              className="flex items-center gap-1 text-[9px] transition hover:text-cyan-300 disabled:opacity-40"
                              title="Regenerate"
                            >
                              <RefreshCw size={10} /> Regen
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {terminalBlocks.map((block) => (
              <section key={block.id} className="rounded-2xl border border-emerald-400/20 bg-black/60 p-3 font-mono text-[11px]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-bold text-emerald-300"><TerminalIcon size={13} /> Terminal · You</span>
                  <button onClick={() => setTerminalOpen(true)} className="flex items-center gap-1 text-white/60 hover:text-white"><ChevronUp size={12} /> Expand</button>
                </div>
                <div className="text-white/90">$ {block.command}</div>
                <div className="mt-2 max-h-20 overflow-hidden whitespace-pre-wrap text-white/45">{block.output}</div>
                <div className="mt-2 text-[9px] uppercase tracking-wider text-amber-300">{block.status}</div>
              </section>
            ))}
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
                      <BrainCircuit size={17} />
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_10px_#67e8f9]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-black text-white">LiTT is working</span>
                      <span className="block truncate text-[9px] text-white/42">Operational trace · {busySeconds}s</span>
                    </span>
                    <ChevronDown size={14} className={`text-white/35 transition ${activityOpen ? "rotate-180" : ""}`} />
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
                                <span className="block text-[9px] leading-4 text-white/38">{stage.detail}</span>
                              </span>
                              {active && <span className="ml-auto mt-2 flex gap-0.5"><i className="h-1 w-1 animate-bounce rounded-full bg-cyan-300" /><i className="h-1 w-1 animate-bounce rounded-full bg-cyan-300 [animation-delay:.12s]" /><i className="h-1 w-1 animate-bounce rounded-full bg-cyan-300 [animation-delay:.24s]" /></span>}
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-3 border-t border-white/7 pt-2 text-[8px] leading-4 text-white/28">Shows verifiable activity, context, and tool use—not private hidden reasoning.</p>
                    </div>
                  )}
                </section>
              );
            })()}
          </div>
        )}
      </main>

      {/* Composer */}
      <div className="relative z-20 shrink-0 bg-gradient-to-t from-[#05060b] via-[#05060b]/95 to-transparent px-2 pt-2 sm:px-4">
        <MultimodalComposer
          value={input}
          onChange={setInput}
          onSend={onSend}
          busy={busy}
          modelName={selectedModel}
          onRouteTool={onRouteTool}
        />
      </div>

      <section className={`${terminalOpen ? "flex" : "hidden"} absolute inset-x-0 bottom-0 z-40 h-[min(56vh,520px)] flex-col border-t border-emerald-400/20 bg-black shadow-[0_-20px_60px_rgba(0,0,0,.65)] md:bottom-[76px]`}>
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <div><strong className="flex items-center gap-2 text-xs text-emerald-300"><TerminalIcon size={14} /> Terminal</strong><div className="mt-0.5 text-[9px] text-white/35">Browser shell: unavailable · <span className={ptyConnected ? "text-emerald-300" : "text-amber-300"}>{ptyConnected ? "● Real PTY connected" : "○ Real PTY disconnected"}</span></div></div>
          <button onClick={() => setTerminalOpen(false)} className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close terminal"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1">
          <TerminalPanel
            ref={terminalRef}
            onTerminalOutput={(output) => setTerminalBlocks((current) => current.map((block, index) => index === current.length - 1 ? { ...block, output: output.slice(-1200) } : block))}
            onConnectionChange={(connected) => {
              terminalConnectedRef.current = connected;
              setPtyConnected(connected);
              if (connected && pendingTerminalCommandRef.current) {
                terminalRef.current?.runCommand(pendingTerminalCommandRef.current);
                pendingTerminalCommandRef.current = "";
              } else if (connected && pendingInsertCommandRef.current) {
                terminalRef.current?.insertCommand(pendingInsertCommandRef.current);
                pendingInsertCommandRef.current = "";
              } else if (!connected) {
                setTerminalBlocks((current) => current.map((block, index) => index === current.length - 1 && block.status === "running" ? { ...block, status: "disconnected" } : block));
              }
            }}
          />
        </div>
      </section>

      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes creative-drift {
          0%, 100% { transform: scale(1.04) translate3d(0, 0, 0); }
          50% { transform: scale(1.1) translate3d(1.2%, -1%, 0); }
        }
        @keyframes creative-light {
          0%, 100% { opacity: .36; transform: translate3d(-8%, 0, 0) rotate(-8deg); }
          50% { opacity: .7; transform: translate3d(8%, -2%, 0) rotate(6deg); }
        }
        .creative-engine {
          background-image: url('/brand/litt-mascot-hero.png');
          background-position: 68% 25%;
          background-size: cover;
          animation: creative-drift 18s ease-in-out infinite;
          will-change: transform;
        }
        .creative-glow {
          background: linear-gradient(115deg, transparent 22%, rgba(34,211,238,.12) 43%, rgba(168,85,247,.16) 54%, transparent 70%);
          filter: blur(22px);
          animation: creative-light 9s ease-in-out infinite;
          will-change: transform, opacity;
        }
        @media (max-width: 639px) {
          .creative-engine { background-position: 61% 22%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .creative-engine, .creative-glow { animation: none; }
        }
      `}</style>
      </div>
    </div>
  );
}
