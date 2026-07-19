"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { AGENTS } from "@/lib/agents";
import { getCommandsForAgent, executeCommand } from "@/lib/agentCommands";
import { ArrowLeft, Circle, Loader2, Terminal, Command, HelpCircle, Clock } from "lucide-react";

type ChatMessage = { role: "user" | "agent" | "system"; text: string; isCommand?: boolean };

const KONAMI_CODE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"] as const;

export default function AgentPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const agent = AGENTS[slug] ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  
  // Konami code easter egg
  const [konamiSequence, setKonamiSequence] = useState<string[]>([]);
  const [easterEggUnlocked, setEasterEggUnlocked] = useState(false);
  const [terminalInput, setTerminalInput] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showHelp, setShowHelp] = useState(false);
  const terminalInputRef = useRef<HTMLInputElement>(null);
  
  const commands = agent ? getCommandsForAgent(agent.id) : [];

  useEffect(() => {
    if (isLoaded && !isSignedIn) router.push(`/sign-in?redirect_url=/agents/${slug}`);
  }, [isLoaded, isSignedIn, router, slug]);

  // Konami code easter egg detection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const newSequence = [...konamiSequence, key].slice(-10);
      setKonamiSequence(newSequence);
      
      if (newSequence.join(",") === KONAMI_CODE.join(",")) {
        setEasterEggUnlocked(true);
        setMessages((prev) => [...prev, { 
          role: "system", 
          text: "🎮 KONAMI CODE ACTIVATED! Secret mode unlocked. You've discovered the hidden agent protocol. Type /matrix or /vault for bonus commands.",
          isCommand: true
        }]);
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [konamiSequence]);

  // Focus terminal input on mount
  useEffect(() => {
    terminalInputRef.current?.focus();
  }, []);

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

  const handleCommand = async (command: string) => {
    const isCommand = command.startsWith("/");
    const cleanCommand = isCommand ? command.slice(1) : command;
    
    setMessages((prev) => [...prev, { role: "user", text: command, isCommand }]);
    setCommandHistory((prev) => [...prev, command]);
    setHistoryIndex(-1);
    
    if (isCommand) {
      try {
        const response = await executeCommand(agent, cleanCommand);
        setMessages((prev) => [...prev, { role: "system", text: response, isCommand: true }]);
      } catch (error) {
        setMessages((prev) => [...prev, { role: "system", text: "Error: " + (error instanceof Error ? error.message : "Unknown error"), isCommand: true }]);
      }
    } else {
      await sendMessage(command);
    }
  };

  const sendMessage = async (text: string) => {
    if (sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: agent.id,
          message: text,
          history: messages
            .filter((m) => m.role === "user" || m.role === "agent")
            .map((m) => ({
              role: m.role === "user" ? "user" : "assistant",
              content: m.text,
            })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }
      const reply = data.response || data.text || "…";
      setMessages((prev) => [...prev, { role: "agent", text: reply }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          text: `Error: ${err instanceof Error ? err.message : "Connection error. Try again."}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleTerminalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const command = terminalInput.trim();
    if (!command || sending) return;
    setTerminalInput("");
    handleCommand(command);
  };

  const handleTerminalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setTerminalInput(commandHistory[commandHistory.length - 1 - newIndex]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setTerminalInput(commandHistory[commandHistory.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setTerminalInput("");
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      const match = commands.find((cmd) => cmd.name.startsWith(terminalInput.toLowerCase()));
      if (match) {
        setTerminalInput(match.name);
      }
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
          <Terminal size={16} style={{ color: agent.color }} />
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

      {/* Easter egg indicator */}
      {easterEggUnlocked && (
        <div className="px-5 py-2 border-b animate-pulse"
          style={{ 
            borderColor: "#00ff00", 
            backgroundColor: "rgba(0, 255, 0, 0.1)" 
          }}>
          <div className="text-[10px] font-mono text-center" style={{ color: "#00ff00" }}>
            🎮 SECRET MODE ACTIVATED - Type /matrix or /vault
          </div>
        </div>
      )}

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
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>Quick Commands</div>
            <div className="flex flex-wrap gap-1">
              {commands.slice(0, 4).map((cmd) => (
                <button
                  key={cmd.name}
                  onClick={() => handleCommand("/" + cmd.name)}
                  className="text-[9px] px-2 py-0.5 rounded font-mono transition-all hover:scale-105"
                  style={{ backgroundColor: agent.color + "15", color: agent.color }}
                >
                  /{cmd.name}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-auto pt-4 border-t" style={{ borderColor: T.borderColor + "20" }}>
            <Link href="/studio"
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
                    Hey — I&apos;m {agent.name}. {agent.personality.split("·")[0].trim()}. Use terminal commands or just chat. Type /help for commands.
                  </p>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={"flex " + (msg.role === "user" ? "justify-end" : msg.role === "system" ? "justify-center" : "justify-start")}>
                {msg.role === "system" ? (
                  <div className="max-w-2xl w-full rounded-xl px-4 py-3 font-mono text-sm"
                    style={{
                      backgroundColor: agent.color + "08",
                      border: "1px solid " + agent.color + "20",
                      color: agent.color,
                    }}>
                    <pre className="whitespace-pre-wrap">{msg.text}</pre>
                  </div>
                ) : (
                  <div className={"max-w-lg rounded-2xl px-4 py-3 " + (msg.role === "user" ? "rounded-tr-sm" : "rounded-tl-sm")}
                    style={{
                      backgroundColor: msg.role === "user" ? T.accentColor + "15" : agent.color + "12",
                      border: "1px solid " + (msg.role === "user" ? T.accentColor + "25" : agent.color + "20"),
                    }}>
                    <div className="text-[10px] font-bold mb-1"
                      style={{ color: msg.role === "user" ? T.accentColor : agent.color }}>
                      {msg.role === "user" ? "You" : agent.name}
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: T.textColor }}>{msg.text}</p>
                  </div>
                )}
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

          {/* Terminal Command Panel */}
          <div className="shrink-0 px-5 py-4 border-t" style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "80" }}>
            {/* Quick command buttons */}
            <div className="flex flex-wrap gap-2 mb-3">
              {commands.slice(0, 6).map((cmd) => (
                <button
                  key={cmd.name}
                  onClick={() => handleCommand("/" + cmd.name)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all hover:scale-105"
                  style={{
                    backgroundColor: agent.color + "15",
                    color: agent.color,
                    border: "1px solid " + agent.color + "30",
                  }}
                >
                  <Command size={10} />
                  {cmd.name}
                </button>
              ))}
              <button
                onClick={() => setShowHelp(!showHelp)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all hover:scale-105"
                style={{
                  backgroundColor: T.boxBg + "40",
                  color: T.textMuted,
                  border: "1px solid " + T.borderColor + "30",
                }}
              >
                <HelpCircle size={10} />
                {showHelp ? "Hide" : "Help"}
              </button>
            </div>

            {/* Command help panel */}
            {showHelp && (
              <div
                className="rounded-xl p-4 border mb-3"
                style={{
                  backgroundColor: T.boxBg + "60",
                  borderColor: T.borderColor + "30",
                }}
              >
                <div className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: agent.color }}>
                  Available Commands
                </div>
                <div className="space-y-2">
                  {commands.map((cmd) => (
                    <div key={cmd.name} className="flex items-start gap-3">
                      <code
                        className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                        style={{
                          backgroundColor: agent.color + "20",
                          color: agent.color,
                        }}
                      >
                        {cmd.name}
                      </code>
                      <div className="flex-1">
                        <div className="text-[10px] font-bold" style={{ color: T.textColor }}>
                          {cmd.description}
                        </div>
                        <div className="text-[9px]" style={{ color: T.textMuted }}>
                          {cmd.category}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Terminal input */}
            <form onSubmit={handleTerminalSubmit} className="relative">
              <div
                className="flex items-center gap-2 px-4 py-3 rounded-xl border"
                style={{
                  backgroundColor: T.bgColor + "40",
                  borderColor: agent.color + "30",
                }}
              >
                <Terminal size={14} style={{ color: agent.color }} />
                <span style={{ color: agent.color }}>$</span>
                <input
                  ref={terminalInputRef}
                  type="text"
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  onKeyDown={handleTerminalKeyDown}
                  placeholder={"Type a command or message for " + agent.name + "..."}
                  className="flex-1 bg-transparent outline-none text-sm font-mono"
                  style={{ color: T.textColor }}
                />
                {commandHistory.length > 0 && (
                  <div className="flex items-center gap-1 text-[9px]" style={{ color: T.textMuted }}>
                    <Clock size={10} />
                    {commandHistory.length}
                  </div>
                )}
              </div>
            </form>

            {/* Command history */}
            {commandHistory.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {commandHistory.slice(-5).map((cmd, i) => (
                  <button
                    key={i}
                    onClick={() => setTerminalInput(cmd)}
                    className="px-2 py-1 rounded text-[9px] font-mono transition-all hover:opacity-70"
                    style={{
                      backgroundColor: T.boxBg + "30",
                      color: T.textMuted,
                    }}
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
