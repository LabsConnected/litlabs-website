"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Send, Bot, User, Loader2, Sparkles, Trash2, Copy, Check, ChevronRight } from "lucide-react";
import { AGENTS } from "@/lib/agents";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  agentSlug?: string;
}

const STORAGE_KEY = "litlabs-studio-chat";
const AGENT_STORAGE_KEY = "litlabs-studio-chat-agent";
const PROVIDER_STORAGE_KEY = "litlabs-studio-chat-provider";

const PROVIDER_OPTIONS = [
  { id: "gemini", label: "Gemini 2.5 Flash", hint: "Creative + general chat" },
  { id: "openrouter-free", label: "OpenRouter Free", hint: "Free fallback with tool access" },
];

type AgentProfile = (typeof AGENTS)[keyof typeof AGENTS] & { color: string };
const AGENT_LIST: AgentProfile[] = Object.values(AGENTS).map((agent) => ({
  ...agent,
  color: (agent as AgentProfile).color ?? "#ffffff",
}));

export default function ChatTool() {
  const { resolvedColors: T } = useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [agentSlugSettled, setAgentSlugSettled] = useState(() => {
    try {
      return window.localStorage.getItem(AGENT_STORAGE_KEY) || AGENT_LIST[0]?.id || "director";
    } catch {
      return AGENT_LIST[0]?.id ?? "director";
    }
  });
  const [provider, setProvider] = useState(() => {
    try {
      return window.localStorage.getItem(PROVIDER_STORAGE_KEY) || "gemini";
    } catch {
      return "gemini";
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!messages.length) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)));
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    try {
      window.localStorage.setItem(AGENT_STORAGE_KEY, agentSlugSettled);
    } catch { /* ignore */ }
  }, [agentSlugSettled]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
    } catch { /* ignore */ }
  }, [provider]);

  const selectedAgent = useMemo(() => AGENT_LIST.find((agent) => agent.id === agentSlugSettled) ?? AGENT_LIST[0], [agentSlugSettled]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userId = `u_${Date.now()}`;
    const assistantId = `a_${Date.now()}`;

    const userMsg: ChatMessage = {
      id: userId,
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
      agentSlug: agentSlugSettled,
    };

    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "", timestamp: Date.now(), agentSlug: agentSlugSettled }]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: agentSlugSettled,
          message: trimmed,
          provider,
          stream: true,
          history: messages.map((msg) => ({ role: msg.role, content: msg.content })),
        }),
      });

      if (!response.ok) {
        const payload = await response.text();
        throw new Error(payload || "Failed to get response");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const data = await response.json();
        setMessages((prev) => prev.map((msg) => (msg.id === assistantId ? { ...msg, content: data.response || "No response" } : msg)));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const segments = buffer.split("\n\n");
        buffer = segments.pop() ?? "";
        for (const segment of segments) {
          const trimmedSegment = segment.trim();
          if (!trimmedSegment.startsWith("data:")) continue;
          const payload = trimmedSegment.replace(/^data:\s*/, "");
          if (payload === "[DONE]") continue;
          let parsed;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          if (parsed.text) {
            const chunk = String(parsed.text);
            setMessages((prev) => prev.map((msg) => (msg.id === assistantId ? { ...msg, content: msg.content + chunk } : msg)));
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => prev.map((msg) => (msg.id === assistantId ? { ...msg, content: "⚠️ Agent unavailable right now." } : msg)));
    } finally {
      setIsLoading(false);
    }
  }, [agentSlugSettled, input, isLoading, messages, provider]);

  const handleKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const clearChat = () => {
    setMessages([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b" style={{ borderColor: T.borderColor + "20" }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: T.accentColor }} />
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color: T.textMuted }}>
                Agent Chat
              </div>
              <p className="text-[9px] opacity-70" style={{ color: T.textMuted }}>
                Unified model control · Gemini/OpenRouter streaming
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {PROVIDER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setProvider(option.id)}
                className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-[0.2em] transition-all ${
                  provider === option.id ? "bg-white text-black" : "border border-white/20"
                }`}
                style={{
                  backgroundColor: provider === option.id ? T.accentColor : "transparent",
                  color: provider === option.id ? T.bgColor : T.textColor,
                }}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              onClick={clearChat}
              className="flex items-center gap-1 px-3 py-1 rounded-full border text-[10px] font-bold"
              style={{ borderColor: T.borderColor, color: T.textMuted }}
            >
              <Trash2 size={12} /> Reset
            </button>
          </div>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {AGENT_LIST.map((agent) => {
            const active = agent.id === agentSlugSettled;
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => setAgentSlugSettled(agent.id)}
                className={`flex items-center gap-3 min-w-[170px] rounded-2xl border px-3 py-2 text-left transition-all ${
                  active ? "border-transparent bg-white/90" : "border-white/15"
                }`}
                style={{
                  backgroundColor: active ? `linear-gradient(135deg, ${agent.color}, ${T.accentColor})` : T.boxBg,
                  color: active ? T.bgColor : T.textColor,
                }}
              >
                <div className="text-sm" aria-hidden>
                  {agent.name.charAt(0)}
                </div>
                <div>
                  <div className="font-black uppercase tracking-[0.2em] text-[10px]">{agent.name}</div>
                  <p className="text-[9px] opacity-70">{agent.role}</p>
                </div>
                <ChevronRight size={14} className="ml-auto" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ backgroundColor: T.bgColor }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center opacity-70" style={{ color: T.textMuted }}>
            <Bot size={32} />
            <p className="text-xs">Select an agent + provider to start a conversation.</p>
            <p className="text-[10px]">History stays local — refresh to begin a new chat.</p>
          </div>
        )}
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div key={msg.id} className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: T.success + "20" }}>
                  <Bot size={12} style={{ color: T.success }} />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  isUser ? "rounded-br-sm" : "rounded-bl-sm"
                }`}
                style={{
                  backgroundColor: isUser ? T.accentColor + "15" : T.boxBg,
                  border: `1px solid ${isUser ? T.accentColor + "30" : T.borderColor + "30"}`,
                  color: T.textColor,
                }}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
                {!isUser && (
                  <div className="flex items-center gap-2 mt-2 text-[9px] opacity-60" style={{ color: T.textMuted }}>
                    <span>{selectedAgent?.name}</span>
                    <span className="flex-1 h-px" style={{ backgroundColor: T.borderColor + "40" }} />
                    <button onClick={() => copyText(msg.id, msg.content)} className="hover:opacity-80 transition-opacity">
                      {copiedId === msg.id ? <Check size={10} /> : <Copy size={10} />}
                    </button>
                  </div>
                )}
              </div>
              {isUser && (
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: T.linkColor + "20" }}>
                  <User size={12} style={{ color: T.linkColor }} />
                </div>
              )}
            </div>
          );
        })}
        {isLoading && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: T.accentColor + "20" }}>
              <Loader2 size={12} className="animate-spin" />
            </div>
            <span className="px-3 py-2 rounded-2xl text-xs" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}30` }}>
              Streaming {selectedAgent?.name}...
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="px-4 py-3 border-t" style={{ borderColor: T.borderColor + "20" }}>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={`Ask ${selectedAgent?.name || "an agent"} anything...`}
            rows={1}
            disabled={isLoading}
            className="flex-1 px-3 py-2 text-sm rounded-2xl outline-none resize-none min-h-[48px] max-h-[160px] disabled:opacity-50"
            style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            aria-label="Send message"
            className="px-4 py-2 rounded-2xl font-bold text-sm uppercase tracking-[0.2em] flex items-center gap-2 transition-all disabled:opacity-40"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send
          </button>
        </div>
        <div className="text-[9px] mt-1 text-center opacity-50" style={{ color: T.textMuted }}>
          Shift+Enter for newline • Powered by Gemini + OpenRouter
        </div>
      </div>
    </div>
  );
}
