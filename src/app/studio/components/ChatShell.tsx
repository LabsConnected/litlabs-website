"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import {
  Bot,
  User,
  Brain,
  Sparkles,
  Zap,
  Target,
  Copy,
  Check,
  RefreshCw,
  Menu,
  MoreHorizontal,
  Cpu,
  Rocket,
  Hammer,
  Wand2,
  LayoutGrid,
  Map,
} from "lucide-react";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import ReactMarkdown from "react-markdown";
import MultimodalComposer from "./MultimodalComposer";

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
  onToolChange?: (tool: string) => void;
}

const STARTERS = [
  "Audit this mobile view",
  "Make LiTT smarter",
  "Design inline",
  "Create a motion",
  "Map the idea",
  "Improve the app",
];

const COMPANIONS = [
  { name: "LiT", role: "guide", icon: Bot, color: "#22d3ee" },
  { name: "Forge", role: "build", icon: Hammer, color: "#f97316" },
  { name: "Visionary", role: "design", icon: Sparkles, color: "#a855f7" },
  { name: "Memory", role: "recall", icon: Brain, color: "#34d399" },
];

const MISSION_SUGGESTIONS = [
  { label: "Scan project", icon: Cpu },
  { label: "Start build", icon: Rocket },
  { label: "New agent", icon: Bot },
  { label: "Research", icon: Wand2 },
  { label: "Map workflow", icon: Map },
  { label: "Assets", icon: LayoutGrid },
];

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

function LiTTAvatar({ size = 36 }: { size?: number }) {
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background:
          "radial-gradient(circle at 30% 30%, #0f3d3e 0%, #051a1a 70%)",
        boxShadow:
          "0 0 20px rgba(34,211,238,0.25), inset 0 0 12px rgba(34,211,238,0.15)",
      }}
    >
      <div
        className="absolute inset-0 rounded-full opacity-60"
        style={{
          background:
            "conic-gradient(from 0deg, transparent, rgba(34,211,238,0.3), transparent)",
          animation: "spin 8s linear infinite",
        }}
      />
      <Bot size={size * 0.5} className="relative z-10 text-cyan-300" />
    </div>
  );
}

function UserAvatar({ size = 32 }: { size?: number }) {
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full border"
      style={{
        width: size,
        height: size,
        borderColor: "rgba(249,115,22,0.35)",
        background:
          "radial-gradient(circle at 30% 30%, #3d1f0f 0%, #1a0f08 70%)",
        boxShadow:
          "0 0 16px rgba(249,115,22,0.22), inset 0 0 10px rgba(249,115,22,0.12)",
      }}
    >
      <User size={size * 0.45} className="text-orange-300" />
    </div>
  );
}

export default function ChatShell({
  selectedModel = "adaptive",
  messages,
  busy,
  onSend,
  onNewChat,
  onRegenerate,
  onToolChange,
}: ChatShellProps) {
  const { resolvedColors: T } = useTheme();
  const { profile } = useProfile();
  const { speakText } = useVoiceSession();
  const [input, setInput] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);

  const displayName = useMemo(
    () => profile?.displayName || "Creator",
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

  return (
    <div
      className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#0a0a0f]"
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
            <LiTTAvatar size={34} />
            <div className="hidden flex-col sm:flex">
              <span
                className="text-[11px] font-black leading-tight"
                style={{ color: T.textColor }}
              >
                LiTT Director
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

      {/* Transcript */}
      <main
        ref={transcriptRef}
        className="relative z-10 min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      >
        {isEmpty ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-5">
            {/* Mission HUD */}
            <div className="rounded-2xl border border-white/10 bg-white/3 p-4 backdrop-blur-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target size={14} style={{ color: T.accentColor }} />
                  <span
                    className="text-[10px] font-black uppercase tracking-widest"
                    style={{ color: T.accentColor }}
                  >
                    Mission HUD
                  </span>
                </div>
                <span
                  className="text-[9px] font-mono"
                  style={{ color: T.textMuted }}
                >
                  0 objectives · 4 agents
                </span>
              </div>
              <h2
                className="mb-1 break-words text-sm font-bold"
                style={{ color: T.textColor }}
              >
                Active: {projectName}
              </h2>
              <p
                className="mb-3 text-[10px] leading-relaxed"
                style={{ color: T.textMuted }}
              >
                Build the LiTTree AI command center. Use voice, camera, or text
                to direct agents, generate assets, and deploy updates.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {MISSION_SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => void onSend(s.label)}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/3 px-2.5 py-2 text-[10px] font-bold transition hover:bg-white/5"
                  >
                    <s.icon size={12} style={{ color: T.accentColor }} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Companions */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {COMPANIONS.map((c) => (
                <div
                  key={c.name}
                  className="rounded-xl border border-white/10 bg-white/3 p-2.5"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <c.icon size={15} style={{ color: c.color }} />
                    <b className="text-[11px]">{c.name}</b>
                  </div>
                  <span className="text-[9px]" style={{ color: T.textMuted }}>
                    {c.role}
                  </span>
                </div>
              ))}
            </div>

            {/* Starters */}
            <div className="scrollbar-hide flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1">
              {STARTERS.map((item) => (
                <button
                  key={item}
                  onClick={() => void onSend(item)}
                  className="shrink-0 rounded-full border border-white/10 bg-white/3 px-3 py-2 text-[10px] font-medium transition hover:bg-white/5"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {messages.map((message, index) => {
              const isUser = message.role === "user";
              const isLastAssistant =
                !isUser && index === messages.length - 1 && !busy;
              return (
                <div
                  key={index}
                  className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
                >
                  {isUser ? <UserAvatar size={32} /> : <LiTTAvatar size={36} />}
                  <div
                    className={`flex max-w-[85%] flex-col ${isUser ? "items-end" : "items-start"}`}
                  >
                    <div
                      className="relative overflow-hidden rounded-2xl border px-3.5 py-2.5 text-xs leading-relaxed shadow-sm"
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
            {busy && (
              <div
                className="flex items-center gap-2 text-[10px]"
                style={{ color: T.accentColor }}
              >
                <span className="flex gap-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:0.2s]" />
                </span>
                LiTT is thinking…
              </div>
            )}
          </div>
        )}
      </main>

      {/* Composer */}
      <div className="relative z-20 shrink-0">
        <MultimodalComposer
          value={input}
          onChange={setInput}
          onSend={onSend}
          busy={busy}
          modelName={selectedModel}
          onToolChange={onToolChange}
        />
      </div>

      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
