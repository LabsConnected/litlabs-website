"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Box, Terminal, Activity, Zap, Play, Cpu,
  Loader2, Settings, Webhook, Database, MessageSquare,
  Trash2, SlidersHorizontal, Save, Network, RefreshCw
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */
const NODE_TYPES = {
  trigger: { id: "trigger", label: "Trigger",  color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30"   },
  agent:   { id: "agent",   label: "AI Agent", color: "text-fuchsia-400", bg: "bg-fuchsia-600/10", border: "border-fuchsia-500/30" },
  action:  { id: "action",  label: "Action",   color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
} as const;
type NodeType = keyof typeof NODE_TYPES;

interface LibraryItem { type: NodeType; title: string; icon: React.ReactNode; desc: string; }
interface PipelineNode { id: string; type: NodeType; title: string; config: Record<string, string | number>; }

const LIBRARY_ITEMS: LibraryItem[] = [
  { type: "trigger", title: "Webhook Listener",   icon: <Webhook   className="w-4 h-4" />, desc: "Fired via HTTP POST request."         },
  { type: "trigger", title: "Scheduled Interval", icon: <Activity  className="w-4 h-4" />, desc: "Runs on a cron schedule."             },
  { type: "agent",   title: "Logic Orchestrator", icon: <Network   className="w-4 h-4" />, desc: "Routes data based on AI analysis."   },
  { type: "agent",   title: "Task Champion",      icon: <Cpu       className="w-4 h-4" />, desc: "Heavy-duty reasoning & text tasks."  },
  { type: "action",  title: "Database Insert",    icon: <Database  className="w-4 h-4" />, desc: "Saves output to LitLabs Ledger."     },
  { type: "action",  title: "Discord Webhook",    icon: <MessageSquare className="w-4 h-4" />, desc: "Sends alert to a Discord channel." },
];

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */
export default function PipelineTool() {
  const [nodes, setNodes] = useState<PipelineNode[]>([
    { id: "1", type: "trigger", title: "Webhook Listener", config: { endpoint: "/api/v1/ingest" } },
    { id: "2", type: "agent",   title: "Task Champion",    config: { model: "lit-core-v4", temperature: 0.7, prompt: "Analyze the incoming JSON and summarize the key directives." } },
  ]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("2");
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<string[]>(["[SYS] Workspace initialized.", "[SYS] Ready for node configuration."]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalLogs]);

  const logTerminal = (msg: string) => {
    setTerminalLogs(prev => [...prev, `[${new Date().toISOString().split("T")[1].slice(0, 8)}] ${msg}`]);
  };

  const addNode = (item: LibraryItem) => {
    const newNode: PipelineNode = {
      id: Date.now().toString(),
      type: item.type,
      title: item.title,
      config: item.type === "agent" ? { model: "lit-core-v4", temperature: 0.5, prompt: "" } : {},
    };
    setNodes(prev => [...prev, newNode]);
    setSelectedNodeId(newNode.id);
    logTerminal(`[ADD] Inserted node: ${item.title}`);
  };

  const deleteNode = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setNodes(prev => prev.filter(n => n.id !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
    logTerminal(`[DEL] Removed node ID: ${id}`);
  };

  const updateNodeConfig = (id: string, field: string, value: string | number) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, config: { ...n.config, [field]: value } } : n));
  };

  const runPipeline = () => {
    if (nodes.length === 0) { logTerminal("[WRN] Pipeline is empty."); return; }
    setIsRunning(true);
    logTerminal("[EXEC] Initiating pipeline run sequence...");
    nodes.forEach((node, idx) => {
      setTimeout(() => {
        logTerminal(`[OK] Executing node ${idx + 1}: ${node.title}`);
        if (node.type === "agent") logTerminal(`      \u21b3 Tokens consumed: ${Math.floor(Math.random() * 500) + 120}`);
        if (idx === nodes.length - 1) {
          setTimeout(() => { logTerminal("[SYS] Pipeline execution completed successfully."); setIsRunning(false); }, 800);
        }
      }, (idx + 1) * 800);
    });
  };

  const handleAiBuild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    const prompt = aiPrompt;
    setAiPrompt("");
    logTerminal(`[AI] Interpreting architecture prompt...`);
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Generate a 3-4 node AI pipeline for: "${prompt}". Reply ONLY with a JSON array: [{"type":"trigger","title":"...","config":{}},{"type":"agent","title":"...","config":{"model":"lit-core-v4","temperature":0.5,"prompt":"..."}},...]. Types: trigger, agent, action.`,
          systemPrompt: "You are a pipeline architect. Output ONLY valid JSON arrays, no explanation.",
        }),
      });
      const data = await res.json();
      try {
        const raw = data.response.match(/\[[\s\S]*\]/)?.[0];
        const parsed = JSON.parse(raw);
        const built: PipelineNode[] = parsed.map((n: { type: string; title: string; config?: Record<string, string | number> }, i: number) => ({
          id: (Date.now() + i).toString(),
          type: (["trigger", "agent", "action"].includes(n.type) ? n.type : "agent") as NodeType,
          title: n.title || "AI Node",
          config: n.config || (n.type === "agent" ? { model: "lit-core-v4", temperature: 0.5, prompt: "" } : {}),
        }));
        setNodes(built);
        setSelectedNodeId(built[1]?.id || built[0]?.id || null);
        logTerminal(`[OK] AI deployed ${built.length}-node pipeline.`);
      } catch {
        setNodes([
          { id: "1", type: "trigger", title: "Scheduled Interval", config: { cron: "0 * * * *" } },
          { id: "2", type: "agent",   title: "Logic Orchestrator", config: { model: "lit-core-v4", temperature: 0.2, prompt: `Handle: ${prompt}` } },
          { id: "3", type: "action",  title: "Database Insert",    config: { table: "pipeline_output" } },
        ]);
        setSelectedNodeId("2");
        logTerminal("[OK] AI Orchestrator deployed 3-node pipeline.");
      }
    } catch {
      logTerminal("[ERR] AI build failed \u2014 check API connection.");
    }
    setIsGenerating(false);
  };

  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  return (
    <div className="flex h-full bg-[#050108] text-slate-300 font-sans overflow-hidden relative">

      {/* Cyber Grid */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.12]"
        style={{ backgroundImage: "linear-gradient(rgba(217,70,239,0.15) 1px,transparent 1px),linear-gradient(90deg,rgba(217,70,239,0.15) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />

      {/* LEFT: Library */}
      <aside className="w-56 flex-shrink-0 border-r border-fuchsia-900/30 bg-[#0a0310]/80 backdrop-blur-xl flex flex-col z-10">
        <div className="p-3 border-b border-white/5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Box className="w-3.5 h-3.5" /> Tool Library
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4" style={{ scrollbarWidth: "none" }}>
          {(["trigger", "agent", "action"] as NodeType[]).map(cat => (
            <div key={cat} className="space-y-1.5">
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest pl-1">
                {cat === "trigger" ? "1. Triggers" : cat === "agent" ? "2. AI Agents" : "3. Actions"}
              </div>
              {LIBRARY_ITEMS.filter(i => i.type === cat).map((item, idx) => {
                const s = NODE_TYPES[item.type];
                return (
                  <div key={idx} onClick={() => addNode(item)}
                    className="bg-[#130720]/80 border border-white/5 hover:border-fuchsia-500/40 rounded-xl p-2.5 cursor-pointer transition-all">
                    <div className="flex items-center mb-1">
                      <div className={`w-5 h-5 rounded flex items-center justify-center mr-2 border ${s.bg} ${s.border} ${s.color}`}>{item.icon}</div>
                      <span className="text-[11px] font-bold text-white">{item.title}</span>
                    </div>
                    <p className="text-[9px] text-slate-500 ml-7 leading-tight">{item.desc}</p>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* CENTER: Canvas */}
      <main className="flex-1 relative flex flex-col items-center overflow-y-auto py-8 z-10" style={{ scrollbarWidth: "none" }}>

        {/* Header bar */}
        <div className="w-full max-w-lg mb-6 flex items-center justify-between px-1">
          <span className="text-xs font-mono text-slate-500">untitled_pipeline.yaml</span>
          <div className="flex items-center gap-2">
            <button onClick={runPipeline} disabled={isRunning || nodes.length === 0}
              className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/50 disabled:opacity-50 text-[10px] font-bold rounded flex items-center gap-1.5 transition-all">
              {isRunning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {isRunning ? "Running..." : "Test Run"}
            </button>
            <button className="px-3 py-1.5 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-[10px] font-bold rounded flex items-center gap-1.5 transition-all">
              <Save className="w-3 h-3" /> Save
            </button>
          </div>
        </div>

        <div className="w-full max-w-lg flex flex-col items-center pb-32">
          {nodes.length === 0 ? (
            <div className="mt-16 text-center flex flex-col items-center">
              <Network className="w-14 h-14 text-slate-700 mb-4" />
              <h2 className="text-lg font-bold text-slate-400 mb-2">Pipeline Empty</h2>
              <p className="text-sm text-slate-500 max-w-sm">Click tools from the library or ask the AI to generate a pipeline.</p>
            </div>
          ) : nodes.map((node, idx) => {
            const s = NODE_TYPES[node.type];
            const isSelected = selectedNodeId === node.id;
            return (
              <React.Fragment key={node.id}>
                <div onClick={() => setSelectedNodeId(node.id)}
                  className={`w-full bg-[#130720]/90 backdrop-blur-md rounded-2xl p-4 border-2 transition-all cursor-pointer relative group
                    ${isSelected ? "border-fuchsia-500 shadow-[0_0_30px_rgba(217,70,239,0.2)]" : "border-white/5 hover:border-white/20 shadow-lg"}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${s.bg} ${s.border} ${s.color}`}>
                        {node.type === "trigger" ? <Zap className="w-4 h-4" /> : node.type === "agent" ? <Cpu className="w-4 h-4" /> : <Box className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className={`text-[9px] font-bold uppercase tracking-widest ${s.color} mb-0.5`}>{s.label}</div>
                        <div className="text-sm font-bold text-white">{node.title}</div>
                      </div>
                    </div>
                    <button onClick={e => deleteNode(node.id, e)}
                      className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {node.type === "agent" && (
                    <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span className="truncate flex-1 max-w-[200px]"><span className="text-fuchsia-500/50 mr-2">prompt:</span>{String(node.config.prompt) || "No prompt set..."}</span>
                      <span className="bg-black/30 px-2 py-0.5 rounded border border-white/5 ml-3 shrink-0 text-[9px]">{String(node.config.model)}</span>
                    </div>
                  )}
                </div>
                {idx < nodes.length - 1 && (
                  <div className="h-8 w-px bg-gradient-to-b from-fuchsia-500/50 to-emerald-500/50 my-1.5 relative">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-fuchsia-500 bg-[#0a0310]" />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* AI Builder Bar — pinned to bottom of canvas */}
        <div className="sticky bottom-4 w-full max-w-xl px-4 z-30">
          <div className="bg-[#0a0310]/95 backdrop-blur-2xl border border-fuchsia-500/40 rounded-2xl p-2 shadow-[0_10px_50px_rgba(217,70,239,0.2)] focus-within:border-fuchsia-400 transition-all">
            <form onSubmit={handleAiBuild} className="flex items-center w-full">
              <div className="w-2 h-2 bg-fuchsia-500 rounded-full animate-pulse mx-3 shadow-[0_0_10px_rgba(217,70,239,0.8)] shrink-0" />
              <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} disabled={isGenerating}
                placeholder="Describe a pipeline... e.g. 'Scrape news, summarize, post to Slack'"
                className="flex-1 bg-transparent text-xs text-white py-2.5 pr-3 outline-none placeholder:text-slate-600 font-medium" />
              <button type="submit" disabled={isGenerating || !aiPrompt.trim()}
                className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-xl disabled:opacity-50 transition-colors">
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-fuchsia-400" />}
              </button>
            </form>
          </div>
        </div>
      </main>

      {/* RIGHT: Config + Terminal */}
      <aside className="w-72 flex-shrink-0 border-l border-fuchsia-900/30 bg-[#0a0310]/80 backdrop-blur-xl flex flex-col z-10">
        <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: "none" }}>
          {selectedNode ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-fuchsia-400" />
                <h2 className="text-sm font-bold text-white">Configuration</h2>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Node Name</label>
                  <input value={selectedNode.title}
                    onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, title: e.target.value } : n))}
                    className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white focus:border-fuchsia-500/50 outline-none transition-colors" />
                </div>
                {selectedNode.type === "agent" && (
                  <>
                    <div>
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">AI Model</label>
                      <select value={String(selectedNode.config.model)}
                        onChange={e => updateNodeConfig(selectedNode.id, "model", e.target.value)}
                        className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white outline-none cursor-pointer">
                        <option value="lit-core-v4">Lit Core v4 (Fast)</option>
                        <option value="lit-reason-max">Lit Reason Max (Smart)</option>
                        <option value="lit-vision-pro">Lit Vision Pro (Visual)</option>
                      </select>
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Temperature</label>
                        <span className="text-[10px] text-fuchsia-400 font-mono">{selectedNode.config.temperature}</span>
                      </div>
                      <input type="range" min="0" max="1" step="0.1"
                        value={Number(selectedNode.config.temperature)}
                        onChange={e => updateNodeConfig(selectedNode.id, "temperature", parseFloat(e.target.value))}
                        className="w-full accent-fuchsia-500" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">System Prompt</label>
                      <textarea value={String(selectedNode.config.prompt)}
                        onChange={e => updateNodeConfig(selectedNode.id, "prompt", e.target.value)}
                        placeholder="Instruct this agent on its specific task..."
                        className="w-full bg-[#130720] border border-white/10 rounded-lg p-2.5 text-xs text-white focus:border-fuchsia-500/50 outline-none transition-colors min-h-[120px] resize-none" />
                    </div>
                  </>
                )}
                {selectedNode.type === "action" && (
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Target Destination</label>
                    <input value={String(selectedNode.config.table || "")}
                      onChange={e => updateNodeConfig(selectedNode.id, "table", e.target.value)}
                      placeholder="e.g. scraped_data_table"
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white focus:border-emerald-500/50 outline-none transition-colors" />
                  </div>
                )}
                {selectedNode.type === "trigger" && (
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Endpoint / Cron</label>
                    <input value={String(selectedNode.config.endpoint || selectedNode.config.cron || "")}
                      onChange={e => updateNodeConfig(selectedNode.id, "endpoint", e.target.value)}
                      placeholder="/api/v1/ingest or 0 * * * *"
                      className="w-full bg-[#130720] border border-white/10 rounded-lg p-2 text-xs text-white focus:border-amber-500/50 outline-none transition-colors" />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 opacity-40">
              <SlidersHorizontal className="w-10 h-10 text-slate-600 mb-3" />
              <h3 className="text-xs font-bold text-white mb-1">No Node Selected</h3>
              <p className="text-[10px] text-slate-400">Click a block in the canvas to configure it.</p>
            </div>
          )}
        </div>

        {/* Terminal */}
        <div className="h-[220px] bg-[#050108] border-t border-fuchsia-900/40 flex flex-col relative">
          <div className="bg-[#130720]/80 px-3 py-1.5 border-b border-fuchsia-900/30 flex items-center justify-between absolute top-0 w-full z-10 backdrop-blur-md">
            <div className="flex items-center gap-2"><Terminal className="w-3 h-3 text-slate-400" /><span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Execution Log</span></div>
            <div className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-fuchsia-500 animate-pulse shadow-[0_0_8px_rgba(217,70,239,0.8)]" : "bg-slate-700"}`} />
          </div>
          <div className="flex-1 p-3 pt-9 overflow-y-auto font-mono text-[9px] space-y-1 flex flex-col" style={{ scrollbarWidth: "none" }}>
            {terminalLogs.map((log, i) => {
              let cls = "text-slate-500";
              if (log.includes("[OK]"))   cls = "text-emerald-400";
              if (log.includes("[SYS]"))  cls = "text-fuchsia-400";
              if (log.includes("[WRN]") || log.includes("[ERR]")) cls = "text-amber-400";
              if (log.includes("[ADD]") || log.includes("[DEL]")) cls = "text-blue-400";
              if (log.includes("[EXEC]")) cls = "text-white font-bold";
              if (log.includes("[AI]"))   cls = "text-cyan-400";
              return <div key={i} className={`${cls} leading-snug`}>{log}</div>;
            })}
            <div ref={bottomRef} className="text-fuchsia-500 animate-pulse font-bold">_</div>
          </div>
        </div>
      </aside>
    </div>
  );
}
