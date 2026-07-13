"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";

type ChatMessage = {
  role: "user" | "agent";
  content: string;
};

const SUGGESTIONS = [
  "What can you do?",
  "Generate an image",
  "Build a page",
  "Recall a memory",
];

export function FloatingChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "agent",
      content:
        "Hey, I'm LiTT Director — your AI crew chief. Ask me to build, generate, research, or recall memories. What's the mission?",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setLoading(true);
      try {
        const res = await fetch("/api/agents/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: "director", message: trimmed }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "Chat failed");
        setMessages((prev) => [
          ...prev,
          { role: "agent", content: data.response || "I'm on it." },
        ]);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Something went wrong.";
        setMessages((prev) => [
          ...prev,
          { role: "agent", content: `Error: ${msg}` },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-20 right-4 z-[9999] flex w-[calc(100vw-2rem)] max-w-sm flex-col rounded-2xl border border-neutral-700/50 shadow-2xl"
          style={{
            height: "min(70vh, 520px)",
            backgroundColor: "#0f0f15",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-black"
                style={{
                  background:
                    "linear-gradient(135deg, #fbbf24, #f59e0b)",
                  color: "#1a1a1a",
                }}
              >
                L
              </div>
              <div>
                <div className="text-xs font-black text-neutral-100">
                  LiTT Director
                </div>
                <div className="flex items-center gap-1 text-[9px] text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                  Online
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200"
              aria-label="Close chat"
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                    m.role === "user"
                      ? "rounded-br-sm bg-amber-500/20 text-amber-100"
                      : "rounded-bl-sm bg-neutral-800/80 text-neutral-200"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-neutral-800/80 px-3 py-2 text-xs text-neutral-400">
                  <Loader2 size={12} className="animate-spin" />
                  Thinking…
                </div>
              </div>
            )}
          </div>

          {/* Suggestions */}
          {messages.length <= 1 && !loading && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="rounded-full border border-neutral-700/50 bg-neutral-800/40 px-2.5 py-1 text-[10px] font-bold text-neutral-400 transition hover:border-amber-500/30 hover:text-amber-300"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 border-t border-neutral-800 px-3 py-3">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask LiTT Director…"
              disabled={loading}
              className="flex-1 rounded-xl border border-neutral-700/50 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-amber-500/40"
            />
            <button
              onClick={() => void send(input)}
              disabled={loading || !input.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-neutral-900 transition disabled:opacity-40"
              style={{
                background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
              }}
              aria-label="Send message"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Floating bubble */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 right-4 z-[9999] flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:scale-110 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
          boxShadow: "0 4px 20px rgba(251, 191, 36, 0.3)",
        }}
        aria-label={open ? "Close chat" : "Open chat"}
      >
        {open ? (
          <X size={22} className="text-neutral-900" />
        ) : (
          <MessageCircle size={22} className="text-neutral-900" />
        )}
        {!open && (
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
          </span>
        )}
      </button>
    </>
  );
}
