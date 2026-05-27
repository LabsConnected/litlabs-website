"use client";
import { useState, useRef, useEffect } from "react";

interface Message { role: "user" | "assistant"; content: string; ts: number; }

const AGENTS = [
  { id: "champion", name: "LitLabs Agent", avatar: "⚡", greeting: "Hey! I'm the LitLabs agent. What do you need help with?" },
  { id: "coder", name: "Code Champion", avatar: "👨‍💻", greeting: "Code Champion here. Hit me with a problem or an idea." },
  { id: "writer", name: "Writing Coach", avatar: "✍️", greeting: "Ready to make your words hit different. What are you working on?" },
];

export default function AgentChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: AGENTS[0].greeting, ts: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text, ts: Date.now() }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          agent: AGENTS[activeAgent].id,
          ts: Date.now(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply = data?.reply || data?.response || data?.output || data?.message || JSON.stringify(data);
      setMessages((prev) => [...prev, { role: "assistant", content: String(reply), ts: Date.now() }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Backend unreachable. Make sure n8n is running and the /chat webhook is active.", ts: Date.now() },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function switchAgent(idx: number) {
    setActiveAgent(idx);
    setMessages([
      { role: "assistant", content: AGENTS[idx].greeting, ts: Date.now() },
    ]);
  }

  const agent = AGENTS[activeAgent];

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-140px)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">AI Chat</h1>
          <p className="text-text-secondary text-sm">Talk to any agent below</p>
        </div>
      </div>

      {/* Agent tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {AGENTS.map((a, i) => (
          <button
            key={a.id}
            onClick={() => switchAgent(i)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              i === activeAgent
                ? "bg-neon-cyan text-cyber-bg"
                : "bg-cyber-surface border border-cyber-border text-text-secondary hover:border-neon-cyan/40 hover:text-neon-cyan"
            }`}
          >
            <span>{a.avatar}</span>
            {a.name}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto space-y-4 mb-4 pr-2">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
              msg.role === "user"
                ? "bg-neon-cyan text-cyber-bg"
                : "bg-cyber-surface border border-cyber-border text-text-primary"
            }`}>
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
            <div className="bg-cyber-surface border border-cyber-border rounded-xl px-4 py-3 text-sm text-text-muted">
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-3 shrink-0">
        <input
          className="input flex-1"
          placeholder={`Message ${agent.name}...`}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSend()}
          disabled={loading}
        />
        <button className="btn-primary" onClick={handleSend} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
