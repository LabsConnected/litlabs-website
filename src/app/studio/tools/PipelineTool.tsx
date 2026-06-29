"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  Terminal,
  Activity,
  Zap,
  Play,
  Cpu,
  Search,
  X,
  Copy,
  Check,
  Loader2,
  Settings,
  Webhook,
  Database,
  MessageSquare,
  Mail,
  Sparkles,
  Trash2,
  SlidersHorizontal,
  Network,
  RefreshCw,
  FileJson,
  Wand2,
} from "lucide-react";

/* ─── Types ───────────────────────────────────────────────────────── */
type NodeType = "trigger" | "agent" | "action";
type NodeStatus = "idle" | "running" | "completed" | "error";

interface LibraryItem {
  type: NodeType;
  title: string;
  icon: React.ReactNode;
  desc: string;
  keywords: string[];
}

interface PipelineNode {
  id: string;
  type: NodeType;
  title: string;
  config: Record<string, string | number | boolean>;
  status?: NodeStatus;
}

const NODE_META: Record<
  NodeType,
  { label: string; color: string; bg: string; border: string; ring: string }
> = {
  trigger: {
    label: "Trigger",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    ring: "ring-amber-500/40",
  },
  agent: {
    label: "AI Agent",
    color: "text-fuchsia-400",
    bg: "bg-fuchsia-600/10",
    border: "border-fuchsia-500/30",
    ring: "ring-fuchsia-500/40",
  },
  action: {
    label: "Action",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    ring: "ring-emerald-500/40",
  },
};

const LIBRARY: LibraryItem[] = [
  {
    type: "trigger",
    title: "Webhook Listener",
    icon: <Webhook className="w-4 h-4" />,
    desc: "HTTP endpoint trigger",
    keywords: ["webhook", "http", "api", "endpoint", "post", "request"],
  },
  {
    type: "trigger",
    title: "Scheduled Interval",
    icon: <Activity className="w-4 h-4" />,
    desc: "Cron-based scheduler",
    keywords: [
      "cron",
      "schedule",
      "hourly",
      "daily",
      "weekly",
      "timer",
      "interval",
      "periodic",
    ],
  },
  {
    type: "agent",
    title: "Logic Orchestrator",
    icon: <Network className="w-4 h-4" />,
    desc: "AI routing & analysis",
    keywords: [
      "route",
      "logic",
      "analyze",
      "decide",
      "orchestrate",
      "classify",
    ],
  },
  {
    type: "agent",
    title: "Task Champion",
    icon: <Cpu className="w-4 h-4" />,
    desc: "LLM reasoning engine",
    keywords: [
      "summarize",
      "extract",
      "transform",
      "generate",
      "reason",
      "llm",
      "gpt",
    ],
  },
  {
    type: "action",
    title: "Database Insert",
    icon: <Database className="w-4 h-4" />,
    desc: "Save to LitLabs Ledger",
    keywords: ["database", "db", "sql", "save", "store", "persist", "ledger"],
  },
  {
    type: "action",
    title: "Discord Webhook",
    icon: <MessageSquare className="w-4 h-4" />,
    desc: "Post to Discord channel",
    keywords: ["discord", "notify", "alert", "channel", "slack", "message"],
  },
  {
    type: "action",
    title: "Email Dispatch",
    icon: <Mail className="w-4 h-4" />,
    desc: "Send email notification",
    keywords: ["email", "mail", "smtp", "send", "notify"],
  },
];

function defaultConfig(
  title: string,
): Record<string, string | number | boolean> {
  switch (title) {
    case "Webhook Listener":
      return {
        endpoint: "/api/v1/ingest",
        method: "POST",
        headers: "Content-Type: application/json",
      };
    case "Scheduled Interval":
      return { preset: "hourly", cron: "0 * * * *" };
    case "Logic Orchestrator":
      return {
        model: "lit-core-v4",
        temperature: 0.3,
        prompt: "Analyze input and route to the correct downstream action.",
      };
    case "Task Champion":
      return {
        model: "lit-reason-max",
        temperature: 0.7,
        prompt: "Process the input data and produce a structured output.",
      };
    case "Database Insert":
      return { table: "pipeline_output", cluster: "primary" };
    case "Discord Webhook":
      return {
        webhook_url: "",
        message_template: "Pipeline completed: {{status}}",
      };
    case "Email Dispatch":
      return {
        to: "",
        subject: "Pipeline Alert",
        body: "Pipeline finished execution.",
      };
    default:
      return {};
  }
}

function toYAML(nodes: PipelineNode[]): string {
  const lines: string[] = [
    "# LiTTree Labs Pipeline Protocol",
    `# Generated: ${new Date().toISOString()}`,
    `# ${process.env.NEXT_PUBLIC_SITE_URL || "https://litlabs.net"}`,
    "",
    'version: "1.0"',
    `name: "untitled_pipeline"`,
    `nodes: ${nodes.length}`,
    "",
    "workflow:",
  ];
  nodes.forEach((n, i) => {
    lines.push(
      `  - id: ${n.id}`,
      `    type: ${n.type}`,
      `    title: "${n.title}"`,
      `    status: ${n.status || "idle"}`,
    );
    if (Object.keys(n.config).length) {
      lines.push("    config:");
      Object.entries(n.config).forEach(([k, v]) => {
        const val =
          typeof v === "string" ? `"${v.replace(/"/g, '\\"')}"` : String(v);
        lines.push(`      ${k}: ${val}`);
      });
    }
    if (i < nodes.length - 1) lines.push("    ->");
    lines.push("");
  });
  return lines.join("\n");
}
export default function PipelineTool() {
  const nodeIdCounter = useRef(0);

  const [nodes, setNodes] = useState<PipelineNode[]>([
    {
      id: "1",
      type: "trigger",
      title: "Webhook Listener",
      config: defaultConfig("Webhook Listener"),
      status: "idle",
    },
    {
      id: "2",
      type: "agent",
      title: "Logic Orchestrator",
      config: defaultConfig("Logic Orchestrator"),
      status: "idle",
    },
  ]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("2");
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    "[SYS] Workspace initialized.",
    "[SYS] Ready for node configuration.",
  ]);
  const [libraryFilter, setLibraryFilter] = useState("");
  const [showYaml, setShowYaml] = useState(false);
  const [yamlCopied, setYamlCopied] = useState(false);
  const [optimizingPrompt, setOptimizingPrompt] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [terminalLogs]);

  const log = useCallback((msg: string) => {
    const ts = new Date().toISOString().split("T")[1].slice(0, 8);
    setTerminalLogs((prev) => [...prev, `[${ts}] ${msg}`]);
  }, []);

  const clearTerminal = () => setTerminalLogs(["[SYS] Terminal cleared."]);

  const addNode = (item: LibraryItem) => {
    nodeIdCounter.current += 1;
    const newNode: PipelineNode = {
      id: `node-${nodeIdCounter.current}`,
      type: item.type,
      title: item.title,
      config: defaultConfig(item.title),
      status: "idle",
    };
    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(newNode.id);
    log(`[ADD] Inserted node: ${item.title}`);
  };

  const deleteNode = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setNodes((prev) => prev.filter((n) => n.id !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
    log(`[DEL] Removed node ID: ${id}`);
  };

  const updateConfig = (
    id: string,
    field: string,
    value: string | number | boolean,
  ) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, config: { ...n.config, [field]: value } } : n,
      ),
    );
  };

  const runPipeline = () => {
    if (nodes.length === 0) {
      log("[WRN] Pipeline is empty.");
      return;
    }
    setIsRunning(true);
    log("[EXEC] Initiating pipeline run sequence...");
    setNodes((prev) => prev.map((n) => ({ ...n, status: "idle" })));
    nodes.forEach((node, idx) => {
      setTimeout(() => {
        setNodes((prev) =>
          prev.map((n) => (n.id === node.id ? { ...n, status: "running" } : n)),
        );
        log(`[RUN] Node ${idx + 1}: ${node.title}`);
        if (node.type === "agent")
          log(
            `      -> Tokens: ${Math.floor(Math.random() * 800 + 200)} | Model: ${node.config.model}`,
          );
        setTimeout(() => {
          setNodes((prev) =>
            prev.map((n) =>
              n.id === node.id ? { ...n, status: "completed" } : n,
            ),
          );
          log(`[OK]  Node ${idx + 1} completed`);
          if (idx === nodes.length - 1) {
            setTimeout(() => {
              log("[SYS] Pipeline execution completed successfully.");
              setIsRunning(false);
            }, 400);
          }
        }, 600);
      }, idx * 900);
    });
  };
  const handleAiBuild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    const prompt = aiPrompt;
    setAiPrompt("");
    setIsGenerating(true);
    log("[AI] Interpreting architecture prompt...");

    // Local NLP keyword matching first
    const lowered = prompt.toLowerCase();
    const detected: LibraryItem[] = [];
    if (lowered.match(/webhook|http|endpoint|api|post|request/))
      detected.push(LIBRARY[0]);
    if (
      lowered.match(/cron|schedule|hourly|daily|weekly|timer|interval|periodic/)
    )
      detected.push(LIBRARY[1]);
    if (lowered.match(/route|logic|analyze|decide|orchestrate|classify/))
      detected.push(LIBRARY[2]);
    if (lowered.match(/summarize|extract|transform|generate|reason|llm|gpt|ai/))
      detected.push(LIBRARY[3]);
    if (lowered.match(/database|db|sql|save|store|persist|ledger/))
      detected.push(LIBRARY[4]);
    if (lowered.match(/discord|notify|alert|channel|slack|message/))
      detected.push(LIBRARY[5]);
    if (lowered.match(/email|mail|smtp/)) detected.push(LIBRARY[6]);
    if (detected.length === 0)
      detected.push(LIBRARY[1], LIBRARY[3], LIBRARY[4]);

    const built: PipelineNode[] = detected.map((item, i) => ({
      id: (Date.now() + i).toString(),
      type: item.type,
      title: item.title,
      config: defaultConfig(item.title),
      status: "idle",
    }));

    // Try Gemini for smarter assembly
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Build a pipeline for: "${prompt}". Reply ONLY with a JSON array of node objects [{"type":"trigger|agent|action","title":"...","config":{...}}].`,
          systemPrompt:
            "You are a pipeline architect. Output ONLY valid JSON arrays. No explanations.",
        }),
      });
      const data = await res.json();
      const raw = data.response?.match(/\[[\s\S]*\]/)?.[0];
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const geminiNodes: PipelineNode[] = parsed.map(
            (n: Record<string, unknown>, i: number) => ({
              id: (Date.now() + i).toString(),
              type: (["trigger", "agent", "action"].includes(n.type as string)
                ? n.type
                : "agent") as NodeType,
              title: (n.title as string) || "AI Node",
              config: {
                ...defaultConfig((n.title as string) || ""),
                ...((n.config as Record<string, string | number | boolean>) ||
                  {}),
              } as Record<string, string | number | boolean>,
              status: "idle",
            }),
          );
          setNodes(geminiNodes);
          setSelectedNodeId(geminiNodes[0]?.id || null);
          log(`[OK] AI deployed ${geminiNodes.length}-node pipeline.`);
          setIsGenerating(false);
          return;
        }
      }
    } catch {
      /* fall through to local */
    }

    setNodes(built);
    setSelectedNodeId(built[0]?.id || null);
    log(`[OK] Deployed ${built.length}-node pipeline from keywords.`);
    setIsGenerating(false);
  };

  const optimizePrompt = async (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== "agent") return;
    const rawPrompt = String(node.config.prompt || "");
    if (!rawPrompt.trim()) return;
    setOptimizingPrompt(true);
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Rewrite this as a polished system prompt with clear instructions, role definition, and output format. Keep it concise (2-3 sentences max). Original: "${rawPrompt}"`,
          systemPrompt:
            "You are a prompt engineering specialist. Output only the rewritten prompt. No preamble.",
        }),
      });
      const data = await res.json();
      if (data.response) updateConfig(nodeId, "prompt", data.response.trim());
      log("[OPT] Prompt optimized via Gemini");
    } catch {
      log("[WRN] Prompt optimization failed");
    }
    setOptimizingPrompt(false);
  };

  const yaml = toYAML(nodes);
  const copyYaml = async () => {
    await navigator.clipboard.writeText(yaml);
    setYamlCopied(true);
    setTimeout(() => setYamlCopied(false), 2000);
  };

  const filteredLib = libraryFilter.trim()
    ? LIBRARY.filter(
        (i) =>
          i.title.toLowerCase().includes(libraryFilter.toLowerCase()) ||
          i.desc.toLowerCase().includes(libraryFilter.toLowerCase()) ||
          i.keywords.some((k) => k.includes(libraryFilter.toLowerCase())),
      )
    : LIBRARY;

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  return (
    <div className="flex h-full bg-[#050108] text-slate-300 font-sans overflow-hidden relative">
      {/* Grid */}
      <div
        className="absolute inset-0 z-0 pointer-events-none opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(217,70,239,0.15) 1px,transparent 1px),linear-gradient(90deg,rgba(217,70,239,0.15) 1px,transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* ── LEFT: Library ── */}
      <aside className="w-56 shrink-0 border-r border-fuchsia-900/30 bg-[#0a0310]/80 backdrop-blur-xl flex flex-col z-10">
        <div className="p-3 border-b border-white/5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Box className="w-3.5 h-3.5" /> Tool Library
          </span>
        </div>
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 bg-[#130720] border border-white/10 rounded-lg px-2 py-1.5">
            <Search className="w-3 h-3 text-slate-500 shrink-0" />
            <input
              value={libraryFilter}
              onChange={(e) => setLibraryFilter(e.target.value)}
              placeholder="Filter nodes..."
              className="bg-transparent text-[10px] text-white outline-none w-full placeholder:text-slate-600"
            />
            {libraryFilter && (
              <button
                onClick={() => setLibraryFilter("")}
                className="text-slate-500 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        <div
          className="flex-1 overflow-y-auto p-3 space-y-3"
          style={{ scrollbarWidth: "none" }}
        >
          {(["trigger", "agent", "action"] as NodeType[]).map((cat) => {
            const catItems = filteredLib.filter((i) => i.type === cat);
            if (catItems.length === 0) return null;
            return (
              <div key={cat} className="space-y-1.5">
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest pl-1">
                  {cat === "trigger"
                    ? "1. Triggers"
                    : cat === "agent"
                      ? "2. AI Agents"
                      : "3. Actions"}
                </div>
                {catItems.map((item, idx) => {
                  const s = NODE_META[item.type];
                  return (
                    <div
                      key={idx}
                      onClick={() => addNode(item)}
                      className="bg-[#130720]/80 border border-white/5 hover:border-fuchsia-500/40 rounded-xl p-2.5 cursor-pointer transition-all hover:scale-[1.02]"
                    >
                      <div className="flex items-center mb-1">
                        <div
                          className={`w-5 h-5 rounded flex items-center justify-center mr-2 border ${s.bg} ${s.border} ${s.color}`}
                        >
                          {item.icon}
                        </div>
                        <span className="text-[11px] font-bold text-white">
                          {item.title}
                        </span>
                      </div>
                      <p className="text-[9px] text-slate-500 ml-7 leading-tight">
                        {item.desc}
                      </p>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </aside>
      {/* ── CENTER: Canvas ── */}
      <main
        className="flex-1 relative flex flex-col items-center overflow-y-auto py-6 z-10"
        style={{ scrollbarWidth: "none" }}
      >
        {/* Header */}
        <div className="w-full max-w-lg mb-5 flex items-center justify-between px-1">
          <span className="text-xs font-mono text-slate-500">
            untitled_pipeline.yaml
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={runPipeline}
              disabled={isRunning || nodes.length === 0}
              className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/50 disabled:opacity-50 text-[10px] font-bold rounded flex items-center gap-1.5 transition-all"
            >
              {isRunning ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              {isRunning ? "Running..." : "Test Run"}
            </button>
            <button
              onClick={() => setShowYaml(true)}
              className="px-3 py-1.5 bg-fuchsia-600/20 text-fuchsia-400 hover:bg-fuchsia-600/30 border border-fuchsia-500/50 text-[10px] font-bold rounded flex items-center gap-1.5 transition-all"
            >
              <FileJson className="w-3 h-3" /> Export YAML
            </button>
          </div>
        </div>

        {/* Pipeline */}
        <div className="w-full max-w-lg flex flex-col items-center pb-32">
          {nodes.length === 0 ? (
            <div className="mt-16 text-center flex flex-col items-center">
              <Network className="w-14 h-14 text-slate-700 mb-4" />
              <h2 className="text-lg font-bold text-slate-400 mb-2">
                Pipeline Empty
              </h2>
              <p className="text-sm text-slate-500 max-w-sm">
                Click tools from the library or ask the AI to generate a
                pipeline.
              </p>
            </div>
          ) : (
            nodes.map((node, idx) => {
              const s = NODE_META[node.type];
              const isSelected = selectedNodeId === node.id;
              const status = node.status || "idle";
              const statusDot =
                status === "running"
                  ? "bg-fuchsia-400 animate-pulse"
                  : status === "completed"
                    ? "bg-emerald-400"
                    : status === "error"
                      ? "bg-red-400"
                      : "bg-slate-600";
              return (
                <React.Fragment key={node.id}>
                  <div
                    onClick={() => setSelectedNodeId(node.id)}
                    className={`w-full bg-[#130720]/90 backdrop-blur-md rounded-2xl p-4 border-2 transition-all cursor-pointer relative group
                    ${isSelected ? "border-fuchsia-500 shadow-[0_0_30px_rgba(217,70,239,0.2)]" : "border-white/5 hover:border-white/20 shadow-lg"}
                    ${status === "running" ? "ring-1 " + s.ring : ""}`}
                  >
                    {/* Status badge */}
                    <div
                      className={`absolute -top-2 -right-2 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full border
                    ${
                      status === "running"
                        ? "bg-fuchsia-900/80 text-fuchsia-300 border-fuchsia-500/40 animate-pulse"
                        : status === "completed"
                          ? "bg-emerald-900/80 text-emerald-300 border-emerald-500/40"
                          : status === "error"
                            ? "bg-red-900/80 text-red-300 border-red-500/40"
                            : "bg-slate-800 text-slate-400 border-slate-600/30"
                    }`}
                    >
                      {status}
                    </div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center border ${s.bg} ${s.border} ${s.color}`}
                        >
                          {node.type === "trigger" ? (
                            <Zap className="w-4 h-4" />
                          ) : node.type === "agent" ? (
                            <Cpu className="w-4 h-4" />
                          ) : (
                            <Box className="w-4 h-4" />
                          )}
                        </div>
                        <div>
                          <div
                            className={`text-[9px] font-bold uppercase tracking-widest ${s.color} mb-0.5`}
                          >
                            {s.label}
                          </div>
                          <div className="text-sm font-bold text-white">
                            {node.title}
                          </div>
                        </div>
                        <span
                          className={`w-2 h-2 rounded-full ${statusDot} ml-1`}
                          style={{
                            boxShadow:
                              status === "running"
                                ? "0 0 6px currentColor"
                                : "none",
                          }}
                        />
                      </div>
                      <button
                        onClick={(e) => deleteNode(node.id, e)}
                        className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {node.type === "agent" && (
                      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span className="truncate flex-1 max-w-[200px]">
                          <span className="text-fuchsia-500/50 mr-2">
                            prompt:
                          </span>
                          {String(node.config.prompt) || "No prompt set..."}
                        </span>
                        <span className="bg-black/30 px-2 py-0.5 rounded border border-white/5 ml-3 shrink-0 text-[9px]">
                          {String(node.config.model)}
                        </span>
                      </div>
                    )}
                  </div>
                  {idx < nodes.length - 1 && (
                    <div
                      className={`h-8 w-px my-1.5 relative transition-all ${isRunning && (nodes[idx].status === "completed" || nodes[idx].status === "running") ? "bg-linear-to-b from-fuchsia-400 via-emerald-400 to-emerald-400 shadow-[0_0_8px_rgba(217,70,239,0.5)]" : "bg-linear-to-b from-fuchsia-500/50 to-emerald-500/50"}`}
                    >
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-fuchsia-500 bg-[#0a0310]" />
                    </div>
                  )}
                </React.Fragment>
              );
            })
          )}
        </div>

        {/* AI Builder Bar */}
        <div className="sticky bottom-4 w-full max-w-xl px-4 z-30">
          <div className="bg-[#0a0310]/95 backdrop-blur-2xl border border-fuchsia-500/40 rounded-2xl p-2 shadow-[0_10px_50px_rgba(217,70,239,0.2)] focus-within:border-fuchsia-400 transition-all">
            <form onSubmit={handleAiBuild} className="flex items-center w-full">
              <div className="w-2 h-2 bg-fuchsia-500 rounded-full animate-pulse ml-3 mr-3 shadow-[0_0_10px_rgba(217,70,239,0.8)] shrink-0" />
              <input
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                disabled={isGenerating}
                placeholder="Describe a pipeline... e.g. 'Scrape hourly, summarize with AI, save to DB'"
                className="flex-1 bg-transparent text-xs text-white py-2.5 pr-3 outline-none placeholder:text-slate-600 font-medium"
              />
              <button
                type="submit"
                disabled={isGenerating || !aiPrompt.trim()}
                className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-xl disabled:opacity-50 transition-colors"
              >
                {isGenerating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
                )}
              </button>
            </form>
          </div>
        </div>
      </main>
      {/* ── RIGHT: Config + Terminal ── */}
      <aside className="w-80 shrink-0 border-l border-fuchsia-900/30 bg-[#0a0310]/80 backdrop-blur-xl flex flex-col z-10">
        <div
          className="flex-1 overflow-y-auto p-4"
          style={{ scrollbarWidth: "none" }}
        >
          {selectedNode ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-fuchsia-400" />
                <h2 className="text-sm font-bold text-white">Configuration</h2>
                <span
                  className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full ml-auto ${selectedNode.status === "running" ? "bg-fuchsia-900/50 text-fuchsia-300" : selectedNode.status === "completed" ? "bg-emerald-900/50 text-emerald-300" : "bg-slate-800 text-slate-400"}`}
                >
                  {selectedNode.status || "idle"}
                </span>
              </div>

              {/* Node name */}
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                  Node Name
                </label>
                <input
                  value={selectedNode.title}
                  onChange={(e) =>
                    setNodes((prev) =>
                      prev.map((n) =>
                        n.id === selectedNode.id
                          ? { ...n, title: e.target.value }
                          : n,
                      ),
                    )
                  }
                  className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white focus:border-fuchsia-500/50 outline-none transition-colors"
                />
              </div>

              {/* === TRIGGER: Webhook === */}
              {selectedNode.title === "Webhook Listener" && (
                <>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                      Endpoint Path
                    </label>
                    <input
                      value={String(selectedNode.config.endpoint || "")}
                      onChange={(e) =>
                        updateConfig(
                          selectedNode.id,
                          "endpoint",
                          e.target.value,
                        )
                      }
                      placeholder="/api/v1/ingest"
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white focus:border-amber-500/50 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                      Method
                    </label>
                    <div className="flex gap-1.5">
                      {["GET", "POST", "PUT"].map((m) => (
                        <button
                          key={m}
                          onClick={() =>
                            updateConfig(selectedNode.id, "method", m)
                          }
                          className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg border transition-all ${selectedNode.config.method === m ? "bg-amber-500/20 text-amber-400 border-amber-500/40" : "bg-transparent text-slate-400 border-white/10 hover:border-white/20"}`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                      Headers
                    </label>
                    <textarea
                      value={String(selectedNode.config.headers || "")}
                      onChange={(e) =>
                        updateConfig(selectedNode.id, "headers", e.target.value)
                      }
                      rows={3}
                      placeholder="Content-Type: application/json&#10;Authorization: Bearer ..."
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-[10px] text-white focus:border-amber-500/50 outline-none resize-none font-mono"
                    />
                  </div>
                </>
              )}

              {/* === TRIGGER: Scheduled === */}
              {selectedNode.title === "Scheduled Interval" && (
                <>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                      Preset
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { id: "hourly", label: "Hourly", cron: "0 * * * *" },
                        { id: "daily", label: "Daily", cron: "0 0 * * *" },
                        { id: "weekly", label: "Weekly", cron: "0 0 * * 0" },
                      ].map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            updateConfig(selectedNode.id, "preset", p.id);
                            updateConfig(selectedNode.id, "cron", p.cron);
                          }}
                          className={`py-1.5 text-[10px] font-bold rounded-lg border transition-all ${selectedNode.config.preset === p.id ? "bg-amber-500/20 text-amber-400 border-amber-500/40" : "bg-transparent text-slate-400 border-white/10 hover:border-white/20"}`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                      Cron Expression
                    </label>
                    <input
                      value={String(selectedNode.config.cron || "")}
                      onChange={(e) => {
                        updateConfig(selectedNode.id, "cron", e.target.value);
                        updateConfig(selectedNode.id, "preset", "custom");
                      }}
                      placeholder="0 * * * *"
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white font-mono focus:border-amber-500/50 outline-none"
                    />
                  </div>
                </>
              )}
              {/* === AGENT CONFIGS === */}
              {(selectedNode.title === "Logic Orchestrator" ||
                selectedNode.title === "Task Champion") && (
                <>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                      AI Model
                    </label>
                    <select
                      value={String(selectedNode.config.model)}
                      onChange={(e) =>
                        updateConfig(selectedNode.id, "model", e.target.value)
                      }
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white outline-none cursor-pointer"
                    >
                      <option value="lit-core-v4">Lit Core v4 (Fast)</option>
                      <option value="lit-reason-max">
                        Lit Reason Max (Smart)
                      </option>
                      <option value="lit-vision-pro">
                        Lit Vision Pro (Visual)
                      </option>
                    </select>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                        Temperature
                      </label>
                      <span className="text-[10px] text-fuchsia-400 font-mono">
                        {selectedNode.config.temperature}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={Number(selectedNode.config.temperature)}
                      onChange={(e) =>
                        updateConfig(
                          selectedNode.id,
                          "temperature",
                          parseFloat(e.target.value),
                        )
                      }
                      className="w-full accent-fuchsia-500"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                        System Prompt
                      </label>
                      <button
                        onClick={() => optimizePrompt(selectedNode.id)}
                        disabled={optimizingPrompt}
                        className="text-[8px] px-1.5 py-0.5 rounded border border-fuchsia-500/30 text-fuchsia-400 hover:bg-fuchsia-500/10 disabled:opacity-50 transition-all flex items-center gap-1"
                      >
                        {optimizingPrompt ? (
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        ) : (
                          <Wand2 className="w-2.5 h-2.5" />
                        )}{" "}
                        Auto-Optimize
                      </button>
                    </div>
                    <textarea
                      value={String(selectedNode.config.prompt)}
                      onChange={(e) =>
                        updateConfig(selectedNode.id, "prompt", e.target.value)
                      }
                      placeholder="Instruct this agent on its specific task..."
                      rows={5}
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2.5 text-xs text-white focus:border-fuchsia-500/50 outline-none transition-colors resize-none"
                    />
                  </div>
                </>
              )}

              {/* === ACTION: Database === */}
              {selectedNode.title === "Database Insert" && (
                <>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                      Target Table
                    </label>
                    <input
                      value={String(selectedNode.config.table || "")}
                      onChange={(e) =>
                        updateConfig(selectedNode.id, "table", e.target.value)
                      }
                      placeholder="pipeline_output"
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white focus:border-emerald-500/50 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                      Ledger Cluster
                    </label>
                    <select
                      value={String(selectedNode.config.cluster || "primary")}
                      onChange={(e) =>
                        updateConfig(selectedNode.id, "cluster", e.target.value)
                      }
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white outline-none cursor-pointer"
                    >
                      <option value="primary">Primary</option>
                      <option value="analytics">Analytics</option>
                      <option value="archive">Archive</option>
                    </select>
                  </div>
                </>
              )}

              {/* === ACTION: Discord === */}
              {selectedNode.title === "Discord Webhook" && (
                <>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                      Webhook URL
                    </label>
                    <input
                      value={String(selectedNode.config.webhook_url || "")}
                      onChange={(e) =>
                        updateConfig(
                          selectedNode.id,
                          "webhook_url",
                          e.target.value,
                        )
                      }
                      placeholder="https://discord.com/api/webhooks/..."
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white focus:border-emerald-500/50 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                      Message Template
                    </label>
                    <textarea
                      value={String(selectedNode.config.message_template || "")}
                      onChange={(e) =>
                        updateConfig(
                          selectedNode.id,
                          "message_template",
                          e.target.value,
                        )
                      }
                      rows={3}
                      placeholder="Pipeline completed: {{status}}"
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white focus:border-emerald-500/50 outline-none resize-none"
                    />
                  </div>
                </>
              )}

              {/* === ACTION: Email === */}
              {selectedNode.title === "Email Dispatch" && (
                <>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                      To
                    </label>
                    <input
                      value={String(selectedNode.config.to || "")}
                      onChange={(e) =>
                        updateConfig(selectedNode.id, "to", e.target.value)
                      }
                      placeholder="user@example.com"
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white focus:border-emerald-500/50 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                      Subject
                    </label>
                    <input
                      value={String(selectedNode.config.subject || "")}
                      onChange={(e) =>
                        updateConfig(selectedNode.id, "subject", e.target.value)
                      }
                      placeholder="Pipeline Alert"
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white focus:border-emerald-500/50 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                      Body
                    </label>
                    <textarea
                      value={String(selectedNode.config.body || "")}
                      onChange={(e) =>
                        updateConfig(selectedNode.id, "body", e.target.value)
                      }
                      rows={3}
                      placeholder="Pipeline finished execution."
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white focus:border-emerald-500/50 outline-none resize-none"
                    />
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 opacity-40">
              <SlidersHorizontal className="w-10 h-10 text-slate-600 mb-3" />
              <h3 className="text-xs font-bold text-white mb-1">
                No Node Selected
              </h3>
              <p className="text-[10px] text-slate-400">
                Click a block in the canvas to configure it.
              </p>
            </div>
          )}
        </div>

        {/* Terminal */}
        <div className="h-[220px] bg-[#050108] border-t border-fuchsia-900/40 flex flex-col relative">
          <div className="bg-[#130720]/80 px-3 py-1.5 border-b border-fuchsia-900/30 flex items-center justify-between absolute top-0 w-full z-10 backdrop-blur-md">
            <div className="flex items-center gap-2">
              <Terminal className="w-3 h-3 text-slate-400" />
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                Execution Log
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearTerminal}
                className="text-[8px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear
              </button>
              <div
                className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-fuchsia-500 animate-pulse shadow-[0_0_8px_rgba(217,70,239,0.8)]" : "bg-slate-700"}`}
              />
            </div>
          </div>
          <div
            className="flex-1 p-3 pt-9 overflow-y-auto font-mono text-[9px] space-y-1 flex flex-col"
            style={{ scrollbarWidth: "none" }}
          >
            {terminalLogs.map((log, i) => {
              let cls = "text-slate-500";
              if (log.includes("[OK]")) cls = "text-emerald-400";
              if (log.includes("[SYS]")) cls = "text-fuchsia-400";
              if (log.includes("[WRN]")) cls = "text-amber-400";
              if (log.includes("[ERR]")) cls = "text-red-400";
              if (log.includes("[ADD]") || log.includes("[DEL]"))
                cls = "text-blue-400";
              if (log.includes("[EXEC]")) cls = "text-white font-bold";
              if (log.includes("[AI]")) cls = "text-cyan-400";
              if (log.includes("[OPT]")) cls = "text-purple-400";
              if (log.includes("[RUN]")) cls = "text-white";
              return (
                <div key={i} className={`${cls} leading-snug`}>
                  {log}
                </div>
              );
            })}
            <div
              ref={bottomRef}
              className="text-fuchsia-500 animate-pulse font-bold"
            >
              _
            </div>
          </div>
        </div>
      </aside>
      {/* ── YAML Export Modal ── */}
      {showYaml && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
          onClick={() => setShowYaml(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl border overflow-hidden flex flex-col"
            style={{
              backgroundColor: "#0a0310",
              borderColor: "rgba(217,70,239,0.3)",
              maxHeight: "80vh",
            }}
          >
            <div
              className="px-4 py-3 border-b flex items-center justify-between"
              style={{ borderColor: "rgba(255,255,255,0.1)" }}
            >
              <div className="flex items-center gap-2">
                <FileJson className="w-4 h-4 text-fuchsia-400" />
                <span className="text-sm font-bold text-white">
                  Pipeline YAML
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyYaml}
                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-all hover:bg-white/5"
                  style={{
                    borderColor: "rgba(255,255,255,0.1)",
                    color: yamlCopied ? "#22c55e" : "#d946ef",
                  }}
                >
                  {yamlCopied ? (
                    <>
                      <Check className="w-3 h-3" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" /> Copy
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowYaml(false)}
                  className="text-slate-500 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div
              className="p-4 overflow-y-auto"
              style={{ scrollbarWidth: "none" }}
            >
              <pre
                className="font-mono text-[10px] leading-relaxed whitespace-pre-wrap"
                style={{ color: "#94a3b8" }}
              >
                {yaml}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
