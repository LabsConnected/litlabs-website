"use client";

import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  HelpCircle,
  Image,
  Wrench,
  Code,
  Bot,
  Search,
  Brain,
  Rocket,
  Send,
  X,
  Sparkles,
} from "lucide-react";
import type { DirectorMode } from "./DirectorCard";

const MODES: {
  id: DirectorMode;
  label: string;
  icon: typeof HelpCircle;
  placeholder: string;
}[] = [
  {
    id: "ask",
    label: "Ask",
    icon: HelpCircle,
    placeholder: "Ask LiTT anything...",
  },
  {
    id: "image",
    label: "Image",
    icon: Image,
    placeholder: "Describe an image...",
  },
  {
    id: "build",
    label: "Build",
    icon: Wrench,
    placeholder: "What should LiTT build?",
  },
  {
    id: "code",
    label: "Code",
    icon: Code,
    placeholder: "Inspect, fix, or explain code...",
  },
  {
    id: "agent",
    label: "Agent",
    icon: Bot,
    placeholder: "Create or control an agent...",
  },
  {
    id: "search",
    label: "Search",
    icon: Search,
    placeholder: "Search the web or project...",
  },
  {
    id: "memory",
    label: "Memory",
    icon: Brain,
    placeholder: "Remember or recall...",
  },
  {
    id: "deploy",
    label: "Deploy",
    icon: Rocket,
    placeholder: "Deploy or preview...",
  },
];

export function DirectorDrawer({
  open,
  onCloseAction,
  initialMode = "ask",
}: {
  open: boolean;
  onCloseAction: () => void;
  initialMode?: DirectorMode;
}) {
  const { resolvedColors: T } = useTheme();
  const [mode, setMode] = useState<DirectorMode>(initialMode);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<
    { role: "user" | "agent"; content: string }[]
  >([
    { role: "agent", content: "I'm LiTT Director. What would you like to do?" },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const activeMode = MODES.find((m) => m.id === mode) ?? MODES[0];
  const ActiveIcon = activeMode.icon;

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const text = input;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      let response: string;
      if (mode === "image") {
        const res = await fetch("/api/studio/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text, format: "image" }),
        });
        const data = await res.json();
        if (!res.ok || data.error)
          throw new Error(data.error || "Image generation failed");
        response = `Generated image: ${data.thumbUrl || data.downloadUrl || data.url}`;
      } else {
        const res = await fetch("/api/agents/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: "director", message: text }),
        });
        const data = await res.json();
        response =
          data.response ||
          data.answer ||
          data.message ||
          data.text ||
          data.error ||
          "LiTT is thinking...";
      }
      setMessages((prev) => [...prev, { role: "agent", content: response }]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Request failed";
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: `Error: ${errorMsg}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        onClick={onCloseAction}
      />
      <div
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l shadow-2xl lg:left-[256px] lg:w-[420px]"
        style={{
          backgroundColor: T.bgColor,
          borderColor: T.borderColor,
        }}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: T.borderColor }}
        >
          <div className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ backgroundColor: T.accentColor + "20" }}
            >
              <Sparkles size={16} style={{ color: T.accentColor }} />
            </div>
            <div>
              <div
                className="text-sm font-black"
                style={{ color: T.headerColor }}
              >
                LiTT Director
              </div>
              <div className="text-[10px] opacity-60">Working in: LitLabs</div>
            </div>
          </div>
          <button
            onClick={onCloseAction}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800/50"
            aria-label="Close Director"
          >
            <X size={18} />
          </button>
        </div>

        <div
          className="flex gap-1 overflow-x-auto border-b px-3 py-2 scrollbar-none"
          style={{ borderColor: T.borderColor }}
        >
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition ${
                  mode === m.id
                    ? "bg-cyan-500/10 text-cyan-300"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <Icon size={12} /> {m.label}
              </button>
            );
          })}
        </div>

        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                  m.role === "user"
                    ? "bg-cyan-500/15 border border-cyan-500/25 text-cyan-100"
                    : "bg-neutral-900/60 border border-neutral-800/60 text-neutral-200"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl bg-neutral-900/60 border border-neutral-800/60 px-3.5 py-2.5 text-sm text-neutral-300">
                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-xs">LiTT is thinking...</span>
              </div>
            </div>
          )}
        </div>

        <div className="border-t p-3" style={{ borderColor: T.borderColor }}>
          <div
            className="flex items-center gap-2 rounded-xl border px-3 py-2"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <ActiveIcon size={16} style={{ color: T.accentColor }} />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={activeMode.placeholder}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              style={{ color: T.textColor }}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="rounded-lg p-2 transition disabled:opacity-40"
              style={{
                backgroundColor: T.accentColor + "20",
                color: T.accentColor,
              }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
