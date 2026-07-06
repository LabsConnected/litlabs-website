"use client";

import { useState, useCallback } from "react";
import { LiTTMood, LittProviderName } from "@/lib/ai/litt-router";
import { LiTTFace } from "./LiTTFace";
import { LiTTChat, ChatMessage } from "./LiTTChat";
import { MusicLab } from "./MusicLab";
import { StickerCanvas } from "./StickerCanvas";
import { StudioIDE } from "./StudioIDE";
import { SpecSheets } from "./SpecSheets";
import { LITT } from "./litt-theme";

type LabTab = "chat" | "music" | "sticker" | "code" | "spec";

export function LiTTHub() {
  const [activeTab, setActiveTab] = useState<LabTab>("chat");
  const [mood, setMood] = useState<LiTTMood>("happy");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "Hey builder, I'm LiTT. What are we making today?",
      mood: "happy",
      action: "chat",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<LittProviderName | undefined>(
    undefined,
  );
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (loading) return;

      const userMsg: ChatMessage = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);
      setErrorNotice(null);

      try {
        const history = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch("/api/litt/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            history,
            provider,
          }),
        });

        const data = await res
          .json()
          .catch(() => ({ error: "Invalid response" }));

        if (!res.ok) {
          throw new Error(data.error || `Request failed (${res.status})`);
        }

        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: data.reply,
          mood: data.mood as LiTTMood,
          action: data.action,
          provider: data.provider,
          model: data.model,
          latencyMs: data.latencyMs,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        if (data.mood) setMood(data.mood as LiTTMood);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "LiTT is offline";
        setErrorNotice(msg);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `LiTT couldn't reach the brain: ${msg}. I switched to a static fallback — still here! 😴`,
            mood: "sleepy",
            error: true,
          },
        ]);
        setMood("sleepy");
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, provider],
  );

  const tabs: { id: LabTab; label: string }[] = [
    { id: "chat", label: "Chat" },
    { id: "music", label: "Music Lab" },
    { id: "sticker", label: "Stickers" },
    { id: "code", label: "Studio IDE" },
    { id: "spec", label: "Spec Sheets" },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-col items-center gap-4 text-center">
        <LiTTFace mood={mood} size={140} />
        <div>
          <h1 className="text-2xl font-bold" style={{ color: LITT.text }}>
            LiTT Studio Hub
          </h1>
          <p className="text-sm" style={{ color: LITT.textMuted }}>
            Model-agnostic AI companion for LiTTree Lab Studios
          </p>
        </div>
      </div>

      {errorNotice && (
        <div
          className="mb-4 rounded-lg border px-4 py-3 text-sm"
          style={{
            borderColor: LITT.danger,
            backgroundColor: "rgba(239,68,68,0.1)",
            color: LITT.danger,
          }}
        >
          Provider error: {errorNotice}. LiTT fell back to static mode.
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
            style={{
              borderColor: activeTab === t.id ? LITT.accentCyan : LITT.border,
              backgroundColor:
                activeTab === t.id ? "rgba(163,245,70,0.12)" : LITT.bgPanel,
              color: activeTab === t.id ? LITT.accentCyan : LITT.textMuted,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid min-h-[560px] grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {activeTab === "chat" && (
            <LiTTChat
              messages={messages}
              loading={loading}
              provider={provider}
              onProviderChange={setProvider}
              onSend={sendMessage}
            />
          )}
          {activeTab === "music" && <MusicLab onSendToLiTT={sendMessage} />}
          {activeTab === "sticker" && (
            <StickerCanvas onSendToLiTT={sendMessage} />
          )}
          {activeTab === "code" && <StudioIDE onSendToLiTT={sendMessage} />}
          {activeTab === "spec" && <SpecSheets onSendToLiTT={sendMessage} />}
        </div>

        <div className="space-y-4">
          <div
            className="rounded-2xl border p-5"
            style={{ borderColor: LITT.border, backgroundColor: LITT.bgPanel }}
          >
            <h3
              className="mb-3 text-sm font-bold uppercase tracking-wide"
              style={{ color: LITT.text }}
            >
              Status
            </h3>
            <div
              className="space-y-2 text-sm"
              style={{ color: LITT.textMuted }}
            >
              <p>
                <span className="font-semibold" style={{ color: LITT.text }}>
                  Mood:
                </span>{" "}
                {mood}
              </p>
              <p>
                <span className="font-semibold" style={{ color: LITT.text }}>
                  Provider:
                </span>{" "}
                {provider || "auto"}
              </p>
              <p>
                <span className="font-semibold" style={{ color: LITT.text }}>
                  Messages:
                </span>{" "}
                {messages.length}
              </p>
            </div>
          </div>

          <div
            className="rounded-2xl border p-5"
            style={{ borderColor: LITT.border, backgroundColor: LITT.bgPanel }}
          >
            <h3
              className="mb-3 text-sm font-bold uppercase tracking-wide"
              style={{ color: LITT.text }}
            >
              Provider chain
            </h3>
            <ol className="space-y-2 text-sm" style={{ color: LITT.textMuted }}>
              <li className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: LITT.accentCyan }}
                />
                OpenRouter (primary)
              </li>
              <li className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: LITT.accentOrange }}
                />
                Groq (fast fallback)
              </li>
              <li className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: LITT.success }}
                />
                Ollama (local/private)
              </li>
              <li className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: LITT.textDim }}
                />
                Static fallback (always works)
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
