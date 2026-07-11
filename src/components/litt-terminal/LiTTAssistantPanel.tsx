"use client";

import { useState, useRef, useEffect } from "react";
import {
  Send,
  Sparkles,
  Command,
  Wrench,
  Bot,
  Rocket,
  Terminal,
  FileCode,
  Logs,
  Cpu,
  Wifi,
  WifiOff,
  Copy,
  Check,
  Play,
  FilePlus,
  RotateCcw,
} from "lucide-react";
import type { JarvisContext, JarvisAction, JarvisThinkResponse } from "@/lib/litt-context";

const slashCommands = [
  { label: "/scan", desc: "Scan project and terminal state" },
  { label: "/fix", desc: "Suggest fixes for current errors" },
  { label: "/explain", desc: "Explain selected file or terminal output" },
  { label: "/build", desc: "Run build and diagnose issues" },
  { label: "/deploy", desc: "Deploy the app" },
  { label: "/agent code-architect", desc: "Start Code Architect agent" },
  { label: "/agent security-audit", desc: "Start Security Audit agent" },
  { label: "/terminal summarize", desc: "Summarize terminal output" },
  { label: "/files scan", desc: "Scan file tree" },
  { label: "/logs analyze", desc: "Analyze logs" },
];

const quickActions = [
  { label: "Explain error", icon: Sparkles, prompt: "explain the current terminal error" },
  { label: "Generate command", icon: Command, prompt: "generate a command to fix the current issue" },
  { label: "Create agent", icon: Bot, prompt: "create an agent workflow" },
  { label: "Deploy app", icon: Rocket, prompt: "deploy the app" },
];

type Message = {
  role: "user" | "jarvis";
  text: string;
  actions?: JarvisAction[];
  loading?: boolean;
};

interface LiTTAssistantPanelProps {
  context: JarvisContext;
  onInsertCommand?: (cmd: string) => void;
  onRunCommand?: (cmd: string) => void;
  onCreateFile?: (path: string, content: string) => void;
  onStartAgent?: (name: string) => void;
  onDeploy?: () => void;
}

export function LiTTAssistantPanel({
  context,
  onInsertCommand,
  onRunCommand,
  onCreateFile,
  onStartAgent,
  onDeploy,
}: LiTTAssistantPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "jarvis",
      text:
        "I am connected to your terminal, files, logs, and agents. Ask me to scan, fix, explain, or run commands. Use `/` for quick commands.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [showSlash, setShowSlash] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function askJarvis(rawInput: string) {
    const text = rawInput.trim();
    if (!text) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", text },
      { role: "jarvis", text: "", loading: true },
    ]);
    setPrompt("");
    setLoading(true);
    setShowSlash(false);

    try {
      const res = await fetch("/api/litt/think", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, context }),
      });
      const data: JarvisThinkResponse & { error?: string } = await res.json();

      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "jarvis" && last.loading) {
          last.text = data.error || data.answer || "No response.";
          last.actions = data.actions || [];
          last.loading = false;
        }
        return next;
      });
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "jarvis" && last.loading) {
          last.text = err instanceof Error ? err.message : "Failed to reach LiTT.";
          last.loading = false;
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  function handleAction(action: JarvisAction) {
    if (action.type === "insert_command" && action.command) {
      onInsertCommand?.(action.command);
    } else if (action.type === "run_command" && action.command) {
      const confirmed = window.confirm(`Run this command?\n\n${action.command}`);
      if (confirmed) onRunCommand?.(action.command);
    } else if (action.type === "create_file" && action.filePath && action.content) {
      onCreateFile?.(action.filePath, action.content);
    } else if (action.type === "start_agent" && action.agentName) {
      onStartAgent?.(action.agentName);
    } else if (action.type === "deploy") {
      onDeploy?.();
    } else if (action.type === "edit_file" && action.filePath && action.content) {
      onCreateFile?.(action.filePath, action.content);
    }
  }

  function copyText(text: string, idx: number) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(idx);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      askJarvis(prompt);
    } else if (e.key === "/" && prompt === "") {
      setShowSlash(true);
    } else if (e.key === "Escape") {
      setShowSlash(false);
    }
  }

  const filteredSlash = prompt.startsWith("/")
    ? slashCommands.filter((s) => s.label.startsWith(prompt))
    : [];

  const contextChips = [
    { label: "Terminal", active: context.terminalOutput.length > 0, icon: Terminal },
    { label: context.selectedFile?.path || "No file", active: !!context.selectedFile, icon: FileCode },
    { label: "Logs", active: context.logs.length > 0, icon: Logs },
    { label: "Agents", active: context.agents.length > 0, icon: Cpu },
    { label: context.websocketStatus === "connected" ? "Online" : "Offline", active: context.websocketStatus === "connected", icon: context.websocketStatus === "connected" ? Wifi : WifiOff },
  ];

  return (
    <div className="flex h-full flex-col rounded-xl border border-neutral-800 bg-neutral-950">
      <div className="border-b border-neutral-800 p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="rounded-lg bg-orange-600/20 p-1.5">
            <Wrench className="h-4 w-4 text-orange-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold">LiTT Command Center</h2>
            <p className="text-xs text-neutral-500">AI connected to terminal, files, logs, agents</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {contextChips.map((chip) => {
            const Icon = chip.icon;
            return (
              <div
                key={chip.label}
                className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${
                  chip.active
                    ? "border-orange-600/40 bg-orange-600/10 text-orange-400"
                    : "border-neutral-800 bg-neutral-900 text-neutral-500"
                }`}
              >
                <Icon className="h-3 w-3" />
                {chip.label}
              </div>
            );
          })}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`rounded-lg border p-3 text-sm ${
              msg.role === "user"
                ? "border-neutral-800 bg-neutral-900 text-neutral-200"
                : "border-orange-900/30 bg-black text-neutral-300"
            }`}
          >
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              {msg.role === "user" ? "You" : "LiTT"}
            </div>
            {msg.loading ? (
              <div className="flex items-center gap-2 text-neutral-400">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                LiTT is thinking...
              </div>
            ) : (
              <div className="prose prose-invert prose-sm max-w-none">
                <JarvisMarkdown text={msg.text} />
              </div>
            )}

            {msg.role === "jarvis" && !msg.loading && (
              <div className="mt-3 flex flex-wrap gap-2">
                {msg.actions?.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => handleAction(action)}
                    className="flex items-center gap-1.5 rounded-lg border border-orange-600/40 bg-orange-600/10 px-3 py-1.5 text-xs font-bold text-orange-400 hover:bg-orange-600 hover:text-white"
                  >
                    <ActionIcon type={action.type} />
                    {action.label}
                  </button>
                ))}
                <button
                  onClick={() => copyText(msg.text, idx)}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-800 px-3 py-1.5 text-xs font-bold text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
                >
                  {copied === idx ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied === idx ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-neutral-800 p-4">
        {showSlash && filteredSlash.length > 0 && (
          <div className="mb-2 max-h-32 overflow-y-auto rounded-lg border border-neutral-800 bg-black p-1">
            {filteredSlash.map((cmd) => (
              <button
                key={cmd.label}
                onClick={() => {
                  setPrompt(cmd.label);
                  setShowSlash(false);
                }}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-900"
              >
                <span className="font-bold text-orange-400">{cmd.label}</span>
                <span className="text-neutral-500">{cmd.desc}</span>
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setShowSlash(e.target.value.startsWith("/"));
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask LiTT or type / for commands..."
            className="h-24 w-full resize-none rounded-lg border border-neutral-800 bg-black p-3 pr-10 text-sm outline-none focus:border-orange-600"
          />
          <button
            onClick={() => askJarvis(prompt)}
            disabled={loading || !prompt.trim()}
            className="absolute bottom-2 right-2 rounded-lg bg-orange-600 p-2 text-white disabled:opacity-50 hover:bg-orange-500"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {quickActions.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={() => askJarvis(item.prompt)}
                className="flex items-center gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-left text-xs text-neutral-300 hover:border-orange-600 hover:text-orange-400"
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setMessages([messages[0]])}
          className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-500 hover:text-neutral-300"
        >
          <RotateCcw className="h-3 w-3" /> Clear chat
        </button>
      </div>
    </div>
  );
}

function ActionIcon({ type }: { type: JarvisAction["type"] }) {
  if (type === "run_command") return <Play className="h-3 w-3" />;
  if (type === "insert_command") return <Terminal className="h-3 w-3" />;
  if (type === "create_file" || type === "edit_file") return <FilePlus className="h-3 w-3" />;
  if (type === "start_agent") return <Bot className="h-3 w-3" />;
  if (type === "deploy") return <Rocket className="h-3 w-3" />;
  return <Sparkles className="h-3 w-3" />;
}

function JarvisMarkdown({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const code = part.replace(/```(?:\w+)?\n?/, "").replace(/```$/, "").trim();
          return (
            <pre
              key={i}
              className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-black p-3 text-xs text-green-400"
            >
              <code>{code}</code>
            </pre>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap text-neutral-300">
            {part}
          </p>
        );
      })}
    </>
  );
}
