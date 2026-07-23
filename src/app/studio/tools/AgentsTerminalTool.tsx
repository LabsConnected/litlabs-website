"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Send,
  Trash2,
  Loader2,
  Copy,
  Check,
  Search,
  Monitor,
  Image as ImageIcon,
  Terminal,
  X,
} from "lucide-react";
import { AGENTS } from "@/lib/agents";
import SystemTopologyPanel from "@/components/studio/SystemTopologyPanel";

/* ─── Types ──────────────────────────────────────────────────────────── */
type AgentProfile = (typeof AGENTS)[keyof typeof AGENTS] & {
  color: string;
  desc: string;
  systemPrompt: string;
};

const AGENT_LIST: AgentProfile[] = Object.values(AGENTS).map((agent) => ({
  ...agent,
  color: (agent as AgentProfile).color ?? "#00ffff",
  desc: (agent as AgentProfile).role ?? "Agent",
  systemPrompt: (agent as AgentProfile).systemPrompt ?? "",
}));

const AGENT_COLORS: Record<string, string> = Object.fromEntries(
  AGENT_LIST.map((a) => [a.id, a.color]),
);

type TerminalLine = {
  id: string;
  ts: string;
  agent: string;
  role: "ai" | "user" | "error" | "system";
  content: string;
  imageUrl?: string;
};

type LogEntry = {
  timestamp: string;
  agent: string;
  message: string;
  level: "info" | "warn" | "error" | "success";
};

const STORAGE_KEY = "litlabs-terminal-chat";
const PROVIDER_KEY = "litlabs-terminal-provider";

const PROVIDERS = [
  { id: "gemini", label: "Gemini 2.5 Flash", color: "#ff0080" },
  { id: "openrouter-free", label: "OpenRouter Free", color: "#00ffff" },
];

/* ─── Helpers ─────────────────────────────────────────────────────────── */
function formatTime() {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}

/* ─── Main Component ─────────────────────────────────────────────────── */
export default function AgentsTerminalTool() {
  const { resolvedColors: T } = useTheme();
  const [isMobile, setIsMobile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [lines, setLines] = useState<TerminalLine[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Command history
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState("");

  const [selectedAgentId, setSelectedAgentId] = useState(
    AGENT_LIST[0]?.id ?? "director",
  );
  const [provider, setProvider] = useState(() => {
    if (typeof window === "undefined") return "gemini";
    try {
      return localStorage.getItem(PROVIDER_KEY) || "gemini";
    } catch {
      return "gemini";
    }
  });
  const [crtEnabled, setCrtEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    const crt = localStorage.getItem("crt_global_scanlines");
    return crt === null ? false : crt === "true";
  });
  const [attachedImageUrl, setAttachedImageUrl] = useState("");
  const [showImageInput, setShowImageInput] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState("");

  /* Right panel */
  const [rightTab, setRightTab] = useState<"info" | "logs">("info");
  const [logFilter, setLogFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);

  const selectedAgent =
    AGENT_LIST.find((a) => a.id === selectedAgentId) ?? AGENT_LIST[0];

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 1024);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  /* Persist lines */
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines.slice(-200)));
    } catch {}
  }, [lines]);

  /* Persist provider */
  useEffect(() => {
    try {
      localStorage.setItem(PROVIDER_KEY, provider);
    } catch {}
  }, [provider]);

  /* Auto-scroll terminal */
  useEffect(() => {
    if (autoScroll)
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
  }, [lines, autoScroll]);

  /* Auto-scroll logs */
  useEffect(() => {
    if (autoScroll)
      logRef.current?.scrollTo({
        top: logRef.current.scrollHeight,
        behavior: "smooth",
      });
  }, [liveLogs, autoScroll]);

  /* Poll live logs */
  useEffect(() => {
    if (rightTab !== "logs") return;
    const fetchLogs = async () => {
      try {
        const data = await fetch("/api/agents/logs")
          .then((r) => r.json())
          .catch(() => []);
        if (Array.isArray(data)) setLiveLogs(data);
      } catch {}
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [rightTab]);

  /* Auto-resize textarea */
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }, [input]);

  const appendLine = useCallback((line: TerminalLine) => {
    setLines((prev) => [...prev, line]);
  }, []);

  const addSystemLine = useCallback(
    (content: string) => {
      appendLine({
        id: crypto.randomUUID(),
        ts: formatTime(),
        agent: "SYS",
        role: "system",
        content,
      });
    },
    [appendLine],
  );

  const sendMessage = useCallback(
    async (text?: string) => {
      const content = (text || input).trim();
      if (!content && !attachedImageUrl) return;
      if (isLoading) return;

      const finalText =
        content + (attachedImageUrl ? `\n[Image: ${attachedImageUrl}]` : "");
      const userId = crypto.randomUUID();
      const userLine: TerminalLine = {
        id: userId,
        ts: formatTime(),
        agent: "you",
        role: "user",
        content: finalText,
        imageUrl: attachedImageUrl || undefined,
      };
      appendLine(userLine);

      // Save to command history
      if (content && !content.startsWith("/")) {
        setCommandHistory((prev) => [content, ...prev].slice(0, 50));
        setHistoryIndex(-1);
      }

      setInput("");
      setTempInput("");
      setAttachedImageUrl("");
      setShowImageInput(false);
      setImageUrlInput("");
      setIsLoading(true);
      setStreaming(true);

      const aiId = crypto.randomUUID();
      appendLine({
        id: aiId,
        ts: formatTime(),
        agent: selectedAgent.name,
        role: "ai",
        content: "",
      });

      try {
        const history = lines
          .filter((l) => l.id !== aiId)
          .map((l) => ({
            role: l.role === "user" ? "user" : "assistant",
            content: l.content,
          }));

        const res = await fetch("/api/gemini/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentSlug: selectedAgent.id,
            provider,
            stream: true,
            history,
            systemPrompt: selectedAgent.systemPrompt,
          }),
        });

        if (!res.ok) throw new Error("API error");

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const segments = buffer.split("\n\n");
            buffer = segments.pop() ?? "";
            for (const seg of segments) {
              const trimmed = seg.trim();
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.replace(/^data:\s*/, "");
              if (payload === "[DONE]") continue;
              try {
                const parsed = JSON.parse(payload);
                if (parsed.text) {
                  fullText += parsed.text;
                  setLines((prev) =>
                    prev.map((l) =>
                      l.id === aiId ? { ...l, content: fullText } : l,
                    ),
                  );
                }
              } catch {}
            }
          }
        }

        setLines((prev) =>
          prev.map((l) =>
            l.id === aiId ? { ...l, content: fullText || "No response." } : l,
          ),
        );

        addSystemLine(`[${selectedAgent.name}] Response complete.`);
      } catch {
        setLines((prev) =>
          prev.map((l) =>
            l.id === aiId
              ? {
                  ...l,
                  content: "⚠️ Connection error. Check API configuration.",
                  role: "error",
                }
              : l,
          ),
        );
      }

      setStreaming(false);
      setIsLoading(false);
    },
    [
      input,
      attachedImageUrl,
      isLoading,
      lines,
      selectedAgent,
      provider,
      appendLine,
      addSystemLine,
    ],
  );

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
      return;
    }

    // Command history navigation
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyIndex === -1 && input.trim()) {
        setTempInput(input);
      }
      if (historyIndex < commandHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput(tempInput);
      }
      return;
    }

    // Clear history index on any other key
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      if (historyIndex !== -1) {
        setHistoryIndex(-1);
        setTempInput("");
      }
    }
  };

  const clearChat = () => {
    setLines([]);
  };

  const attachImage = () => {
    if (imageUrlInput.trim()) {
      setAttachedImageUrl(imageUrlInput.trim());
      setShowImageInput(false);
      setImageUrlInput("");
    }
  };

  const copyLogs = () => {
    navigator.clipboard.writeText(
      filteredLogs
        .map((l) => `[${l.timestamp}] [${l.agent}] ${l.message}`)
        .join("\n"),
    );
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  const filteredLogs = liveLogs.filter(
    (l) =>
      !logFilter ||
      l.message.toLowerCase().includes(logFilter.toLowerCase()) ||
      l.agent.toLowerCase().includes(logFilter.toLowerCase()),
  );

  const providerConfig =
    PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];
  const providerLabel =
    provider === "gemini" ? "Gemini 2.5 Flash" : providerConfig.label;

  const crtStyle = {
    background:
      "repeating-linear-gradient(0deg, rgba(0,0,0,0.12), rgba(0,0,0,0.12) 1px, transparent 1px, transparent 2px)",
    boxShadow: "inset 0 0 100px rgba(0,255,0,0.08)",
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden select-none relative">
      <SystemTopologyPanel compact />
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row overflow-hidden relative">
        {/* CRT overlay */}
        {crtEnabled && (
          <div
            className="fixed inset-0 pointer-events-none z-30 opacity-[0.04]"
            style={crtStyle}
          />
        )}

        {/* ── LEFT: Agent List - Terminal Sidebar ── */}
        <div
          className={`w-full lg:w-[240px] shrink-0 flex flex-col border-r ${isMobile ? "hidden" : "lg:flex"}`}
          style={{
            borderColor: T.borderColor + "20",
            backgroundColor: "#1a1a1a",
          }}
        >
          {/* Header */}
          <div
            className="px-3 py-2 border-b flex items-center justify-between"
            style={{ borderColor: T.borderColor + "20" }}
          >
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: T.accentColor }}
              >
                Agent Shell
              </span>
            </div>
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: T.accentColor + "15",
                color: T.accentColor,
                border: `1px solid ${T.accentColor}30`,
              }}
            >
              {AGENT_LIST.length} agents
            </span>
          </div>

          {/* Agent list */}
          <div className="flex-1 overflow-y-auto py-1">
            {AGENT_LIST.map((agent, idx) => {
              const isActive = selectedAgentId === agent.id;
              return (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className="w-full text-left px-3 py-2 transition-all group border-l-2"
                  style={{
                    backgroundColor: isActive
                      ? agent.color + "08"
                      : "transparent",
                    borderLeftColor: isActive ? agent.color : "transparent",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[9px] font-mono w-4 shrink-0"
                      style={{ color: T.textMuted + "60" }}
                    >
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor: agent.color,
                        boxShadow: isActive ? `0 0 6px ${agent.color}` : "none",
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[11px] font-bold truncate"
                        style={{ color: isActive ? agent.color : T.textColor }}
                      >
                        {agent.name}
                      </div>
                      <div
                        className="text-[9px] truncate"
                        style={{
                          color: isActive ? T.textMuted : T.textMuted + "60",
                        }}
                      >
                        {agent.role}
                      </div>
                    </div>
                    {isActive && <span style={{ color: agent.color }}>▶</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Quick commands footer */}
          <div
            className="border-t px-3 py-2 space-y-1"
            style={{ borderColor: T.borderColor + "20" }}
          >
            <div
              className="text-[9px] font-mono"
              style={{ color: T.textMuted + "60" }}
            >
              Quick commands:
            </div>
            <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
              <span style={{ color: T.accentColor }}>/help</span>
              <span style={{ color: T.textMuted + "60" }}>show help</span>
              <span style={{ color: T.accentColor }}>/clear</span>
              <span style={{ color: T.textMuted + "60" }}>clear chat</span>
              <span style={{ color: T.accentColor }}>/image</span>
              <span style={{ color: T.textMuted + "60" }}>gen image</span>
            </div>
          </div>

          {/* Stats footer */}
          <div
            className="border-t px-3 py-2 text-[9px] font-mono grid grid-cols-2 gap-2"
            style={{ borderColor: T.borderColor + "20", color: T.textMuted }}
          >
            <div>
              <span style={{ color: T.textMuted + "40" }}>Lines:</span>
              <br />
              <span style={{ color: T.accentColor }}>{lines.length}</span>
            </div>
            <div>
              <span className="opacity-50">Model</span>
              <br />
              <span style={{ color: providerConfig.color }}>
                {providerConfig.label.split(" ")[0]}
              </span>
            </div>
          </div>
        </div>

        {/* ── CENTER: Terminal ── */}
        <div
          className="flex-1 flex flex-col min-w-0 min-h-0"
          style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
        >
          {/* Top controls bar - Terminal title bar style */}
          <div
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b shrink-0"
            style={{
              borderColor: T.borderColor + "20",
              backgroundColor: "#1a1a1a",
            }}
          >
            <div className="flex items-center gap-3 min-w-0 flex-wrap">
              {/* Window controls */}
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#27ca40]" />
              </div>

              <div
                className="w-px h-4 mx-1"
                style={{ backgroundColor: T.borderColor + "30" }}
              />

              {/* Terminal icon */}
              <Terminal size={12} style={{ color: selectedAgent.color }} />
              <span
                className="text-[10px] sm:text-[11px] font-bold truncate max-w-[110px] sm:max-w-none"
                style={{ color: T.textColor }}
              >
                {selectedAgent.name}
              </span>
              <span
                className="text-[8px] px-1.5 py-0.5 rounded font-mono"
                style={{
                  background: selectedAgent.color + "15",
                  color: selectedAgent.color,
                  border: `1px solid ${selectedAgent.color}30`,
                }}
              >
                {selectedAgent.role}
              </span>

              {streaming && (
                <span
                  className="flex items-center gap-1 text-[8px] font-mono px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: "#22c55e20",
                    color: "#22c55e",
                    border: "1px solid #22c55e40",
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  Processing...
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              {/* Provider selector */}
              <button
                type="button"
                onClick={() =>
                  setProvider((prev) =>
                    prev === "gemini" ? "openrouter-free" : "gemini",
                  )
                }
                className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-[9px] font-mono transition-all max-w-full"
                style={{
                  backgroundColor: T.boxBg,
                  borderColor: providerConfig.color + "30",
                  color: providerConfig.color,
                }}
                title="Toggle provider"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor: providerConfig.color,
                    boxShadow: `0 0 8px ${providerConfig.color}`,
                  }}
                />
                <span
                  className="hidden sm:inline"
                  style={{ color: T.textMuted }}
                >
                  Model
                </span>
                <span className="font-bold truncate max-w-[120px]">
                  {providerLabel}
                </span>
                <span style={{ color: T.textMuted }}>▾</span>
              </button>

              {/* CRT toggle */}
              <button
                onClick={() => {
                  const next = !crtEnabled;
                  setCrtEnabled(next);
                  localStorage.setItem("crt_global_scanlines", String(next));
                }}
                className="flex items-center gap-1 text-[9px] px-2 py-1 rounded transition-all shrink-0"
                style={{
                  backgroundColor: crtEnabled ? T.accentColor + "15" : T.boxBg,
                  border: `1px solid ${crtEnabled ? T.accentColor + "30" : T.borderColor + "20"}`,
                  color: crtEnabled ? T.accentColor : T.textMuted,
                }}
              >
                <Monitor size={10} />
                <span className="hidden sm:inline">CRT</span>
              </button>

              {/* Clear */}
              <button
                onClick={clearChat}
                className="flex items-center gap-1 text-[9px] px-2 py-1 rounded transition-all hover:bg-red-500/10 shrink-0"
                style={{
                  border: `1px solid ${T.borderColor + "20"}`,
                  color: T.textMuted,
                }}
              >
                <Trash2 size={10} />
                <span className="hidden sm:inline">Clear</span>
              </button>
            </div>
          </div>

          {/* Terminal scrollback - PowerShell style */}
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1 font-mono text-[11px] leading-relaxed"
            style={{ backgroundColor: "#0c0c0c" }}
          >
            {lines.length === 0 && !streaming && (
              <div
                className="flex flex-col items-center justify-center h-full text-center"
                style={{ color: T.textMuted + "60" }}
              >
                <div className="text-center space-y-2">
                  <div
                    className="text-[12px] font-bold"
                    style={{ color: T.accentColor }}
                  >
                    LiTTree-LabStudios Terminal
                  </div>
                  <div className="text-[10px] opacity-60">
                    Copyright (c) LiTTree-LabStudios. All rights reserved.
                  </div>
                  <div className="mt-4 text-[10px] opacity-40">
                    Connected to{" "}
                    <span style={{ color: selectedAgent.color }}>
                      {selectedAgent.name}
                    </span>
                  </div>
                  <div className="text-[9px] opacity-30 mt-2">
                    Try: <span className="text-cyan-400">/help</span> for
                    commands
                  </div>
                </div>
              </div>
            )}

            {lines.map((line) => (
              <div key={line.id} className="group">
                {/* User input - PowerShell style prompt */}
                {line.role === "user" ? (
                  <div className="flex items-start gap-1 flex-wrap">
                    <span
                      className="shrink-0 font-bold"
                      style={{ color: "#00a2ed" }}
                    >
                      PS
                    </span>
                    <span
                      className="whitespace-nowrap"
                      style={{ color: T.textMuted + "80" }}
                    >
                      [{line.ts}] {selectedAgent.name}&gt;
                    </span>
                    <div className="flex-1" style={{ color: T.textColor }}>
                      {line.content.split("\n").map((text, i) => (
                        <div key={i}>{text}</div>
                      ))}
                      {line.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={line.imageUrl}
                          alt="attachment"
                          className="mt-2 max-h-32 rounded border inline-block"
                          style={{ borderColor: T.borderColor + "30" }}
                        />
                      )}
                    </div>
                  </div>
                ) : line.role === "error" ? (
                  <div className="flex items-start gap-1 pl-4">
                    <span style={{ color: "#ff6b6b" }}>ERR:</span>
                    <span style={{ color: "#ff6b6b" }}>{line.content}</span>
                  </div>
                ) : line.role === "system" ? (
                  <div className="flex items-start gap-1 pl-4 opacity-50">
                    <span style={{ color: T.textMuted }}># {line.content}</span>
                  </div>
                ) : (
                  /* AI Response */
                  <div className="flex items-start gap-1 pl-4">
                    <span style={{ color: selectedAgent.color + "80" }}>
                      &lt;
                    </span>
                    <span
                      className="flex-1 whitespace-pre-wrap"
                      style={{ color: T.textColor }}
                    >
                      {line.content}
                    </span>
                  </div>
                )}
              </div>
            ))}

            {/* Current streaming response */}
            {streaming && (
              <div className="flex items-start gap-1 pl-4 flex-wrap">
                <span style={{ color: selectedAgent.color + "80" }}>&lt;</span>
                <span
                  className="animate-pulse"
                  style={{ color: selectedAgent.color }}
                >
                  ▊
                </span>
              </div>
            )}

            {/* Spacer for input visibility */}
            <div className="h-2" />
          </div>

          {/* Image attachment preview */}
          {attachedImageUrl && (
            <div className="px-3 pb-1">
              <div className="flex items-center gap-2 flex-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachedImageUrl}
                  alt="attached"
                  className="h-12 rounded border"
                  style={{ borderColor: T.borderColor + "30" }}
                />
                <button
                  onClick={() => setAttachedImageUrl("")}
                  className="text-[8px] opacity-50 hover:opacity-100"
                  style={{ color: T.textMuted }}
                >
                  <X size={10} />
                </button>
              </div>
            </div>
          )}

          {/* Bottom input bar - PowerShell style */}
          <div
            className="px-3 py-2 border-t shrink-0"
            style={{
              borderColor: T.borderColor + "15",
              backgroundColor: "#0c0c0c",
            }}
          >
            {/* Image URL input */}
            {showImageInput && (
              <div className="flex gap-1.5 mb-2 flex-wrap">
                <span
                  className="shrink-0 text-[10px] py-1"
                  style={{ color: "#00a2ed" }}
                >
                  PS Image&gt;
                </span>
                <input
                  value={imageUrlInput}
                  onChange={(e) => setImageUrlInput(e.target.value)}
                  placeholder="Paste image URL..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") attachImage();
                    if (e.key === "Escape") setShowImageInput(false);
                  }}
                  className="min-w-0 flex-1 px-2 py-1 text-[11px] outline-none font-mono"
                  style={{
                    backgroundColor: "transparent",
                    border: `1px solid ${T.borderColor}30`,
                    color: T.textColor,
                  }}
                  autoFocus
                />
                <button
                  onClick={attachImage}
                  className="px-2 py-1 text-[9px] font-bold shrink-0"
                  style={{
                    color: T.accentColor,
                  }}
                >
                  [Attach]
                </button>
                <button
                  onClick={() => setShowImageInput(false)}
                  className="px-1 opacity-50"
                >
                  <X size={10} style={{ color: T.textMuted }} />
                </button>
              </div>
            )}

            {attachedImageUrl && (
              <div className="flex items-center gap-2 mb-2 px-1 flex-wrap">
                <span style={{ color: T.textMuted + "60" }}>📎 Attached:</span>
                <span
                  className="text-[10px] truncate max-w-[200px]"
                  style={{ color: T.accentColor }}
                >
                  {attachedImageUrl}
                </span>
                <button
                  onClick={() => setAttachedImageUrl("")}
                  className="text-[9px] opacity-50 hover:opacity-100"
                  style={{ color: "#ff6b6b" }}
                >
                  [Remove]
                </button>
              </div>
            )}

            {/* PowerShell-style input line */}
            <div className="flex gap-2 items-start flex-wrap">
              {/* PowerShell prompt */}
              <div className="shrink-0 pt-1 select-none whitespace-nowrap">
                <span className="font-bold" style={{ color: "#00a2ed" }}>
                  PS
                </span>
                <span style={{ color: T.textMuted + "80" }}>
                  {" "}
                  [{formatTime()}] {selectedAgent.name}&gt;
                </span>
              </div>

              {/* Input area */}
              <div className="flex-1 min-w-0 flex gap-2 items-start">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder={`Type message or /help...`}
                  rows={1}
                  disabled={isLoading}
                  className="min-w-0 flex-1 py-1 text-[11px] outline-none resize-none overflow-hidden font-mono disabled:opacity-40 bg-transparent"
                  style={{
                    color: T.textColor,
                    minHeight: "22px",
                    maxHeight: "140px",
                  }}
                />

                {/* Quick actions */}
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => setShowImageInput((v) => !v)}
                    className="p-1.5 transition-all hover:opacity-80"
                    style={{
                      color: showImageInput
                        ? T.accentColor
                        : T.textMuted + "60",
                    }}
                    title="Attach image (Ctrl+I)"
                  >
                    <ImageIcon size={14} />
                  </button>

                  <button
                    onClick={() => sendMessage()}
                    disabled={(!input.trim() && !attachedImageUrl) || isLoading}
                    className="p-1.5 transition-all hover:opacity-80 disabled:opacity-20"
                    style={{
                      color: selectedAgent.color,
                    }}
                    title="Send (Enter)"
                  >
                    {streaming ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Send size={14} />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Status bar */}
            <div
              className="flex flex-wrap items-center justify-between gap-2 mt-2 px-0.5 text-[9px]"
              style={{ color: T.textMuted + "40" }}
            >
              <div className="flex flex-wrap gap-3">
                <span>{providerLabel}</span>
                <span>↑↓ History</span>
                <span>Shift+Enter Newline</span>
                {input.length > 0 && <span>{input.length} chars</span>}
              </div>
              {commandHistory.length > 0 && (
                <span className="font-mono">
                  History: {commandHistory.length}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Info + Logs ── */}
        <div
          className={`w-full lg:w-[270px] shrink-0 flex flex-col border-l ${isMobile ? "hidden" : "lg:flex"}`}
          style={{
            borderColor: T.borderColor + "20",
            backgroundColor: T.boxBg + "90",
          }}
        >
          {/* Tabs */}
          <div
            className="flex border-b shrink-0"
            style={{ borderColor: T.borderColor + "15" }}
          >
            {(["info", "logs"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                className="flex-1 py-2 text-[9px] font-bold uppercase tracking-wider transition-all"
                style={{
                  backgroundColor:
                    rightTab === tab ? T.accentColor + "10" : "transparent",
                  color: rightTab === tab ? T.accentColor : T.textMuted,
                  borderBottom:
                    rightTab === tab
                      ? `2px solid ${T.accentColor}`
                      : "2px solid transparent",
                }}
              >
                {tab === "info" ? "Agent Info" : "Live Logs"}
              </button>
            ))}
          </div>

          {rightTab === "info" ? (
            /* ── Agent Info ── */
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {/* Agent hero */}
              <div
                className="text-center py-2 rounded-lg"
                style={{
                  background: selectedAgent.color + "08",
                  border: `1px solid ${selectedAgent.color}20`,
                }}
              >
                <div className="text-3xl mb-1">
                  {selectedAgent.name.charAt(0)}
                </div>
                <div
                  className="text-[11px] font-bold"
                  style={{ color: selectedAgent.color }}
                >
                  {selectedAgent.name}
                </div>
                <div
                  className="text-[9px] opacity-60 mt-0.5"
                  style={{ color: T.textMuted }}
                >
                  {selectedAgent.role}
                </div>
                <div className="flex items-center justify-center gap-1 mt-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ backgroundColor: selectedAgent.color }}
                  />
                  <span
                    className="text-[9px] font-mono"
                    style={{ color: selectedAgent.color }}
                  >
                    Online
                  </span>
                </div>
              </div>

              {/* Description */}
              <div>
                <div
                  className="text-[8px] font-bold uppercase tracking-widest mb-1"
                  style={{ color: T.accentColor }}
                >
                  Description
                </div>
                <p
                  className="text-[10px] leading-relaxed opacity-70"
                  style={{ color: T.textColor }}
                >
                  {selectedAgent.desc}
                </p>
              </div>

              {/* System Prompt */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div
                    className="text-[8px] font-bold uppercase tracking-widest"
                    style={{ color: T.accentColor }}
                  >
                    System Prompt
                  </div>
                </div>
                <div
                  className="rounded p-2 text-[9px] font-mono leading-relaxed"
                  style={{
                    background: "rgba(0,0,0,0.4)",
                    border: `1px solid ${T.borderColor}15`,
                    color: T.textMuted,
                    maxHeight: "200px",
                    overflowY: "auto",
                  }}
                >
                  {selectedAgent.systemPrompt || "(no system prompt)"}
                </div>
              </div>

              {/* Stats */}
              <div
                className="rounded-lg p-2.5 space-y-1.5"
                style={{
                  background: "rgba(0,0,0,0.3)",
                  border: `1px solid ${T.borderColor}15`,
                }}
              >
                <div className="flex justify-between text-[9px] font-mono">
                  <span style={{ color: T.textMuted }}>Lines</span>
                  <span style={{ color: selectedAgent.color }}>
                    {lines.length}
                  </span>
                </div>
                <div className="flex justify-between text-[9px] font-mono">
                  <span style={{ color: T.textMuted }}>Provider</span>
                  <span style={{ color: providerConfig.color }}>
                    {providerConfig.label}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* ── Live Logs ── */
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Log controls */}
              <div
                className="px-2 py-1.5 border-b space-y-1.5 shrink-0"
                style={{ borderColor: T.borderColor + "10" }}
              >
                <div
                  className="flex items-center gap-1.5"
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    borderRadius: "6px",
                    padding: "3px 8px",
                    border: `1px solid ${T.borderColor}15`,
                  }}
                >
                  <Search
                    size={9}
                    style={{ color: T.textMuted, opacity: 0.5 }}
                  />
                  <input
                    value={logFilter}
                    onChange={(e) => setLogFilter(e.target.value)}
                    placeholder="Filter logs..."
                    className="flex-1 bg-transparent outline-none text-[9px] font-mono"
                    style={{ color: T.textColor }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAutoScroll((v) => !v)}
                    className="text-[8px] px-1.5 py-0.5 rounded border font-bold transition-all"
                    style={{
                      borderColor: autoScroll
                        ? T.accentColor + "40"
                        : T.borderColor + "20",
                      color: autoScroll ? T.accentColor : T.textMuted,
                      background: autoScroll
                        ? T.accentColor + "10"
                        : "transparent",
                    }}
                  >
                    AUTO
                  </button>
                  <button
                    onClick={copyLogs}
                    className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded border opacity-60 hover:opacity-100 transition-all"
                    style={{
                      borderColor: T.borderColor + "20",
                      color: T.textMuted,
                    }}
                  >
                    {copiedLogs ? (
                      <Check size={9} className="text-green-400" />
                    ) : (
                      <Copy size={9} />
                    )}{" "}
                    Copy
                  </button>
                  <span
                    className="text-[8px] font-mono ml-auto"
                    style={{ color: T.textMuted }}
                  >
                    {filteredLogs.length} entries
                  </span>
                </div>
              </div>

              {/* Log entries */}
              <div
                ref={logRef}
                className="flex-1 overflow-y-auto p-2 font-mono text-[9px] space-y-0.5"
              >
                {filteredLogs.length > 0 ? (
                  filteredLogs.map((l, i) => {
                    const levelColor: Record<string, string> = {
                      error: "#f87171",
                      warn: "#facc15",
                      success: "#4ade80",
                      info: "#94a3b8",
                    };
                    return (
                      <div
                        key={i}
                        className="flex gap-1.5 px-1 py-0.5 rounded hover:bg-white/5 transition-colors"
                      >
                        <span
                          className="shrink-0 opacity-40"
                          style={{ color: T.textMuted }}
                        >
                          [{l.timestamp}]
                        </span>
                        <span
                          className="shrink-0 font-bold"
                          style={{ color: AGENT_COLORS[l.agent] ?? "#f97316" }}
                        >
                          [{l.agent}]
                        </span>
                        <span
                          className="leading-relaxed"
                          style={{ color: levelColor[l.level] ?? T.textColor }}
                        >
                          {l.message}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12">
                    <div className="text-xl mb-2 opacity-30">📡</div>
                    <div
                      className="opacity-30 text-[9px]"
                      style={{ color: T.textMuted }}
                    >
                      {logFilter
                        ? "No matching logs"
                        : "Waiting for agent activity..."}
                    </div>
                    <div className="mt-3 flex gap-1">
                      {[...Array(3)].map((_, i) => (
                        <span
                          key={i}
                          className="w-1 h-1 rounded-full bg-green-400 animate-pulse"
                          style={{ animationDelay: `${i * 0.3}s` }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
