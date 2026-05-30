"use client";
import { useState, useRef, useEffect, useCallback } from "react";

interface Message { role: "user" | "assistant"; content: string; }

const AGENTS = [
  { id: "champion", name: "LitLabs Agent", emoji: "⚡", greeting: "Initialization complete. I am the LitLabs primary daemon. How can I assist your workflow?" },
  { id: "coder",    name: "Code Champion", emoji: "👨‍💻", greeting: "Code Champion online. Transmit your technical problem or architecture idea." },
  { id: "writer",   name: "Writing Coach",  emoji: "✍️", greeting: "Neural link established. Ready to refine your linguistic output." },
];

export default function AgentChatPage() {
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: AGENTS[0].greeting }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setMessages((p) => [...p, { role: "user", content: text }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, agent: AGENTS[activeIdx].id }),
      });
      const data = await res.json();
      setMessages((p) => [...p, { role: "assistant", content: data.reply || data.message || "No response." }]);
    } catch {
      setMessages((p) => [...p, { role: "assistant", content: "Error: Neural Link Interrupted. Check backend connectivity." }]);
    } finally { setLoading(false); }
  };

  const switchAgent = useCallback((idx: number) => {
    setActiveIdx(idx);
    setMessages([{ role: "assistant", content: AGENTS[idx].greeting }]);
  }, []);

  const agent = AGENTS[activeIdx];

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-100px)] lg:h-[calc(100vh-140px)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 p-3 sm:p-4 glass-panel rounded-2xl border-white/5 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center text-xl shrink-0">
            {agent.emoji}
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-neon-cyan tracking-[0.2em] uppercase">Active_Link</div>
            <div className="text-base font-bold text-text-primary truncate">{agent.name}</div>
          </div>
        </div>
        <button onClick={() => switchAgent(activeIdx)} className="px-3 py-1.5 text-[10px] font-bold text-text-muted hover:text-neon-cyan border border-white/5 rounded-lg transition-colors shrink-0">
          Clear
        </button>
      </div>

      {/* Agent Tabs – horizontal scroll on mobile */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-hide -mx-1 px-1">
        {AGENTS.map((a, i) => (
          <button
            key={a.id}
            onClick={() => switchAgent(i)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold tracking-widest uppercase whitespace-nowrap transition-all shrink-0 ${
              i === activeIdx
                ? "bg-neon-cyan text-cyber-bg shadow-[0_0_12px_rgba(0,242,254,0.2)]"
                : "bg-white/5 border border-white/5 text-text-muted hover:text-text-secondary"
            }`}
          >
            <span className="text-lg">{a.emoji}</span>
            <span className="hidden sm:block">{a.name}</span>
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 px-1 mb-4 scrollbar-hide">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              m.role === "user"
                ? "bg-neon-cyan/10 border border-neon-cyan/30 text-text-primary rounded-tr-sm"
                : "bg-white/5 border border-white/5 text-text-secondary rounded-tl-sm glass-panel"
            }`}>
              <div className={`text-[10px] font-bold uppercase tracking-widest mb-1.5 opacity-50 ${m.role === "user" ? "text-neon-cyan" : "text-text-muted"}`}>
                {m.role === "user" ? "You" : agent.name}
              </div>
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="glass-panel rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-text-muted">
              <span className="mr-2">Thinking</span>
              <span className="inline-flex gap-1 align-middle">
                <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-bounce" />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
        className="glass-panel rounded-2xl border-white/5 p-2 flex gap-2 items-end"
      >
        <input
          className="flex-1 bg-transparent border-none px-3 py-2.5 text-sm sm:text-base text-text-primary placeholder:text-text-muted focus:outline-none"
          placeholder="Initialize command sequence..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-neon-cyan text-cyber-bg hover:scale-105 active:scale-95 transition-all disabled:opacity-30 disabled:hover:scale-100 shadow-[0_0_15px_rgba(0,242,254,0.2)] shrink-0"
        >
          <svg className="w-5 h-5 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </form>
    </div>
  );
}
