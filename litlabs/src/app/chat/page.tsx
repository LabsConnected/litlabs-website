"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useRef } from "react";

const MODELS = [
  { id: "gemini-flash", name: "Gemini 2.5 Flash" },
  { id: "llama-nemotron", name: "Llama 3.1 Nemotron 70B" },
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "claude-sonnet", name: "Claude Sonnet" },
  { id: "qwen-coder", name: "Qwen3 Coder" },
];

export default function ChatPage() {
  const [model, setModel] = useState("gemini-flash");
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai-chat",
      body: { model },
    }),
  });

  const isLoading = status === "submitted" || status === "streaming";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
    inputRef.current?.focus();
  };

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-orange-400">
            LiTTree LabStudios
          </p>
          <h1 className="text-4xl font-black">Memory Chat</h1>
          <p className="text-zinc-400 mt-2">
            AI chat with persistent memory powered by Supermemory.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm text-zinc-400">Model:</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-lg bg-zinc-900 border border-white/10 px-3 py-1.5 text-sm text-white outline-none focus:border-orange-500"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <section className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4 shadow-2xl space-y-4 min-h-[500px] flex flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto">
            {messages.length === 0 && (
              <p className="text-zinc-500 text-center py-12">
                Start a conversation. Memories are saved automatically.
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-2 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-orange-500 text-black"
                      : "bg-white/5 border border-white/10"
                  }`}
                >
                  <span className="block text-xs font-bold mb-1 opacity-60">
                    {m.role === "user" ? "You" : "AI"}
                  </span>
                  {m.parts?.map((part, i) =>
                    part.type === "text" ? <span key={i}>{part.text}</span> : null
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="text-zinc-500 text-sm">Thinking...</div>
            )}
            {error && (
              <div className="text-red-400 text-sm">Error: {error.message}</div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              className="flex-1 rounded-xl bg-black/70 border border-white/10 p-3 text-white outline-none focus:border-orange-500"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything..."
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="rounded-xl bg-orange-500 px-6 py-3 font-bold text-black disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
