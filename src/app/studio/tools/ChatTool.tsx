"use client";

import { useState } from "react";
import { useProfile } from "@/context/ProfileContext";
import ChatShell from "../components/ChatShell";

type Message = {
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

  const send = async (
    value: string,
    attachments?: string[],
  ): Promise<string> => {
    const text = value.trim();
    if ((!text && !attachments?.length) || busy) return "";
    const historyForApi = [
      ...messages,
      { role: "user" as const, content: text || "(image)" },
    ];
    setMessages((current) => [
      ...current,
      {
        role: "user" as const,
        content: text || "(image)",
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
          message: text || "Describe what you see.",
          history: historyForApi,
          stream: false,
          userName: profile.displayName || "Creator",
          images: attachments,
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
        { role: "assistant", content: reply, createdAt: Date.now() },
      ]);
      return reply;
    } catch (error) {
      const reply =
        error instanceof Error ? error.message : "LiTT is reconnecting";
      setMessages((current) => [
        ...current,
        { role: "assistant", content: reply, createdAt: Date.now() },
      ]);
      return reply;
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = () => {
    const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIndex === -1) return;
    const trimmed = messages.slice(0, lastUserIndex + 1);
    setMessages(trimmed);
    void send(trimmed[lastUserIndex].content);
  };

  return (
    <ChatShell
      selectedModel={selectedModel}
      messages={messages}
      busy={busy}
      onSend={send}
      onNewChat={() => setMessages([])}
      onRegenerate={handleRegenerate}
    />
  );
}
