"use client";

import { useState, useRef, useEffect } from "react";
import {
  MessageSquare,
  Terminal as TerminalIcon,
  Send,
  Mic,
  Paperclip,
  Sparkles,
} from "lucide-react";
import { TerminalPanel, TerminalPanelHandle } from "./TerminalPanel";

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  agent?: string;
};

const SUGGESTED = [
  "Build me a landing page",
  "Generate hero image for my startup",
  "Audit my API routes",
  "Deploy current project",
];

export function ChatTerminal({
  onLogAction,
  onCommandAction,
  onConnectionChangeAction,
  onTerminalOutputAction,
  agentId = "director",
}: {
  onLogAction: (entry: string) => void;
  onCommandAction: (cmd: string) => void;
  onConnectionChangeAction: (connected: boolean) => void;
  onTerminalOutputAction: (output: string) => void;
  agentId?: string;
}) {
  const [mode, setMode] = useState<"chat" | "terminal">("chat");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "agent",
      content:
        "Welcome to LiTT Code. I'm Director. What do you want to build today?",
      agent: "Director",
    },
  ]);
  const terminalRef = useRef<TerminalPanelHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);
  const nextId = () => {
    idCounter.current += 1;
    return `${idCounter.current}`;
  };

  useEffect(() => {
    if (scrollRef.current && mode === "chat") {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, mode]);

  const sendChat = async (text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = {
      id: `u_${nextId()}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    onLogAction(`[CHAT] User: ${text}`);

    try {
      const res = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, message: text }),
      });
      const data = await res.json();
      const answer =
        data.response || data.answer || data.error || "LiTT is thinking...";
      const agentMsg: ChatMessage = {
        id: `a_${nextId()}`,
        role: "agent",
        content: answer,
        agent: "Director",
      };
      setMessages((prev) => [...prev, agentMsg]);
      onLogAction(`[CHAT] Director: ${answer.slice(0, 120)}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Request failed";
      const agentMsg: ChatMessage = {
        id: `a_${nextId()}`,
        role: "agent",
        content: `Error: ${errorMsg}`,
        agent: "Director",
      };
      setMessages((prev) => [...prev, agentMsg]);
      onLogAction(`[CHAT] Error: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const runAsCommand = () => {
    if (!input.trim()) return;
    if (mode === "terminal") {
      terminalRef.current?.runCommand(input);
    } else {
      // Prefix with / to treat chat as terminal command
      terminalRef.current?.runCommand(input);
      onCommandAction(input);
      onLogAction(`[CMD] ${input}`);
    }
    setInput("");
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-neutral-800/60 bg-black/40 backdrop-blur-sm overflow-hidden">
      {/* Header tabs */}
      <div className="flex items-center justify-between border-b border-neutral-800/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-neutral-800/60 bg-neutral-900/60 p-0.5">
            <button
              onClick={() => setMode("chat")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                mode === "chat"
                  ? "bg-cyan-500/15 text-cyan-300"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <MessageSquare size={13} /> Chat
            </button>
            <button
              onClick={() => setMode("terminal")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                mode === "terminal"
                  ? "bg-orange-500/15 text-orange-300"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <TerminalIcon size={13} /> Terminal
            </button>
          </div>
        </div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
          {mode === "chat" ? "Natural language" : "Shell execution"}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 relative">
        {mode === "chat" ? (
          <div
            ref={scrollRef}
            className="absolute inset-0 overflow-y-auto p-4 space-y-3"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                    m.role === "user"
                      ? "bg-cyan-500/15 border border-cyan-500/25 text-cyan-100"
                      : "bg-neutral-900/60 border border-neutral-800/60 text-neutral-200"
                  }`}
                >
                  {m.role === "agent" && m.agent ? (
                    <div
                      className="mb-1 text-[10px] font-black uppercase tracking-wider"
                      style={{ color: "#22d3ee" }}
                    >
                      {m.agent}
                    </div>
                  ) : null}
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
        ) : (
          <div className="absolute inset-0 p-2">
            <TerminalPanel
              ref={terminalRef}
              onLog={onLogAction}
              onCommand={onCommandAction}
              onConnectionChange={onConnectionChangeAction}
              onTerminalOutput={onTerminalOutputAction}
            />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-neutral-800/60 p-3">
        {mode === "chat" && messages.length < 3 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTED.map((s) => (
              <button
                key={s}
                onClick={() => sendChat(s)}
                className="rounded-full border border-neutral-800/60 bg-neutral-900/40 px-2.5 py-1 text-[10px] font-semibold text-neutral-300 hover:border-cyan-500/30 hover:text-cyan-300 transition"
              >
                <Sparkles size={10} className="inline mr-1 text-cyan-500/70" />
                {s}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-2 rounded-xl border border-neutral-800/60 bg-neutral-900/60 px-3 py-2 focus-within:border-cyan-500/40 focus-within:shadow-[0_0_12px_rgba(34,211,238,0.12)] transition-all">
          <button
            className="text-neutral-500 hover:text-neutral-300"
            aria-label="Attach"
          >
            <Paperclip size={16} />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (mode === "chat") {
                  sendChat(input);
                } else {
                  runAsCommand();
                }
              }
            }}
            placeholder={
              mode === "chat"
                ? "What do you want to build?"
                : "Type command and press Enter..."
            }
            className="flex-1 bg-transparent text-sm text-neutral-100 placeholder:text-neutral-500 outline-none"
          />
          <button
            onClick={() => (mode === "chat" ? sendChat(input) : runAsCommand())}
            className="rounded-lg bg-cyan-500/15 p-2 text-cyan-300 hover:bg-cyan-500/25 transition"
            aria-label="Send"
          >
            <Send size={16} />
          </button>
          <button
            className="rounded-lg bg-neutral-800/60 p-2 text-neutral-400 hover:text-neutral-200 transition"
            aria-label="Voice"
          >
            <Mic size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
