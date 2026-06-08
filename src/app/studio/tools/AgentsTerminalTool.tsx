"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Send, Trash2, Loader2, Copy, Check, Search, Monitor,
  ChevronDown, ChevronUp, Image as ImageIcon, Terminal, X, Zap
} from "lucide-react";
import { AGENTS } from "@/lib/agents";

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
  AGENT_LIST.map((a) => [a.id, a.color])
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
  { id: "gemini",        label: "Gemini 2.5 Flash", color: "#ff0080" },
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [selectedAgentId, setSelectedAgentId] = useState(AGENT_LIST[0]?.id ?? "director");
  const [provider, setProvider] = useState(() => {
    try { return localStorage.getItem(PROVIDER_KEY) || "gemini"; } catch { return "gemini"; }
  });
  const [crtEnabled, setCrtEnabled] = useState(false);
  const [attachedImageUrl, setAttachedImageUrl] = useState("");
  const [showImageInput, setShowImageInput] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState("");

  /* Right panel */
  const [rightTab, setRightTab] = useState<"info" | "logs">("info");
  const [logFilter, setLogFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);
  const [logPolling, setLogPolling] = useState(false);

  const selectedAgent = AGENT_LIST.find((a) => a.id === selectedAgentId) ?? AGENT_LIST[0];

  /* Load CRT & chat history */
  useEffect(() => {
    try {
      const crt = localStorage.getItem("crt_global_scanlines");
      if (crt !== null) setCrtEnabled(crt === "true");
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLines(JSON.parse(raw));
    } catch {}
  }, []);

  /* Persist lines */
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lines.slice(-200))); } catch {}
  }, [lines]);

  /* Persist provider */
  useEffect(() => {
    try { localStorage.setItem(PROVIDER_KEY, provider); } catch {}
  }, [provider]);

  /* Auto-scroll terminal */
  useEffect(() => {
    if (autoScroll) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, autoScroll]);

  /* Auto-scroll logs */
  useEffect(() => {
    if (autoScroll) logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [liveLogs, autoScroll]);

  /* Poll live logs */
  useEffect(() => {
    if (rightTab !== "logs") return;
    const fetchLogs = async () => {
      try {
        const data = await fetch("/api/agents/logs").then((r) => r.json()).catch(() => []);
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

  const addSystemLine = useCallback((content: string) => {
    appendLine({ id: crypto.randomUUID(), ts: formatTime(), agent: "SYS", role: "system", content });
  }, [appendLine]);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text || input).trim();
    if (!content && !attachedImageUrl) return;
    if (isLoading) return;

    const finalText = content + (attachedImageUrl ? `\n[Image: ${attachedImageUrl}]` : "");
    const userId = crypto.randomUUID();
    const userLine: TerminalLine = {
      id: userId, ts: formatTime(), agent: "you",
      role: "user", content: finalText,
      imageUrl: attachedImageUrl || undefined,
    };
    appendLine(userLine);
    setInput("");
    setAttachedImageUrl("");
    setShowImageInput(false);
    setImageUrlInput("");
    setIsLoading(true);
    setStreaming(true);

    const aiId = crypto.randomUUID();
    appendLine({ id: aiId, ts: formatTime(), agent: selectedAgent.name, role: "ai", content: "" });

    try {
      const history = lines
        .filter((l) => l.id !== aiId)
        .map((l) => ({ role: l.role === "user" ? "user" : "assistant", content: l.content }));

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
                  prev.map((l) => l.id === aiId ? { ...l, content: fullText } : l)
                );
              }
            } catch {}
          }
        }
      }

      setLines((prev) =>
        prev.map((l) => l.id === aiId ? { ...l, content: fullText || "No response." } : l)
      );

      addSystemLine(`[${selectedAgent.name}] Response complete.`);
    } catch (err) {
      setLines((prev) =>
        prev.map((l) => l.id === aiId ? { ...l, content: "⚠️ Connection error. Check API configuration.", role: "error" } : l)
      );
    }

    setStreaming(false);
    setIsLoading(false);
  }, [input, attachedImageUrl, isLoading, lines, selectedAgent, provider, appendLine, addSystemLine]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const clearChat = () => { setLines([]); };

  const attachImage = () => {
    if (imageUrlInput.trim()) {
      setAttachedImageUrl(imageUrlInput.trim());
      setShowImageInput(false);
      setImageUrlInput("");
    }
  };

  const copyLogs = () => {
    navigator.clipboard.writeText(
      filteredLogs.map((l) => `[${l.timestamp}] [${l.agent}] ${l.message}`).join("\n")
    );
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  const filteredLogs = liveLogs.filter((l) =>
    !logFilter || l.message.toLowerCase().includes(logFilter.toLowerCase()) || l.agent.toLowerCase().includes(logFilter.toLowerCase())
  );

  const providerConfig = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

  const crtStyle = {
    background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.12), rgba(0,0,0,0.12) 1px, transparent 1px, transparent 2px)",
    boxShadow: "inset 0 0 100px rgba(0,255,0,0.08)",
  };

  return (
    <div className="flex h-full overflow-hidden select-none relative">
      {/* CRT overlay */}
      {crtEnabled && (
        <div className="fixed inset-0 pointer-events-none z-30 opacity-[0.04]" style={crtStyle} />
      )}

      {/* ── LEFT: Agent List ── */}
      <div className="w-[220px] shrink-0 flex flex-col border-r" style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "90" }}>
        {/* Header */}
        <div className="px-3 py-2.5 border-b flex items-center justify-between" style={{ borderColor: T.borderColor + "15" }}>
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.accentColor }}>
            Agents
          </span>
          <span className="text-[9px] font-mono px-1 rounded" style={{ background: T.accentColor + "20", color: T.accentColor }}>
            {AGENT_LIST.length}
          </span>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {AGENT_LIST.map((agent) => {
            const isActive = selectedAgentId === agent.id;
            return (
              <button key={agent.id} onClick={() => setSelectedAgentId(agent.id)}
                className="w-full text-left rounded-lg px-2.5 py-2 transition-all group"
                style={{
                  backgroundColor: isActive ? agent.color + "12" : "transparent",
                  border: `1px solid ${isActive ? agent.color + "35" : "transparent"}`,
                  boxShadow: isActive ? `0 0 12px ${agent.color}15` : "none",
                }}>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded flex items-center justify-center text-[10px] shrink-0"
                    style={{ backgroundColor: agent.color + "20", border: `1px solid ${agent.color}30`, color: agent.color }}>
                    {agent.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold truncate" style={{ color: isActive ? agent.color : T.textColor }}>
                      {agent.name}
                    </div>
                    <div className="text-[8px] truncate" style={{ color: T.textMuted }}>{agent.role}</div>
                  </div>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{
                    backgroundColor: agent.color,
                    boxShadow: `0 0 4px ${agent.color}`,
                    opacity: isActive ? 1 : 0.3,
                  }} />
                </div>
              </button>
            );
          })}
        </div>

        {/* Stats footer */}
        <div className="border-t px-3 py-2 text-[9px] font-mono grid grid-cols-2 gap-1" style={{ borderColor: T.borderColor + "15", color: T.textMuted }}>
          <div><span className="opacity-50">Lines</span><br /><span style={{ color: T.accentColor }}>{lines.length}</span></div>
          <div><span className="opacity-50">Model</span><br /><span style={{ color: providerConfig.color }}>{providerConfig.label.split(" ")[0]}</span></div>
        </div>
      </div>

      {/* ── CENTER: Terminal ── */}
      <div className="flex-1 flex flex-col min-w-0" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
        {/* Top controls bar */}
        <div className="flex items-center justify-between px-3 h-10 border-b shrink-0" style={{ borderColor: T.borderColor + "15", backgroundColor: T.boxBg + "60" }}>
          <div className="flex items-center gap-2">
            {/* Terminal icon */}
            <Terminal size={12} style={{ color: T.accentColor }} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.accentColor }}>
              {selectedAgent.name}
            </span>
            <span className="text-[8px] px-1.5 py-0.5 rounded font-mono" style={{ background: selectedAgent.color + "20", color: selectedAgent.color }}>
              {selectedAgent.role}
            </span>
            {streaming && (
              <span className="flex items-center gap-1 text-[8px] font-mono" style={{ color: "#4ade80" }}>
                <span className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />STREAMING
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Provider toggles */}
            {PROVIDERS.map((p) => (
              <button key={p.id} onClick={() => setProvider(p.id)}
                className="text-[8px] font-bold px-2 py-0.5 rounded transition-all"
                style={{
                  backgroundColor: provider === p.id ? p.color + "20" : "transparent",
                  border: `1px solid ${provider === p.id ? p.color + "50" : T.borderColor + "20"}`,
                  color: provider === p.id ? p.color : T.textMuted,
                }}>
                {p.label}
              </button>
            ))}

            {/* Model badge */}
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: providerConfig.color + "15", color: providerConfig.color }}>
              {providerConfig.label}
            </span>

            {/* CRT toggle */}
            <button onClick={() => {
              const next = !crtEnabled;
              setCrtEnabled(next);
              localStorage.setItem("crt_global_scanlines", String(next));
            }}
              className="flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded transition-all"
              style={{
                backgroundColor: crtEnabled ? T.accentColor + "12" : "transparent",
                border: `1px solid ${crtEnabled ? T.accentColor + "30" : T.borderColor + "15"}`,
                color: crtEnabled ? T.accentColor : T.textMuted,
              }}>
              <Monitor size={9} /> CRT
            </button>

            {/* Clear */}
            <button onClick={clearChat}
              className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded opacity-50 hover:opacity-100 transition-all"
              style={{ border: `1px solid ${T.borderColor + "20"}`, color: T.textMuted }}>
              <Trash2 size={9} /> Clear
            </button>
          </div>
        </div>

        {/* Terminal scrollback */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-0.5 font-mono text-[10px] leading-relaxed">
          {lines.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center h-full text-center opacity-40" style={{ color: T.textMuted }}>
              <Terminal size={28} className="mb-2 opacity-50" />
              <div className="text-[10px]">Connected to {selectedAgent.name}</div>
              <div className="text-[9px] mt-1">Type a message to start...</div>
            </div>
          )}

          {lines.map((line) => (
            <div key={line.id} className="flex gap-2 py-0.5">
              {/* Timestamp */}
              <span className="shrink-0 opacity-40" style={{ color: T.textMuted }}>
                [{line.ts}]
              </span>
              {/* Agent badge */}
              <span
                className="shrink-0 font-bold"
                style={{ color: AGENT_COLORS[line.agent] ?? (line.role === "user" ? T.accentColor : line.role === "error" ? "#f87171" : "#94a3b8") }}
              >
                [{line.agent}]
              </span>
              {/* Content */}
              {line.role === "user" ? (
                <div className="flex-1 text-right" style={{ color: T.accentColor }}>
                  {line.content}
                  {line.imageUrl && (
                    <img src={line.imageUrl} alt="attachment" className="mt-1 max-h-24 rounded border inline-block" style={{ borderColor: T.borderColor + "30" }} />
                  )}
                </div>
              ) : line.role === "error" ? (
                <span style={{ color: "#f87171" }}>{line.content}</span>
              ) : line.role === "system" ? (
                <span className="italic opacity-50" style={{ color: T.textMuted }}>{line.content}</span>
              ) : (
                <span className="flex-1" style={{ color: selectedAgent.color }}>{line.content}</span>
              )}
            </div>
          ))}

          {streaming && (
            <div className="flex gap-2 py-0.5">
              <span className="shrink-0 opacity-40" style={{ color: T.textMuted }}>[{formatTime()}]</span>
              <span className="shrink-0 font-bold animate-pulse" style={{ color: selectedAgent.color }}>[{selectedAgent.name}]</span>
              <span style={{ color: selectedAgent.color }}>▊</span>
            </div>
          )}
        </div>

        {/* Image attachment preview */}
        {attachedImageUrl && (
          <div className="px-3 pb-1">
            <div className="flex items-center gap-2">
              <img src={attachedImageUrl} alt="attached" className="h-12 rounded border" style={{ borderColor: T.borderColor + "30" }} />
              <button onClick={() => setAttachedImageUrl("")}
                className="text-[8px] opacity-50 hover:opacity-100" style={{ color: T.textMuted }}>
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* Bottom input bar */}
        <div className="px-3 py-2 border-t shrink-0" style={{ borderColor: T.borderColor + "15", backgroundColor: T.boxBg + "40" }}>
          {/* Image URL input */}
          {showImageInput && (
            <div className="flex gap-1.5 mb-2">
              <input
                value={imageUrlInput}
                onChange={(e) => setImageUrlInput(e.target.value)}
                placeholder="Paste image URL..."
                onKeyDown={(e) => { if (e.key === "Enter") attachImage(); if (e.key === "Escape") setShowImageInput(false); }}
                className="flex-1 px-2 py-1 text-[10px] rounded outline-none"
                style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }}
                autoFocus
              />
              <button onClick={attachImage}
                className="px-2 py-1 text-[9px] font-bold rounded"
                style={{ backgroundColor: T.accentColor + "20", color: T.accentColor, border: `1px solid ${T.accentColor}40` }}>
                Attach
              </button>
              <button onClick={() => setShowImageInput(false)}
                className="px-1 opacity-50">
                <X size={10} style={{ color: T.textMuted }} />
              </button>
            </div>
          )}

          <div className="flex gap-2 items-end">
            {/* Image attach button */}
            <button onClick={() => setShowImageInput((v) => !v)}
              className="shrink-0 p-1.5 rounded border transition-all hover:scale-105"
              style={{ borderColor: T.borderColor + "30", color: T.textMuted, backgroundColor: attachedImageUrl ? T.accentColor + "10" : "transparent" }}
              title="Attach image URL">
              <ImageIcon size={12} />
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={`Message ${selectedAgent.name}... (Enter to send, Shift+Enter for newline)`}
              rows={1}
              disabled={isLoading}
              className="flex-1 px-3 py-1.5 text-[11px] rounded-lg outline-none resize-none overflow-hidden font-mono disabled:opacity-40"
              style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor, minHeight: "38px", maxHeight: "140px" }}
            />

            <button
              onClick={() => sendMessage()}
              disabled={(!input.trim() && !attachedImageUrl) || isLoading}
              className="shrink-0 px-3 py-1.5 rounded-lg font-bold disabled:opacity-30 transition-all hover:scale-105"
              style={{ backgroundColor: selectedAgent.color, color: "#0a0a0f", minHeight: "38px" }}>
              {streaming ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            </button>
          </div>

          <div className="flex items-center justify-between mt-1 px-0.5">
            <span className="text-[8px] opacity-30" style={{ color: T.textMuted }}>
              {providerConfig.label} · Shift+Enter for newline
            </span>
            {input.length > 0 && <span className="text-[8px] font-mono opacity-30" style={{ color: T.textMuted }}>{input.length}</span>}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Info + Logs ── */}
      <div className="w-[270px] shrink-0 flex flex-col border-l" style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "90" }}>
        {/* Tabs */}
        <div className="flex border-b shrink-0" style={{ borderColor: T.borderColor + "15" }}>
          {(["info", "logs"] as const).map((tab) => (
            <button key={tab} onClick={() => setRightTab(tab)}
              className="flex-1 py-2 text-[9px] font-bold uppercase tracking-wider transition-all"
              style={{
                backgroundColor: rightTab === tab ? T.accentColor + "10" : "transparent",
                color: rightTab === tab ? T.accentColor : T.textMuted,
                borderBottom: rightTab === tab ? `2px solid ${T.accentColor}` : "2px solid transparent",
              }}>
              {tab === "info" ? "Agent Info" : "Live Logs"}
            </button>
          ))}
        </div>

        {rightTab === "info" ? (
          /* ── Agent Info ── */
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Agent hero */}
            <div className="text-center py-2 rounded-lg" style={{ background: selectedAgent.color + "08", border: `1px solid ${selectedAgent.color}20` }}>
              <div className="text-3xl mb-1">{selectedAgent.name.charAt(0)}</div>
              <div className="text-[11px] font-bold" style={{ color: selectedAgent.color }}>{selectedAgent.name}</div>
              <div className="text-[9px] opacity-60 mt-0.5" style={{ color: T.textMuted }}>{selectedAgent.role}</div>
              <div className="flex items-center justify-center gap-1 mt-2">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: selectedAgent.color }} />
                <span className="text-[9px] font-mono" style={{ color: selectedAgent.color }}>Online</span>
              </div>
            </div>

            {/* Description */}
            <div>
              <div className="text-[8px] font-bold uppercase tracking-widest mb-1" style={{ color: T.accentColor }}>Description</div>
              <p className="text-[10px] leading-relaxed opacity-70" style={{ color: T.textColor }}>{selectedAgent.desc}</p>
            </div>

            {/* System Prompt */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[8px] font-bold uppercase tracking-widest" style={{ color: T.accentColor }}>System Prompt</div>
              </div>
              <div className="rounded p-2 text-[9px] font-mono leading-relaxed" style={{
                background: "rgba(0,0,0,0.4)",
                border: `1px solid ${T.borderColor}15`,
                color: T.textMuted,
                maxHeight: "200px",
                overflowY: "auto",
              }}>
                {selectedAgent.systemPrompt || "(no system prompt)"}
              </div>
            </div>

            {/* Stats */}
            <div className="rounded-lg p-2.5 space-y-1.5" style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${T.borderColor}15` }}>
              <div className="flex justify-between text-[9px] font-mono">
                <span style={{ color: T.textMuted }}>Lines</span>
                <span style={{ color: selectedAgent.color }}>{lines.length}</span>
              </div>
              <div className="flex justify-between text-[9px] font-mono">
                <span style={{ color: T.textMuted }}>Provider</span>
                <span style={{ color: providerConfig.color }}>{providerConfig.label}</span>
              </div>
            </div>
          </div>
        ) : (
          /* ── Live Logs ── */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Log controls */}
            <div className="px-2 py-1.5 border-b space-y-1.5 shrink-0" style={{ borderColor: T.borderColor + "10" }}>
              <div className="flex items-center gap-1.5" style={{ background: "rgba(0,0,0,0.3)", borderRadius: "6px", padding: "3px 8px", border: `1px solid ${T.borderColor}15` }}>
                <Search size={9} style={{ color: T.textMuted, opacity: 0.5 }} />
                <input value={logFilter} onChange={(e) => setLogFilter(e.target.value)}
                  placeholder="Filter logs..."
                  className="flex-1 bg-transparent outline-none text-[9px] font-mono"
                  style={{ color: T.textColor }} />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setAutoScroll((v) => !v)}
                  className="text-[8px] px-1.5 py-0.5 rounded border font-bold transition-all"
                  style={{
                    borderColor: autoScroll ? T.accentColor + "40" : T.borderColor + "20",
                    color: autoScroll ? T.accentColor : T.textMuted,
                    background: autoScroll ? T.accentColor + "10" : "transparent",
                  }}>
                  AUTO
                </button>
                <button onClick={copyLogs}
                  className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded border opacity-60 hover:opacity-100 transition-all"
                  style={{ borderColor: T.borderColor + "20", color: T.textMuted }}>
                  {copiedLogs ? <Check size={9} className="text-green-400" /> : <Copy size={9} />} Copy
                </button>
                <span className="text-[8px] font-mono ml-auto" style={{ color: T.textMuted }}>
                  {filteredLogs.length} entries
                </span>
              </div>
            </div>

            {/* Log entries */}
            <div ref={logRef} className="flex-1 overflow-y-auto p-2 font-mono text-[9px] space-y-0.5">
              {filteredLogs.length > 0 ? filteredLogs.map((l, i) => {
                const levelColor: Record<string, string> = { error: "#f87171", warn: "#facc15", success: "#4ade80", info: "#94a3b8" };
                return (
                  <div key={i} className="flex gap-1.5 px-1 py-0.5 rounded hover:bg-white/5 transition-colors">
                    <span className="shrink-0 opacity-40" style={{ color: T.textMuted }}>[{l.timestamp}]</span>
                    <span className="shrink-0 font-bold" style={{ color: AGENT_COLORS[l.agent] ?? "#f97316" }}>[{l.agent}]</span>
                    <span className="leading-relaxed" style={{ color: levelColor[l.level] ?? T.textColor }}>{l.message}</span>
                  </div>
                );
              }) : (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <div className="text-xl mb-2 opacity-30">📡</div>
                  <div className="opacity-30 text-[9px]" style={{ color: T.textMuted }}>
                    {logFilter ? "No matching logs" : "Waiting for agent activity..."}
                  </div>
                  <div className="mt-3 flex gap-1">
                    {[...Array(3)].map((_, i) => (
                      <span key={i} className="w-1 h-1 rounded-full bg-green-400 animate-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
