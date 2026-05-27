"use client";
import { useState, useRef, useEffect } from "react";
import { runCommand } from "@/lib/api";

interface Message { role: "user" | "assistant"; content: string; }

export default function AgentChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hey! I'm your Homebase agent. I can run commands on your phone, check system status, and help you build. What do you need?" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      // Try to interpret as a command
      const result = await runCommand(userMsg);
      const output = result.output || result.error || "Command executed (no output)";
      setMessages(prev => [...prev, { role: "assistant", content: output }]);
    } catch {
      // Fallback: echo message
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `I received: "${userMsg}". Connect the backend API to execute commands on your phone.`
      }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-120px)]">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-heading text-2xl font-bold">AI Chat</h1>
        <div className="flex items-center gap-2">
          <span className="badge badge-cyan">⚡ PHONE LINKED</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-4 mb-4 pr-2">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
              msg.role === "user"
                ? "bg-neon-cyan/10 border border-neon-cyan/30 text-text-primary"
                : "bg-cyber-surface border border-cyber-border text-text-secondary"
            }`}>
              {msg.role === "assistant" && <div className="text-xs text-neon-cyan mb-1 font-code">⚡ HOMEBASE AGENT</div>}
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-cyber-surface border border-cyber-border rounded-xl px-4 py-3 text-sm text-text-muted">
              <span className="animate-pulse">Executing...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-3">
        <input
          className="input flex-1"
          placeholder="Type a command or message..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSend()}
        />
        <button className="btn-primary" onClick={handleSend} disabled={loading}>Send</button>
      </div>
    </div>
  );
}
