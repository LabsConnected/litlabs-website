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

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [activeAgent, setActiveAgent] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load saved
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
      const savedAgent = localStorage.getItem(AGENT_KEY);
      if (savedAgent) {
        const idx = parseInt(savedAgent, 10);
        if (idx >= 0 && idx < AGENTS.length) setActiveAgent(idx);
      }
    } catch {
      // ignore
    }
  }, []);

  // Save
  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)));
      } catch {
        // ignore
      }
    }
  }, [messages]);

  // Default greeting
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          role: "assistant",
          content: AGENTS[activeAgent].greeting,
          ts: Date.now(),
        },
      ]);
    }
  }, [activeAgent, messages.length]);

  // Scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Focus
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const switchAgent = useCallback(
    (idx: number) => {
      setActiveAgent(idx);
      setShowPicker(false);
      localStorage.setItem(AGENT_KEY, String(idx));
      setMessages([
        { role: "assistant", content: AGENTS[idx].greeting, ts: Date.now() },
      ]);
    },
    []
  );

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
        data?.reply ||
        data?.response ||
        data?.output ||
        data?.message ||
        JSON.stringify(data);
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
          content: "Backend unreachable. Make sure n8n is running and the /chat webhook is set up.",
          ts: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const agent = AGENTS[activeAgent];

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-neon-cyan hover:bg-cyan-400 text-black font-bold shadow-lg shadow-neon-cyan/30 transition-all flex items-center justify-center text-xl"
        aria-label="Toggle chat"
      >
        {open ? "✕" : agent.avatar}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-w-[calc(100vw-48px)] h-[520px] max-h-[calc(100vh-160px)] bg-cyber-surface border border-cyber-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-cyber-surface-2 border-b border-cyber-border flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <button
              onClick={() => setShowPicker(!showPicker)}
              className="text-sm font-semibold text-white hover:text-neon-cyan transition-colors flex items-center gap-1"
            >
              {agent.avatar} {agent.name} ▾
            </button>
            <span className="text-xs text-text-muted ml-auto">n8n · always-on</span>
          </div>

          {/* Agent picker dropdown */}
          {showPicker && (
            <div className="border-b border-cyber-border bg-cyber-surface-2 p-2 grid grid-cols-2 gap-1">
              {AGENTS.map((a, i) => (
                <button
                  key={a.id}
                  onClick={() => switchAgent(i)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    i === activeAgent
                      ? "bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan"
                      : "text-text-secondary hover:bg-cyber-border/30"
                  }`}
                >
                  <span>{a.avatar}</span>
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
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-neon-cyan text-cyber-bg"
                      : "bg-cyber-surface-2 text-text-primary border border-cyber-border"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <div className="text-xs text-neon-cyan mb-1 font-code">
                      {agent.avatar} {agent.name.toUpperCase()}
                    </div>
                  )}
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-cyber-surface-2 border border-cyber-border rounded-xl px-3 py-2 text-sm text-text-muted">
                  <span className="animate-pulse">Thinking...</span>
                </div>
              </div>
            )}
            {error && (
              <div className="text-xs text-red-400 text-center">
                ⚠ Backend unreachable — check n8n
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-cyber-border bg-cyber-surface-2 shrink-0">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                className="flex-1 bg-cyber-bg border border-cyber-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-neon-cyan"
                placeholder={`Message ${agent.name}...`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                disabled={loading}
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="px-4 py-2 bg-neon-cyan hover:bg-cyan-400 disabled:bg-cyber-border disabled:text-text-muted text-cyber-bg font-semibold rounded-lg text-sm transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
