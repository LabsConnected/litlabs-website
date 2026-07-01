"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { AGENTS, buildSystemPrompt } from "@/lib/agents";
import { loadProjectContext } from "@/lib/project-context";
import { ArrowLeft, Send, Circle, Loader2 } from "lucide-react";

type ChatMessage = { role: "user" | "agent"; text: string };

export default function AgentPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const agent = AGENTS[slug] ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (isLoaded && !isSignedIn) router.push(`/sign-in?redirect_url=/agents/${slug}`);
  }, [isLoaded, isSignedIn, router, slug]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: T.bgColor }}>
        <Loader2 size={28} className="animate-spin" style={{ color: T.accentColor }} />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
        <div className="text-4xl">🤖</div>
        <div className="text-lg font-bold">Agent not found</div>
        <Link href="/agents" className="text-sm underline" style={{ color: T.accentColor }}>← Back to agents</Link>
      </div>
    );
  }

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setSending(true);
    try {
      const ctx = loadProjectContext();
      const systemPrompt = buildSystemPrompt(agent.systemPrompt, ctx ?? undefined);
      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: text }], systemPrompt, stream: false }),
      });
      const data = await res.json();
      const reply = data.text || data.response || "…";
      setMessages((prev) => [...prev, { role: "agent", text: reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: "agent", text: "Connection error. Try again." }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b shrink-0"
        style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "20" }}>
        <Link href="/agents" className="flex items-center gap-1.5 text-xs hover:opacity-70 transition-opacity shrink-0"
          style={{ color: T.textMuted }}>
          <ArrowLeft size={13} /> Agents
        </Link>
        <div className="w-px h-4 shrink-0" style={{ backgroundColor: T.borderColor + "40" }} />
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: agent.color + "20", border: `1px solid ${agent.color}30` }}>
          <span className="text-base">🤖</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-black truncate" style={{ color: T.textColor }}>{agent.name}</div>
          <div className="text-[10px] truncate" style={{ color: agent.color }}>{agent.role}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Circle size={6} className="fill-current animate-pulse" style={{ color: agent.color }} />
          <span className="text-[9px] font-bold" style={{ color: agent.color }}>ONLINE</span>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — agent info */}
        <div className="hidden lg:flex flex-col w-64 shrink-0 border-r overflow-y-auto p-5 gap-5"
          style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "80" }}>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>Role</div>
            <div className="text-sm font-bold" style={{ color: T.textColor }}>{agent.role}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>Personality</div>
            <div className="text-xs italic" style={{ color: T.textMuted }}>{agent.personality}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>Domains</div>
            <div className="flex flex-wrap gap-1">
              {agent.domains.map((d) => (
                <span key={d} className="text-[9px] px-2 py-0.5 rounded-full font-bold capitalize"
                  style={{ backgroundColor: agent.color + "15", color: agent.color }}>{d}</span>
              ))}
            </div>
          </div>
          <div className="mt-auto pt-4 border-t" style={{ borderColor: T.borderColor + "20" }}>
            <Link href="/studio?tool=agents"
              className="block w-full py-2 rounded-xl text-xs font-black text-center transition-all hover:scale-[1.02]"
              style={{ backgroundColor: agent.color + "20", color: agent.color, border: `1px solid ${agent.color}30` }}>
              Open in Studio Terminal
            </Link>
          </div>
        </div>

        {/* Chat area */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.length === 0 && (
              <div className="flex justify-start">
                <div className="max-w-lg rounded-2xl rounded-tl-sm px-4 py-3"
                  style={{ backgroundColor: agent.color + "12", border: `1px solid ${agent.color}20` }}>
                  <div className="text-[10px] font-bold mb-1" style={{ color: agent.color }}>{agent.name}</div>
                  <p className="text-sm leading-relaxed" style={{ color: T.textColor }}>
                    Hey — I&apos;m {agent.name}. {agent.personality.split("·")[0].trim()}. What do you need?
                  </p>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-lg rounded-2xl px-4 py-3 ${msg.role === "user" ? "rounded-tr-sm" : "rounded-tl-sm"}`}
                  style={{
                    backgroundColor: msg.role === "user" ? T.accentColor + "15" : agent.color + "12",
                    border: `1px solid ${msg.role === "user" ? T.accentColor + "25" : agent.color + "20"}`,
                  }}>
                  <div className="text-[10px] font-bold mb-1"
                    style={{ color: msg.role === "user" ? T.accentColor : agent.color }}>
                    {msg.role === "user" ? "You" : agent.name}
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: T.textColor }}>{msg.text}</p>
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-tl-sm px-4 py-3"
                  style={{ backgroundColor: agent.color + "12", border: `1px solid ${agent.color}20` }}>
                  <div className="flex items-center gap-2 text-xs" style={{ color: agent.color }}>
                    <Loader2 size={12} className="animate-spin" /> {agent.name} is thinking…
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input bar */}
          <div className="shrink-0 px-5 py-4 border-t" style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "80" }}>
            <div className="flex gap-3">
              <input value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendMessage())}
                placeholder={`Message ${agent.name}…`}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none transition-all"
                style={{ backgroundColor: T.bgColor + "80", border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
              <button onClick={sendMessage} disabled={!input.trim() || sending}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 disabled:opacity-40"
                style={{ backgroundColor: agent.color, color: "#000" }}>
                <Send size={15} />
              </button>
            </div>
            <div className="text-[9px] mt-1.5" style={{ color: T.textMuted }}>
              Powered by Gemini · Enter to send · Project context auto-injected from{" "}
              <Link href="/dashboard?tab=settings&section=project" className="underline hover:opacity-70" style={{ color: agent.color }}>settings</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
