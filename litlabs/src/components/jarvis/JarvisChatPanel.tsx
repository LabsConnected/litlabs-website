"use client";

import { useState, useRef, useEffect } from "react";
import {
  Send,
  Sparkles,
  Wrench,
  Copy,
  Check,
  Terminal,
  FileCode,
  Logs,
  Wifi,
  WifiOff,
} from "lucide-react";
import type {
  LiTContext,
  LiTAction,
  LiTThinkResponse,
} from "@/lib/jarvis-context";

type Message = {
  role: "user" | "lit";
  text: string;
  actions?: LiTAction[];
  loading?: boolean;
};

interface JarvisChatPanelProps {
  context?: Partial<LiTContext>;
  onInsertCommand?: (cmd: string) => void;
  onRunCommand?: (cmd: string) => void;
  compact?: boolean;
}

const defaultContext: LiTContext = {
  route: "/agents/lit",
  terminalOutput: "",
  commandHistory: [],
  logs: [],
  fileTree: [],
  agents: [{ name: "LiT", status: "online" }],
  websocketStatus: "offline",
};

export function JarvisChatPanel({
  context,
  onInsertCommand,
  onRunCommand,
  compact,
}: JarvisChatPanelProps) {
  const ctx = { ...defaultContext, ...context };
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "lit",
      text: "I'm LiTTree LiT. I can scan your project, explain errors, generate commands, and run agent workflows. Ask me anything.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function askJarvis(text: string) {
    if (!text.trim()) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", text },
      { role: "lit", text: "", loading: true },
    ]);
    setPrompt("");
    setLoading(true);

    try {
      const res = await fetch("/api/jarvis/think", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, context: ctx }),
      });
      const data: LiTThinkResponse & { error?: string } = await res.json();
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "lit" && last.loading) {
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
        if (last?.role === "lit" && last.loading) {
          last.text =
            err instanceof Error ? err.message : "Failed to reach LiT.";
          last.loading = false;
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  async function executeAction(action: LiTAction) {
    const label = (action.label || "").toLowerCase();
    if (label.includes("scan")) {
      const res = await fetch("/api/jarvis/scan");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return `Scan complete: ${data.totalFiles} files, ${data.totalLines} lines. ${data.health?.buildStatus}`;
    }
    if (label.includes("deploy")) {
      const res = await fetch("/api/deploy/trigger", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data.url ? `Deploy triggered: ${data.url}` : "Deploy queued.";
    }
    if (label.includes("workflow") || label.includes("agent")) {
      const res = await fetch("/api/agents/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: "lit",
          task: action.command || "execute requested action",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data.message || "Workflow initiated.";
    }
    return `Action "${action.label}" triggered.`;
  }

  function handleAction(action: LiTAction) {
    if (!action.command && !action.label) return;
    if (action.type === "insert_command" && action.command) {
      if (onInsertCommand) {
        onInsertCommand(action.command);
      } else {
        executeAction(action)
          .then((text) =>
            setMessages((prev) => [...prev, { role: "lit", text }]),
          )
          .catch((err) =>
            setMessages((prev) => [
              ...prev,
              { role: "lit", text: `Action failed: ${err.message}` },
            ]),
          );
      }
    } else if (action.type === "run_command" && action.command) {
      if (onRunCommand) {
        if (window.confirm(`Run: ${action.command}?`))
          onRunCommand(action.command);
      } else {
        if (window.confirm(`Run: ${action.command}?`)) {
          executeAction(action)
            .then((text) =>
              setMessages((prev) => [...prev, { role: "lit", text }]),
            )
            .catch((err) =>
              setMessages((prev) => [
                ...prev,
                { role: "lit", text: `Action failed: ${err.message}` },
              ]),
            );
        }
      }
    } else {
      executeAction(action)
        .then((text) => setMessages((prev) => [...prev, { role: "lit", text }]))
        .catch((err) =>
          setMessages((prev) => [
            ...prev,
            { role: "lit", text: `Action failed: ${err.message}` },
          ]),
        );
    }
  }

  const contextChips = [
    {
      label: "Terminal",
      active: ctx.terminalOutput.length > 0,
      icon: Terminal,
    },
    {
      label: ctx.selectedFile?.path || "No file",
      active: !!ctx.selectedFile,
      icon: FileCode,
    },
    { label: "Logs", active: ctx.logs.length > 0, icon: Logs },
    {
      label: ctx.websocketStatus === "connected" ? "Online" : "Offline",
      active: ctx.websocketStatus === "connected",
      icon: ctx.websocketStatus === "connected" ? Wifi : WifiOff,
    },
  ];

  return (
    <div className="flex h-full flex-col rounded-xl border border-neutral-800 bg-neutral-950">
      <div className="border-b border-neutral-800 p-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="rounded-lg bg-orange-600/20 p-1.5">
            <Wrench className="h-4 w-4 text-orange-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold">LiT Chat</h3>
            <p className="text-[10px] text-neutral-500">
              Connected to terminal context
            </p>
          </div>
        </div>
        {!compact && (
          <div className="flex flex-wrap gap-1">
            {contextChips.map((chip) => {
              const Icon = chip.icon;
              return (
                <div
                  key={chip.label}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold ${
                    chip.active
                      ? "border-orange-600/40 bg-orange-600/10 text-orange-400"
                      : "border-neutral-800 bg-neutral-900 text-neutral-500"
                  }`}
                >
                  <Icon className="h-2.5 w-2.5" />
                  {chip.label}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto p-3 space-y-3 ${compact ? "max-h-64" : ""}`}
      >
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`rounded-lg border p-2.5 text-xs ${
              msg.role === "user"
                ? "border-neutral-800 bg-neutral-900 text-neutral-200"
                : "border-orange-900/30 bg-black text-neutral-300"
            }`}
          >
            <div className="mb-0.5 text-[9px] font-bold uppercase tracking-wider text-neutral-500">
              {msg.role === "user" ? "You" : "LiT"}
            </div>
            {msg.loading ? (
              <div className="flex items-center gap-1.5 text-neutral-400">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                Thinking...
              </div>
            ) : (
              <div className="whitespace-pre-wrap">{msg.text}</div>
            )}
            {msg.role === "lit" &&
              !msg.loading &&
              msg.actions &&
              msg.actions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {msg.actions.map((action) => (
                    <button
                      key={action.label}
                      onClick={() => handleAction(action)}
                      className="flex items-center gap-1 rounded-lg border border-orange-600/40 bg-orange-600/10 px-2 py-1 text-[10px] font-bold text-orange-400 hover:bg-orange-600 hover:text-white"
                    >
                      {action.label}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(msg.text);
                      setCopied(idx);
                      setTimeout(() => setCopied(null), 1500);
                    }}
                    className="flex items-center gap-1 rounded-lg border border-neutral-800 px-2 py-1 text-[10px] font-bold text-neutral-400 hover:text-neutral-200"
                  >
                    {copied === idx ? (
                      <Check className="h-2.5 w-2.5" />
                    ) : (
                      <Copy className="h-2.5 w-2.5" />
                    )}
                    {copied === idx ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
          </div>
        ))}
      </div>

      <div className="border-t border-neutral-800 p-3">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                askJarvis(prompt);
              }
            }}
            placeholder="Ask LiT..."
            className={`w-full resize-none rounded-lg border border-neutral-800 bg-black p-2.5 pr-9 text-xs outline-none focus:border-orange-600 ${compact ? "h-16" : "h-20"}`}
          />
          <button
            onClick={() => askJarvis(prompt)}
            disabled={loading || !prompt.trim()}
            className="absolute bottom-1.5 right-1.5 rounded-lg bg-orange-600 p-1.5 text-white disabled:opacity-50 hover:bg-orange-500"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        {!compact && (
          <div className="mt-2 flex gap-1.5">
            {[
              "scan and see what needed",
              "explain current errors",
              "generate build command",
            ].map((q) => (
              <button
                key={q}
                onClick={() => askJarvis(q)}
                className="flex items-center gap-1 rounded-lg border border-neutral-800 px-2 py-1 text-[10px] text-neutral-400 hover:border-orange-600 hover:text-orange-400"
              >
                <Sparkles className="h-2.5 w-2.5" />
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
