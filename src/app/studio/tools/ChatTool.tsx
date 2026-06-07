"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Send, Bot, User, Loader2, Sparkles, Trash2, Copy, Check } from "lucide-react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  timestamp: number;
}

const MODELS = [
  { id: "openai", label: "GPT-4o", provider: "OpenAI", color: "#10a37f" },
  { id: "claude", label: "Claude 3.5", provider: "Anthropic", color: "#d4a574" },
  { id: "gemini", label: "Gemini 1.5", provider: "Google", color: "#4285f4" },
  { id: "deepseek", label: "DeepSeek", provider: "DeepSeek", color: "#4d6bfa" },
  { id: "grok", label: "Grok", provider: "xAI", color: "#1d9bf0" },
  { id: "mistral", label: "Mistral", provider: "Mistral", color: "#ff7000" },
];

const STORAGE_KEY = "litlabs-studio-chat";

export default function ChatTool() {
  const { resolvedColors: T } = useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("openai");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /* Load history */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  /* Persist */
  useEffect(() => {
    if (messages.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)));
  }, [messages]);

  /* Auto scroll */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a helpful AI assistant. Be concise and direct." },
            { role: "user", content: text },
          ],
          stream: false,
        }),
      });

      const data = await res.json();
      const assistantText = data.choices?.[0]?.message?.content || "No response";

      setMessages(prev => [...prev, {
        id: `a_${Date.now()}`,
        role: "assistant",
        content: assistantText,
        model,
        timestamp: Date.now(),
      }]);
    } catch {
      setMessages(prev => [...prev, {
        id: `a_${Date.now()}`,
        role: "assistant",
        content: "⚠️ Request failed. Pollinations API may be unavailable or rate-limited.",
        model,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, model]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const clearChat = () => { setMessages([]); localStorage.removeItem(STORAGE_KEY); };

  const selectedModel = MODELS.find(m => m.id === model);

  return (
    <div className="flex flex-col h-full">
      {/* Model selector bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0" style={{ borderColor: T.borderColor + "20" }}>
        <div className="flex items-center gap-2">
          <Sparkles size={12} style={{ color: T.accentColor }} />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>AI Chat</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="text-[10px] font-bold px-2 py-1 rounded outline-none border"
            style={{ backgroundColor: T.bgColor, borderColor: T.borderColor, color: T.textColor }}
          >
            {MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label} — {m.provider}</option>
            ))}
          </select>
          {selectedModel && (
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: selectedModel.color, boxShadow: `0 0 6px ${selectedModel.color}` }} />
          )}
          <button onClick={clearChat} className="p-1 rounded hover:opacity-70" style={{ color: T.textMuted }} title="Clear chat">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
            <Bot size={32} />
            <p className="text-xs">Start a conversation with {selectedModel?.label || "AI"}</p>
            <p className="text-[10px] max-w-xs text-center">Powered by Pollinations.ai — no API key needed for basic usage</p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: selectedModel?.color + "20" }}>
                <Bot size={12} style={{ color: selectedModel?.color }} />
              </div>
            )}
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed ${msg.role === "user" ? "rounded-br-sm" : "rounded-bl-sm"}`}
              style={{
                backgroundColor: msg.role === "user" ? T.accentColor + "15" : T.boxBg,
                border: `1px solid ${msg.role === "user" ? T.accentColor + "30" : T.borderColor + "30"}`,
                color: T.textColor,
              }}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.role === "assistant" && (
                <div className="flex items-center gap-2 mt-1.5 pt-1 border-t" style={{ borderColor: T.borderColor + "20" }}>
                  <span className="text-[8px] opacity-40 uppercase tracking-wider">{msg.model || model}</span>
                  <button onClick={() => copyText(msg.id, msg.content)} className="opacity-40 hover:opacity-100 transition-opacity">
                    {copiedId === msg.id ? <Check size={10} /> : <Copy size={10} />}
                  </button>
                </div>
              )}
            </div>
            {msg.role === "user" && (
              <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: T.linkColor + "20" }}>
                <User size={12} style={{ color: T.linkColor }} />
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: selectedModel?.color + "20" }}>
              <Bot size={12} style={{ color: selectedModel?.color }} />
            </div>
            <div className="px-3 py-2 rounded-lg text-xs flex items-center gap-1.5" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}30` }}>
              <Loader2 size={12} className="animate-spin" /> Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: T.borderColor + "20" }}>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={`Ask ${selectedModel?.label || "AI"} anything...`}
            rows={1}
            disabled={isLoading}
            className="flex-1 px-3 py-2 text-sm rounded-lg outline-none resize-none min-h-[40px] max-h-[120px] disabled:opacity-50"
            style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="px-3 py-2 rounded-lg font-bold text-sm flex items-center gap-1 disabled:opacity-40 transition-all hover:scale-105"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            <Send size={14} />
          </button>
        </div>
        <div className="text-[9px] mt-1.5 opacity-40 text-center" style={{ color: T.textMuted }}>
          Shift+Enter for new line · Powered by Pollinations.ai
        </div>
      </div>
    </div>
  );
}
