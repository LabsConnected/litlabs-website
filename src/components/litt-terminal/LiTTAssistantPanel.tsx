"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Sparkles,
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
  Plus,
  Target,
  Compass,
  ListChecks,
  Plug,
  X,
} from "lucide-react";
import type {
  LiTTContext,
  LiTTAction,
  LiTTThinkResponse,
} from "@/lib/litt-context";
import {
  type Goal,
  loadGoals,
  saveGoals,
  addGoal,
  updateGoal,
  removeGoal,
  getProjectHealth,
} from "@/lib/integrations";

const slashCommands = [
  { label: "/tour", desc: "Show me around — project state + integrations" },
  { label: "/goals", desc: "View / manage your goal list" },
  { label: "/anticipate", desc: "What should I do next?" },
  { label: "/integrations", desc: "Full integration status table" },
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
  { label: "Show me around", icon: Compass, prompt: "show me around" },
  { label: "What's next?", icon: Target, prompt: "/anticipate" },
  { label: "My goals", icon: ListChecks, prompt: "/goals" },
  { label: "Integrations", icon: Plug, prompt: "/integrations" },
];

type Message = {
  role: "user" | "litt";
  text: string;
  actions?: LiTTAction[];
  loading?: boolean;
};

interface LiTTAssistantPanelProps {
  context: LiTTContext;
  onInsertCommand?: (cmd: string) => void;
  onRunCommand?: (cmd: string) => void;
  onCreateFile?: (path: string, content: string) => void;
  onStartAgent?: (name: string) => void;
  onDeploy?: () => void;
}

function timeOfDay(): "morning" | "afternoon" | "evening" | "night" {
  const h = new Date().getHours();
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  if (h < 22) return "evening";
  return "night";
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
  const [goals, setGoals] = useState<Goal[]>([]);
  const [showGoals, setShowGoals] = useState(false);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSlash, setShowSlash] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tod = timeOfDay();

  // Init messages and load goals on mount
  useEffect(() => {
    const loadedGoals = loadGoals();
    setGoals(loadedGoals);
    const openGoals = loadedGoals.filter(
      (g) => g.status !== "done" && g.status !== "dropped",
    );
    const top = openGoals[0];
    const topStr = top ? ` Top priority: **${top.title}**.` : "";
    const tod = timeOfDay();
    const hi =
      tod === "morning"
        ? "Good morning — litlabs.net is online."
        : tod === "afternoon"
          ? "Afternoon — litlabs.net is online."
          : tod === "evening"
            ? "Evening — litlabs.net is online."
            : "Late night — litlabs.net is online.";
    setMessages([
      {
        role: "litt",
        text: `${hi} I'm connected to your terminal, files, logs, agents, integrations, and goals. I already know the stack and the conventions — just tell me what to do.${topStr}`,
      },
    ]);
  }, []);

  // Persist goals when they change
  useEffect(() => {
    if (goals.length > 0 || typeof window === "undefined") saveGoals(goals);
  }, [goals]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, showGoals, showIntegrations]);

  const openGoals = goals.filter(
    (g) => g.status !== "done" && g.status !== "dropped",
  );

  const askLiTT = useCallback(
    async (rawInput: string) => {
      const text = rawInput.trim();
      if (!text) return;

      setMessages((prev) => [
        ...prev,
        { role: "user", text },
        { role: "litt", text: "", loading: true },
      ]);
      setPrompt("");
      setLoading(true);
      setShowSlash(false);

      // Local slash command handlers
      if (text === "/goals") {
        setShowGoals(true);
        setShowIntegrations(false);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "litt" && last.loading) {
            last.text =
              openGoals.length === 0
                ? "No open goals yet. Add one in the panel to the right, or type `add goal: <title>` here."
                : `You have **${openGoals.length} open goal${openGoals.length === 1 ? "" : "s"}**. Top one by priority: **${openGoals[0].title}**. The full list is in the side panel.`;
            last.loading = false;
          }
          return next;
        });
        setLoading(false);
        return;
      }
      if (text === "/integrations") {
        setShowIntegrations(true);
        setShowGoals(false);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "litt" && last.loading) {
            const health = getProjectHealth();
            last.text = `**${health.connected}/${health.total}** integrations connected. ${health.requiredMissing.length > 0 ? `Required missing: ${health.requiredMissing.join(", ")}.` : "All required integrations are live."} See the side panel for the full table.`;
            last.loading = false;
          }
          return next;
        });
        setLoading(false);
        return;
      }
      if (text === "/anticipate") {
        const next = suggestNext(goals, context);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "litt" && last.loading) {
            last.text = next;
            last.loading = false;
          }
          return [...prev];
        });
        setLoading(false);
        return;
      }

      // Detect "add goal: <title>" / "make a list of X" / "todo: X"
      const goalMatch = text.match(
        /^(?:add\s+goal|goal|todo|todo:|\+goal|\/goal)\s*:?\s+(.+)$/i,
      );
      if (goalMatch) {
        const title = goalMatch[1].trim();
        const g = addGoal({ title, priority: "medium" });
        setGoals((prev) => [g, ...prev]);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "litt" && last.loading) {
            last.text = `Added **${g.title}** to your list. Priority: medium. I'll keep it on your radar.`;
            last.loading = false;
          }
          return next;
        });
        setLoading(false);
        return;
      }

      try {
        const res = await fetch("/api/litt/think", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            context,
            goals: openGoals.slice(0, 12),
            timeOfDay: tod,
          }),
        });
        const data: LiTTThinkResponse & { error?: string } = await res.json();

        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "litt" && last.loading) {
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
          if (last?.role === "litt" && last.loading) {
            last.text =
              err instanceof Error ? err.message : "Failed to reach LiTT.";
            last.loading = false;
          }
          return next;
        });
      } finally {
        setLoading(false);
      }
    },
    [context, goals, openGoals, tod],
  );

  function handleAction(action: LiTTAction) {
    if (action.type === "insert_command" && action.command) {
      onInsertCommand?.(action.command);
    } else if (action.type === "run_command" && action.command) {
      const confirmed = window.confirm(
        `Run this command?\n\n${action.command}`,
      );
      if (confirmed) onRunCommand?.(action.command);
    } else if (
      action.type === "create_file" &&
      action.filePath &&
      action.content
    ) {
      onCreateFile?.(action.filePath, action.content);
    } else if (action.type === "start_agent" && action.agentName) {
      onStartAgent?.(action.agentName);
    } else if (action.type === "deploy") {
      onDeploy?.();
    } else if (
      action.type === "edit_file" &&
      action.filePath &&
      action.content
    ) {
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
      askLiTT(prompt);
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
    {
      label: "Terminal",
      active: context.terminalOutput.length > 0,
      icon: Terminal,
    },
    {
      label: context.selectedFile?.path || "No file",
      active: !!context.selectedFile,
      icon: FileCode,
    },
    { label: "Logs", active: context.logs.length > 0, icon: Logs },
    { label: "Agents", active: context.agents.length > 0, icon: Cpu },
    {
      label: `${openGoals.length} goal${openGoals.length === 1 ? "" : "s"}`,
      active: openGoals.length > 0,
      icon: ListChecks,
    },
    {
      label: context.websocketStatus === "connected" ? "Online" : "Offline",
      active: context.websocketStatus === "connected",
      icon: context.websocketStatus === "connected" ? Wifi : WifiOff,
    },
  ];

  // INTEGRATION STATUS — read from getProjectHealth() at render time
  const health = getProjectHealth();

  return (
    <div className="flex h-full flex-col rounded-xl border border-neutral-800 bg-neutral-950">
      <div className="border-b border-neutral-800 p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="rounded-lg bg-orange-600/20 p-1.5">
            <Wrench className="h-4 w-4 text-orange-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold">LiTT Command Center</h2>
            <p className="text-xs text-neutral-500">
              litlabs.net · {health.connected}/{health.total} integrations ·{" "}
              {openGoals.length} open goal{openGoals.length === 1 ? "" : "s"}
            </p>
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
                <LiTTMarkdown text={msg.text} />
              </div>
            )}

            {msg.role === "litt" && !msg.loading && (
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
                  {copied === idx ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copied === idx ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </div>
        ))}

        {showGoals && (
          <GoalsPanel
            goals={goals}
            onUpdate={(id, patch) => {
              const updated = updateGoal(id, patch);
              if (updated)
                setGoals((prev) =>
                  prev.map((g) => (g.id === id ? updated : g)),
                );
            }}
            onRemove={(id) => {
              if (removeGoal(id))
                setGoals((prev) => prev.filter((g) => g.id !== id));
            }}
            onAdd={(title) => {
              const g = addGoal({ title });
              setGoals((prev) => [g, ...prev]);
            }}
            onClose={() => setShowGoals(false)}
          />
        )}

        {showIntegrations && (
          <IntegrationsPanel onClose={() => setShowIntegrations(false)} />
        )}
      </div>

      <div className="border-t border-neutral-800 p-4">
        {showSlash && filteredSlash.length > 0 && (
          <div className="mb-2 max-h-40 overflow-y-auto rounded-lg border border-neutral-800 bg-black p-1">
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
            id="litt-assistant-prompt"
            name="littPrompt"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setShowSlash(e.target.value.startsWith("/"));
            }}
            onKeyDown={handleKeyDown}
            placeholder='Ask LiTT… or type "/" for commands. Try "show me around", "add goal: …"'
            className="h-24 w-full resize-none rounded-lg border border-neutral-800 bg-black p-3 pr-10 text-sm outline-none focus:border-orange-600"
          />
          <button
            onClick={() => askLiTT(prompt)}
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
                onClick={() => askLiTT(item.prompt)}
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

/* ------------------------------------------------------------------ */
/*  Goals side panel                                                  */
/* ------------------------------------------------------------------ */
function GoalsPanel({
  goals,
  onUpdate,
  onRemove,
  onAdd,
  onClose,
}: {
  goals: Goal[];
  onUpdate: (id: string, patch: Partial<Goal>) => void;
  onRemove: (id: string) => void;
  onAdd: (title: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="rounded-lg border border-orange-900/30 bg-black p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-orange-400">
          <ListChecks className="h-4 w-4" /> Goals
        </div>
        <button
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) {
            onAdd(draft);
            setDraft("");
          }
        }}
        className="mb-3 flex gap-2"
      >
        <input
          id="litt-assistant-goal"
          name="littGoal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a goal…"
          className="flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs outline-none focus:border-orange-600"
        />
        <button
          type="submit"
          className="rounded-md bg-orange-600 px-2 py-1.5 text-xs font-bold text-white hover:bg-orange-500"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </form>
      {goals.length === 0 ? (
        <div className="text-xs text-neutral-500">
          No goals yet. Add one above.
        </div>
      ) : (
        <ul className="space-y-2">
          {goals
            .slice()
            .sort((a, b) => {
              const order: Record<Goal["priority"], number> = {
                high: 0,
                medium: 1,
                low: 2,
              };
              return order[a.priority] - order[b.priority];
            })
            .map((g) => (
              <li
                key={g.id}
                className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs"
              >
                <select
                  id="litt-assistant-priority"
                  name="littPriority"
                  value={g.priority}
                  onChange={(e) =>
                    onUpdate(g.id, {
                      priority: e.target.value as Goal["priority"],
                    })
                  }
                  className="rounded border border-neutral-800 bg-black px-1 py-0.5 text-[10px] font-bold uppercase"
                >
                  <option value="high">HIGH</option>
                  <option value="medium">MED</option>
                  <option value="low">LOW</option>
                </select>
                <button
                  onClick={() =>
                    onUpdate(g.id, {
                      status: g.status === "done" ? "open" : "done",
                    })
                  }
                  className={`flex h-4 w-4 items-center justify-center rounded border ${g.status === "done" ? "border-emerald-500 bg-emerald-500/20" : "border-neutral-700"}`}
                  title="Toggle done"
                >
                  {g.status === "done" ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : null}
                </button>
                <span
                  className={`flex-1 ${g.status === "done" ? "text-neutral-500 line-through" : "text-neutral-200"}`}
                >
                  {g.title}
                </span>
                <button
                  onClick={() => onRemove(g.id)}
                  className="text-neutral-500 hover:text-red-400"
                  title="Delete"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function IntegrationsPanel({ onClose }: { onClose: () => void }) {
  const items = getProjectHealth().integrations;
  return (
    <div className="rounded-lg border border-orange-900/30 bg-black p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-orange-400">
          <Plug className="h-4 w-4" /> Integrations
        </div>
        <button
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="space-y-1">
        {items.map((i) => (
          <li
            key={i.id}
            className="flex items-start gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs"
          >
            <span className="mt-0.5">
              {i.status === "connected"
                ? `\u2705`
                : i.status === "missing"
                  ? `\u26A0\uFE0F`
                  : `\u2753`}
            </span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-neutral-200">{i.name}</span>
                {i.required && (
                  <span className="rounded border border-orange-700 px-1 text-[9px] font-bold uppercase text-orange-400">
                    required
                  </span>
                )}
              </div>
              <div className="text-[11px] text-neutral-500">{i.tagline}</div>
              {i.detail && (
                <div className="text-[10px] text-neutral-600">{i.detail}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function suggestNext(goals: Goal[], ctx: LiTTContext): string {
  const open = goals.filter(
    (g) => g.status !== "done" && g.status !== "dropped",
  );
  const high = open.find((g) => g.priority === "high");
  const health = getProjectHealth();
  const requiredMissing = health.requiredMissing;

  const lines: string[] = [];
  lines.push(`### Here is what I would do next`);
  lines.push("");

  if (high) {
    lines.push(
      `1. **${high.title}** \u2014 your only high-priority goal. Start here.`,
    );
  } else if (open.length > 0) {
    lines.push(
      `1. **${open[0].title}** \u2014 top of your list. Knock it out.`,
    );
  } else {
    lines.push(
      `1. Your goal list is empty. Type \`add goal: <title>\` to seed it.`,
    );
  }

  if (requiredMissing.length > 0) {
    lines.push(
      `2. **Wire up ${requiredMissing[0]}** \u2014 it is a required integration but currently missing. Without it, half the app is off-limits.`,
    );
  } else {
    lines.push(
      `2. All required integrations are live. Run \`pnpm dev\` and start shipping.`,
    );
  }

  if (ctx.route && ctx.route !== "/litt") {
    lines.push(
      `3. You are on \`${ctx.route}\` \u2014 finish what you started there before bouncing.`,
    );
  } else {
    lines.push(
      `3. You are on the LiTT terminal \u2014 good place to think out loud. Run \`/tour\` if you want the lay of the land again.`,
    );
  }

  lines.push("");
  lines.push(
    `If you want me to actually do one of these, just say so \u2014 I will prep the command, edit the file, or start the agent.`,
  );
  return lines.join("\n");
}

function ActionIcon({ type }: { type: LiTTAction["type"] }) {
  if (type === "run_command") return <Play className="h-3 w-3" />;
  if (type === "insert_command") return <Terminal className="h-3 w-3" />;
  if (type === "create_file" || type === "edit_file")
    return <FilePlus className="h-3 w-3" />;
  if (type === "start_agent") return <Bot className="h-3 w-3" />;
  if (type === "deploy") return <Rocket className="h-3 w-3" />;
  return <Sparkles className="h-3 w-3" />;
}

function LiTTMarkdown({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const code = part
            .replace(/```(?:\w+)?\n?/, "")
            .replace(/```$/, "")
            .trim();
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
