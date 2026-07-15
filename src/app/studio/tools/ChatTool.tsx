"use client";

import { useState } from "react";
import { useProfile } from "@/context/ProfileContext";
import ChatShell from "../components/ChatShell";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
};

const MODEL_MAP: Record<string, { provider: string; model: string }> = {
  adaptive: { provider: "gemini", model: "gemini-2.5-flash" },
  "gemini-2.5-flash": { provider: "gemini", model: "gemini-2.5-flash" },
  "gpt-4o": { provider: "openai", model: "gpt-4o" },
  "claude-3.5-sonnet": {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
  },
  "ollama-local": { provider: "ollama", model: "llama3" },
};

export default function ChatTool({
  selectedModel = "adaptive",
}: {
  selectedModel?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const { profile } = useProfile();

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const userId = crypto.randomUUID();
    const historyForApi = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    setMessages((current) => [
      ...current,
      {
        id: userId,
        role: "user" as const,
        content: trimmed,
        createdAt: Date.now(),
      },
    ]);
    setBusy(true);
    const modelConfig = MODEL_MAP[selectedModel] ?? MODEL_MAP.adaptive;
    try {
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: "littcode",
          provider: modelConfig.provider,
          model: modelConfig.model,
          message: trimmed,
          history: historyForApi,
          stream: false,
          userName: profile.displayName || "Creator",
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || err.error || "LiTT is reconnecting");
      }
      const data = await response.json();
      const reply =
        data.response ||
        data.text ||
        data.message ||
        data.content ||
        "I’m ready. Tell me what we’re building.";
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: reply,
          createdAt: Date.now(),
        },
      ]);
      return reply;
    } catch (error) {
      const reply =
        error instanceof Error ? error.message : "LiTT is reconnecting";
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: reply,
          createdAt: Date.now(),
        },
      ]);
      return reply;
    } finally {
      setBusy(false);
    }
  };

  return (
    <ChatShell
      messages={messages}
      sending={busy}
      systemLines={[]}
      onSend={send}
    />
  );
}
