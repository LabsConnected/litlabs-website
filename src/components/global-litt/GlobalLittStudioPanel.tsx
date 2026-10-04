"use client";

/**
 * GlobalLittStudioPanel — Phase 2 persistent operator surface for Global LiTT.
 *
 * Uses Phase 1 architecture:
 * - useGlobalLitt() loads the existing owner system row (never creates duplicates)
 * - Messages go to /api/gemini/chat with globalLittProjectId for persistence
 * - No provider/model internals are exposed in the UI
 *
 * Mobile: full-screen sheet at 390px with safe-area handling.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Loader2 } from "lucide-react";
import { useGlobalLitt } from "@/components/global-litt/GlobalLittProvider";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function GlobalLittStudioPanel({ onClose }: { onClose: () => void }) {
  const { projectId, project } = useGlobalLitt();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Focus input on open (desktop only — mobile keyboard would jump)
  useEffect(() => {
    if (window.innerWidth > 640) {
      inputRef.current?.focus();
    }
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !projectId) return;

    setInput("");
    setError(null);
    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
          stream: false,
          globalLittProjectId: projectId,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || err.error || "LiTT is reconnecting");
      }

      const data = await response.json();
      const reply =
        data.response || data.text || data.message || data.content ||
        "I'm here. What do you need?";

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, [input, busy, projectId, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Global LiTT"
      data-testid="global-litt-studio-panel"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel — bottom sheet on mobile, centered dialog on desktop */}
      <div
        className="relative flex w-full flex-col overflow-hidden bg-[#0a0a0f] sm:max-w-2xl sm:rounded-2xl"
        style={{
          height: "min(85vh, 700px)",
          maxHeight: "calc(100dvh - env(safe-area-inset-top) - 1rem)",
          marginBottom: "env(safe-area-inset-bottom)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              <span className="text-sm font-bold text-black">L</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Global LiTT</div>
              <div className="text-xs text-white/50">
                {project?.name || "Your persistent operator"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Global LiTT"
            className="rounded-lg p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4" data-testid="global-litt-messages">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center text-center">
              <div className="max-w-xs">
                <div className="mb-2 text-sm font-medium text-white/80">
                  Hey, I&apos;m LiTT.
                </div>
                <div className="text-sm text-white/50">
                  I remember our conversations across Studio. Ask me anything,
                  or tell me what to build.
                </div>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "text-black"
                    : "border border-white/10 bg-white/5 text-white"
                }`}
                style={
                  m.role === "user"
                    ? { backgroundColor: "var(--color-accent)" }
                    : undefined
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {busy && (
            <div className="mb-3 flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5">
                <Loader2 size={16} className="animate-spin text-white/60" />
                <span className="text-sm text-white/60">Thinking…</span>
              </div>
            </div>
          )}
          {error && (
            <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
              {error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer — safe-area aware */}
        <div
          className="border-t border-white/10 px-4 pt-3"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask LiTT anything…"
              rows={1}
              disabled={busy}
              className="max-h-32 flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-white/25 disabled:opacity-50"
              style={{ fontSize: "16px" }} // Prevents iOS zoom
              data-testid="global-litt-composer"
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={busy || !input.trim()}
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-black transition-opacity disabled:opacity-40"
              style={{ backgroundColor: "var(--color-accent)" }}
              data-testid="global-litt-send"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
          <div className="mt-2 pb-1 text-center text-[11px] text-white/30">
            Persistent across Studio • Remembers this conversation
          </div>
        </div>
      </div>
    </div>
  );
}
