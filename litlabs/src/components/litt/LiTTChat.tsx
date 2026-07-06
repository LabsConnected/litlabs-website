"use client";

import { useRef, useEffect, FormEvent } from "react";
import { LiTTMood, LiTTAction, LittProviderName } from "@/lib/ai/litt-router";
import { LiTTMoodBadge } from "./LiTTMoodBadge";
import { LITT } from "./litt-theme";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  mood?: LiTTMood;
  action?: LiTTAction;
  provider?: string;
  model?: string;
  latencyMs?: number;
  error?: boolean;
}

interface LiTTChatProps {
  messages: ChatMessage[];
  loading?: boolean;
  provider?: LittProviderName;
  onProviderChange?: (provider: LittProviderName | undefined) => void;
  onSend: (text: string) => void;
}

export function LiTTChat({
  messages,
  loading = false,
  provider,
  onProviderChange,
  onSend,
}: LiTTChatProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = inputRef.current?.value.trim();
    if (!text || loading) return;
    onSend(text);
    inputRef.current!.value = "";
  };

  const quickPrompts = [
    {
      label: "Code idea",
      text: "Give me a cool code idea for a studio dashboard",
    },
    { label: "Music vibe", text: "Suggest a music vibe for a cyberpunk brand" },
    {
      label: "Design help",
      text: "Help me design a landing page hero section",
    },
  ];

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-2xl border"
      style={{ borderColor: LITT.border, backgroundColor: LITT.bgPanel }}
    >
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: LITT.border }}
      >
        <span className="text-sm font-semibold" style={{ color: LITT.text }}>
          LiTT Chat
        </span>
        <select
          value={provider || ""}
          onChange={(e) =>
            onProviderChange?.(e.target.value as LittProviderName | undefined)
          }
          className="rounded-lg border px-2 py-1 text-xs outline-none"
          style={{
            borderColor: LITT.border,
            backgroundColor: LITT.bg,
            color: LITT.textMuted,
          }}
        >
          <option value="">Auto (OpenRouter → Groq → Ollama)</option>
          <option value="openrouter">OpenRouter</option>
          <option value="groq">Groq</option>
          <option value="ollama">Ollama</option>
        </select>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className="max-w-[80%] rounded-xl px-4 py-3 text-sm"
              style={{
                backgroundColor:
                  m.role === "user"
                    ? "rgba(163,245,70,0.12)"
                    : LITT.bgSecondary,
                border: `1px solid ${m.error ? LITT.danger : LITT.border}`,
                color: m.error ? LITT.danger : LITT.text,
              }}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.role === "assistant" && m.mood && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <LiTTMoodBadge mood={m.mood} />
                  {m.action && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{
                        backgroundColor: "rgba(255,122,26,0.12)",
                        color: LITT.accentOrange,
                        border: `1px solid ${LITT.accentOrange}`,
                      }}
                    >
                      {m.action.replace("_", " ")}
                    </span>
                  )}
                  {m.provider && (
                    <span
                      className="text-[10px]"
                      style={{ color: LITT.textDim }}
                    >
                      via {m.provider}
                      {m.model ? ` · ${m.model}` : ""}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div
              className="max-w-[80%] rounded-xl px-4 py-3 text-sm"
              style={{
                backgroundColor: LITT.bgSecondary,
                border: `1px solid ${LITT.border}`,
              }}
            >
              <div
                className="flex items-center gap-2"
                style={{ color: LITT.textMuted }}
              >
                <span
                  className="inline-block h-2 w-2 animate-pulse rounded-full"
                  style={{ backgroundColor: LITT.accentCyan }}
                />
                <span
                  className="inline-block h-2 w-2 animate-pulse rounded-full"
                  style={{ backgroundColor: LITT.accentCyan }}
                />
                <span
                  className="inline-block h-2 w-2 animate-pulse rounded-full"
                  style={{ backgroundColor: LITT.accentCyan }}
                />
                <span className="ml-1 text-xs">LiTT is thinking...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-4" style={{ borderColor: LITT.border }}>
        <div className="mb-3 flex flex-wrap gap-2">
          {quickPrompts.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                if (inputRef.current) {
                  inputRef.current.value = p.text;
                  inputRef.current.focus();
                }
              }}
              className="rounded-full px-3 py-1 text-xs font-medium transition-colors hover:opacity-80"
              style={{
                backgroundColor: LITT.bg,
                border: `1px solid ${LITT.border}`,
                color: LITT.textMuted,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            placeholder="Ask LiTT anything..."
            className="flex-1 rounded-lg border px-4 py-2 text-sm outline-none"
            style={{
              backgroundColor: LITT.bg,
              borderColor: LITT.border,
              color: LITT.text,
            }}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: LITT.accentCyan, color: "#000" }}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
