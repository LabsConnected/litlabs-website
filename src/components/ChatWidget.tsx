"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

interface Agent {
  id: string;
  name: string;
  avatar: string;
  greeting: string;
}

const AGENTS: Agent[] = [
  {
    id: "champion",
    name: "LitLabs Agent",
    avatar: "⚡",
    greeting: "Hey! I'm the LitLabs agent. I can help you build, chat, and explore AI. What do you need?",
  },
  {
    id: "coder",
    name: "Code Champion",
    avatar: "👨‍💻",
    greeting: "Code Champion here. Send me a problem, a bug, or an idea — I'll help you ship it.",
  },
  {
    id: "writer",
    name: "Writing Coach",
    avatar: "✍️",
    greeting: "Ready to make your words hit different. Paste whatever you're working on.",
  },
  {
    id: "social",
    name: "Social Dominator",
    avatar: "🎭",
    greeting: "What's the vibe? Give me a topic and I'll craft something worth sharing.",
  },
];

const STORAGE_KEY = "litlabs_chat_messages";
const AGENT_KEY = "litlabs_chat_agent";
const N8N_WEBHOOK = "/api/chat";

function BouncingDots() {
  return (
    <span className="inline-flex gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
    return [{
      role: "assistant",
      content: AGENTS[0].greeting,
      ts: 1735689600000,
    }];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [activeAgent, setActiveAgent] = useState(() => {
    if (typeof window === "undefined") return 0;
    try {
      const savedAgent = localStorage.getItem(AGENT_KEY);
      if (savedAgent) {
        const idx = parseInt(savedAgent, 10);
        if (idx >= 0 && idx < AGENTS.length) return idx;
      }
    } catch { /* ignore */ }
    return 0;
  });
  const [showPicker, setShowPicker] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Save messages
  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)));
      } catch { /* ignore */ }
    }
  }, [messages]);

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Focus input when opened
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const switchAgent = useCallback((idx: number) => {
    setActiveAgent(idx);
    setShowPicker(false);
    localStorage.setItem(AGENT_KEY, String(idx));
    setMessages([
      { role: "assistant", content: AGENTS[idx].greeting, ts: Date.now() },
    ]);
  }, []);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setError(false);
    setMessages((prev) => [...prev, { role: "user", content: text, ts: Date.now() }]);
    setLoading(true);

    try {
      const res = await fetch(N8N_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          sessionId: "visitor_" + location.hostname,
          agent: AGENTS[activeAgent].id,
          ts: Date.now(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply =
        data?.reply || data?.response || data?.output || data?.message || JSON.stringify(data);
      if (data?.error) throw new Error(data.detail || data.error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: String(reply), ts: Date.now() },
      ]);
    } catch {
      setError(true);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Chat temporarily unavailable. The AI service may be rate-limited or offline.",
          ts: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const agent = AGENTS[activeAgent];
  const unreadCount = 0; // Could track unread

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-neon-cyan hover:bg-cyan-300 text-black font-bold shadow-lg shadow-neon-cyan/30 hover:shadow-neon-cyan/50 transition-all flex items-center justify-center text-xl active:scale-95"
        aria-label="Toggle chat"
      >
        {open ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <span className="text-2xl">{agent.avatar}</span>
        )}
        {unreadCount > 0 && !open && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] sm:w-[400px] max-w-[400px] h-[70vh] sm:h-[520px] max-h-[calc(100vh-140px)] bg-cyber-surface border border-cyber-border rounded-2xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden animate-slide-up">
          {/* Header */}
          <div className="px-4 py-3 bg-cyber-surface-2 border-b border-cyber-border flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <button
              onClick={() => setShowPicker(!showPicker)}
              className="text-sm font-semibold text-white hover:text-neon-cyan transition-colors flex items-center gap-1.5 min-h-[36px]"
            >
              <span>{agent.avatar}</span>
              <span className="hidden sm:inline">{agent.name}</span>
              <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => switchAgent(activeAgent)}
                className="text-text-muted hover:text-white transition-colors p-1"
                title="Clear chat"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <span className="text-[10px] text-text-muted font-code hidden sm:inline">ONLINE</span>
            </div>
          </div>

          {/* Agent picker dropdown */}
          {showPicker && (
            <div className="border-b border-cyber-border bg-cyber-surface-2 p-2 grid grid-cols-2 gap-1 animate-slide-up">
              {AGENTS.map((a, i) => (
                <button
                  key={a.id}
                  onClick={() => switchAgent(i)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm transition-all min-h-[44px] ${
                    i === activeAgent
                      ? "bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan font-semibold"
                      : "text-text-secondary hover:bg-cyber-border/30"
                  }`}
                >
                  <span className="text-lg">{a.avatar}</span>
                  <span className="truncate">{a.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    msg.role === "user"
                      ? "bg-neon-cyan text-cyber-bg rounded-br-sm font-medium"
                      : "bg-white/[0.04] text-text-primary border border-cyber-border rounded-bl-sm"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <div className="text-[10px] text-neon-cyan mb-1.5 font-code font-bold tracking-wider">
                      {agent.avatar} {agent.name.toUpperCase()}
                    </div>
                  )}
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start animate-fade-in">
                <div className="bg-white/[0.04] border border-cyber-border rounded-2xl rounded-bl-sm px-4 py-3 text-sm">
                  <div className="text-[10px] text-neon-cyan mb-2 font-code font-bold tracking-wider">
                    {agent.avatar} {agent.name.toUpperCase()}
                  </div>
                  <div className="flex items-center gap-2 text-text-muted">
                    <BouncingDots />
                    <span className="text-xs">Thinking</span>
                  </div>
                </div>
              </div>
            )}
            {error && !loading && (
              <div className="text-center py-2">
                <span className="text-xs text-red-400/70">⚠ Connection issue. Try again.</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="p-2 border-t border-cyber-border shrink-0"
          >
            <div className="flex gap-2 items-center bg-black/30 rounded-xl border border-cyber-border px-3 focus-within:border-neon-cyan/50 transition-colors">
              <input
                ref={inputRef}
                className="flex-1 bg-transparent border-none text-sm text-text-primary py-3 outline-none placeholder:text-text-muted min-h-[44px]"
                placeholder={`Message ${agent.name}...`}
                value={input}
                onChange={e => setInput(e.target.value)}
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="shrink-0 w-9 h-9 rounded-lg bg-neon-cyan text-cyber-bg flex items-center justify-center hover:bg-cyan-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-90"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
