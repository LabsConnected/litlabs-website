"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  Clock3,
  Code2,
  Database,
  Globe,
  Image as ImageIcon,
  Link2,
  Loader2,
  Music,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Workflow,
  XCircle,
  Zap,
} from "lucide-react";
import { AGENTS } from "@/lib/agents";

type TaskStatus = "queued" | "processing" | "success" | "failed" | "cancelled";
type Mission = {
  id: string;
  assigned_to: string;
  task_input: { prompt?: string };
  task_output?: { text?: string; critical_fault?: string };
  status: TaskStatus;
  created_at: string;
};

type NodeKind = "agent" | "input" | "action" | "output";
type FlowNode = {
  id: string;
  kind: NodeKind;
  title: string;
  subtitle: string;
  color: string;
  x: number;
  y: number;
  agentId?: "litt" | "spark";
};
type FlowEdge = { id: string; from: string; to: string };
type PaletteItem = Omit<FlowNode, "id" | "x" | "y"> & {
  icon: typeof Bot;
};

const NODE_WIDTH = 184;
const NODE_HEIGHT = 92;
const STORAGE_KEY = "litlabs-agent-workflow-v1";
const LOCAL_MISSIONS_KEY = "litlabs-agent-local-missions-v1";

const STARTER_NODES: FlowNode[] = [
  { id: "brief", kind: "input", title: "Mission brief", subtitle: "Your goal and constraints", color: "#65f4ff", x: 54, y: 118 },
  { id: "litt", kind: "agent", title: "LiTT", subtitle: "Plans, builds, and directs", color: "#a8ff2f", x: 306, y: 76, agentId: "litt" },
  { id: "spark", kind: "agent", title: "Spark", subtitle: "Explores creative directions", color: "#a970ff", x: 306, y: 232, agentId: "spark" },
  { id: "review", kind: "output", title: "Approval gate", subtitle: "You review before shipping", color: "#ffca5c", x: 558, y: 154 },
];

const STARTER_EDGES: FlowEdge[] = [
  { id: "brief-litt", from: "brief", to: "litt" },
  { id: "brief-spark", from: "brief", to: "spark" },
  { id: "litt-review", from: "litt", to: "review" },
  { id: "spark-review", from: "spark", to: "review" },
];

const PALETTE: PaletteItem[] = [
  { kind: "agent", title: "LiTT", subtitle: "Copilot + builder", color: "#a8ff2f", agentId: "litt", icon: Brain },
  { kind: "agent", title: "Spark", subtitle: "Creative explorer", color: "#a970ff", agentId: "spark", icon: Sparkles },
  { kind: "input", title: "Mission brief", subtitle: "Goal + context", color: "#65f4ff", icon: Target },
  { kind: "action", title: "Build code", subtitle: "App, site, or feature", color: "#22d3ee", icon: Code2 },
  { kind: "action", title: "Generate image", subtitle: "Visual creation", color: "#f472b6", icon: ImageIcon },
  { kind: "action", title: "Research web", subtitle: "Find + verify", color: "#60a5fa", icon: Globe },
  { kind: "action", title: "Use data", subtitle: "Read or write records", color: "#34d399", icon: Database },
  { kind: "action", title: "Create audio", subtitle: "Voice, music, sound", color: "#fb923c", icon: Music },
  { kind: "output", title: "Approval gate", subtitle: "Pause for your review", color: "#ffca5c", icon: CheckCircle2 },
  { kind: "output", title: "Ship result", subtitle: "Deploy or publish", color: "#a8ff2f", icon: Zap },
];

function statusMeta(status: TaskStatus) {
  switch (status) {
    case "processing": return { label: "Running", color: "#22d3ee", icon: Activity };
    case "success": return { label: "Completed", color: "#34d399", icon: CheckCircle2 };
    case "failed": return { label: "Failed", color: "#fb7185", icon: XCircle };
    case "cancelled": return { label: "Cancelled", color: "#94a3b8", icon: XCircle };
    default: return { label: "Queued", color: "#fbbf24", icon: Clock3 };
  }
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function nodeIcon(node: FlowNode) {
  if (node.agentId === "litt") return Brain;
  if (node.agentId === "spark") return Sparkles;
  if (node.kind === "input") return Target;
  if (node.kind === "output") return CheckCircle2;
  return Zap;
}

export default function AgentsPageClient() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<FlowNode[]>(STARTER_NODES);
  const [edges, setEdges] = useState<FlowEdge[]>(STARTER_EDGES);
  const [selectedId, setSelectedId] = useState("litt");
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [missionName, setMissionName] = useState("Launch a new creative project");
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executionMode, setExecutionMode] = useState<"connected" | "local">("connected");
  const [hydrated, setHydrated] = useState(false);

  const selected = nodes.find((node) => node.id === selectedId) ?? null;
  const activeMissions = useMemo(
    () => missions.filter((mission) => mission.status === "queued" || mission.status === "processing"),
    [missions],
  );

  const loadMissions = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/agent-tasks", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load mission activity");
      const data = await response.json();
      setMissions(data.tasks || []);
      setExecutionMode("connected");
      setError(null);
    } catch {
      const local = window.localStorage.getItem(LOCAL_MISSIONS_KEY);
      if (local) {
        try {
          setMissions(JSON.parse(local) as Mission[]);
        } catch {
          window.localStorage.removeItem(LOCAL_MISSIONS_KEY);
        }
      }
      setExecutionMode("local");
      if (!quiet) setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const savedFlow = window.localStorage.getItem(STORAGE_KEY);
    if (savedFlow) {
      try {
        const parsed = JSON.parse(savedFlow) as { nodes?: FlowNode[]; edges?: FlowEdge[]; missionName?: string };
        if (parsed.nodes?.length) setNodes(parsed.nodes);
        if (parsed.edges) setEdges(parsed.edges);
        if (parsed.missionName) setMissionName(parsed.missionName);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setHydrated(true);
    void loadMissions();
    const timer = window.setInterval(() => void loadMissions(true), 10_000);
    return () => window.clearInterval(timer);
  }, [loadMissions]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ nodes, edges, missionName }),
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [edges, hydrated, missionName, nodes]);

  const canvasPoint = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      x: Math.max(12, clientX - (rect?.left ?? 0) - NODE_WIDTH / 2),
      y: Math.max(12, clientY - (rect?.top ?? 0) - NODE_HEIGHT / 2),
    };
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const point = canvasPoint(event.clientX, event.clientY);
    const moveId = event.dataTransfer.getData("application/x-litlabs-node");
    if (moveId) {
      setNodes((current) => current.map((node) => node.id === moveId ? { ...node, ...point } : node));
      return;
    }
    const paletteIndex = Number(event.dataTransfer.getData("application/x-litlabs-palette"));
    const item = PALETTE[paletteIndex];
    if (!item) return;
    const node: FlowNode = {
      id: `${item.kind}-${Date.now()}`,
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle,
      color: item.color,
      agentId: item.agentId,
      ...point,
    };
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
  };

  const addPaletteItem = (item: PaletteItem) => {
    const index = nodes.length;
    const node: FlowNode = {
      id: `${item.kind}-${Date.now()}`,
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle,
      color: item.color,
      agentId: item.agentId,
      x: 70 + (index % 3) * 220,
      y: 80 + Math.floor(index / 3) * 120,
    };
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
  };

  const selectNode = (node: FlowNode) => {
    if (connectingFrom && connectingFrom !== node.id) {
      const duplicate = edges.some((edge) => edge.from === connectingFrom && edge.to === node.id);
      if (!duplicate) {
        setEdges((current) => [...current, { id: `${connectingFrom}-${node.id}-${Date.now()}`, from: connectingFrom, to: node.id }]);
      }
      setConnectingFrom(null);
    }
    setSelectedId(node.id);
  };

  const updateSelected = (patch: Partial<FlowNode>) => {
    if (!selectedId) return;
    setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, ...patch } : node));
  };

  const removeSelected = () => {
    if (!selectedId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) => current.filter((edge) => edge.from !== selectedId && edge.to !== selectedId));
    setSelectedId("");
    setConnectingFrom(null);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const copy: FlowNode = {
      ...selected,
      id: `${selected.kind}-${Date.now()}`,
      title: `${selected.title} copy`,
      x: selected.x + 34,
      y: selected.y + 34,
    };
    setNodes((current) => [...current, copy]);
    setSelectedId(copy.id);
  };

  const removeEdge = (edgeId: string) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (editing) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        removeSelected();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && selected) {
        event.preventDefault();
        duplicateSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const saveFlow = () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges, missionName }));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const resetFlow = () => {
    setNodes(STARTER_NODES);
    setEdges(STARTER_EDGES);
    setSelectedId("litt");
    setConnectingFrom(null);
  };

  const runWorkflow = async () => {
    if (running || nodes.length < 2 || missionName.trim().length < 4) return;
    const agentIds = nodes.filter((node) => node.agentId).map((node) => node.agentId);
    const assignedTo = agentIds.includes("litt") ? "litt" : agentIds[0] || "litt";
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/agent-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: crypto.randomUUID(),
          assignedTo,
          dispatcher: "workflow-builder",
          taskInput: {
            prompt: missionName.trim(),
            agentSlug: assignedTo,
            context: {
              source: "agent-workflow-builder",
              workflow: {
                nodes: nodes.map(({ id, kind, title, subtitle, agentId }) => ({ id, kind, title, subtitle, agentId })),
                edges,
              },
            },
          },
          meta: { source: "agent-workflow-builder", nodeCount: nodes.length },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Workflow could not be queued");
      saveFlow();
      setExecutionMode("connected");
      await loadMissions(true);
    } catch {
      const localMission: Mission = {
        id: `local-${Date.now()}`,
        assigned_to: assignedTo,
        task_input: { prompt: missionName.trim() },
        task_output: {
          text: "Workflow draft validated and saved locally. Connect a runtime when you are ready to execute external actions.",
        },
        status: "success",
        created_at: new Date().toISOString(),
      };
      setMissions((current) => {
        const next = [localMission, ...current.filter((mission) => mission.id !== localMission.id)];
        window.localStorage.setItem(LOCAL_MISSIONS_KEY, JSON.stringify(next.slice(0, 30)));
        return next;
      });
      saveFlow();
      setExecutionMode("local");
      setError(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="relative h-full overflow-y-auto bg-[#03050a] pb-24 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_12%,rgba(168,255,47,.08),transparent_24%),radial-gradient(circle_at_88%_20%,rgba(169,112,255,.12),transparent_28%),radial-gradient(circle_at_50%_90%,rgba(34,211,238,.08),transparent_30%)]" />
      <div className="relative mx-auto max-w-[1600px] space-y-4 px-3 py-4 sm:px-5 lg:px-7">
        <header className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#070a12] px-5 py-5 shadow-[0_25px_80px_rgba(0,0,0,.35)] sm:px-7">
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(101,244,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(101,244,255,.05)_1px,transparent_1px)] [background-size:42px_42px]" />
          <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full bg-violet-500/15 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
            <div className="flex items-center gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-lime-300/30 bg-lime-300/10 text-lime-300 shadow-[0_0_30px_rgba(168,255,47,.15)]"><Workflow size={23} /></div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Agent Workflow Forge</h1>
                  <span className={`rounded-full border px-2.5 py-1 text-[8px] font-black uppercase tracking-widest ${executionMode === "connected" ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-300" : "border-amber-300/25 bg-amber-300/10 text-amber-300"}`}>
                    {executionMode === "connected" ? "Connected runtime" : "Local draft mode"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-white/45">Drag agents and capabilities onto the canvas. Connect them. Run the mission.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-[10px] text-white/45">{nodes.length} blocks · {edges.length} links</span>
              <button onClick={saveFlow} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-xs font-black text-white/65 hover:border-cyan-300/35 hover:text-cyan-200"><Save size={13} />{saved ? "Saved" : "Save"}</button>
              <button onClick={resetFlow} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-xs font-black text-white/65 hover:border-white/25"><RefreshCw size={13} />Reset</button>
              <button onClick={() => void runWorkflow()} disabled={running || nodes.length < 2} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#a8ff2f] to-[#5df5d0] px-4 py-2 text-xs font-black text-[#03050a] shadow-[0_0_35px_rgba(168,255,47,.18)] disabled:opacity-40">
                {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />} Run workflow
              </button>
            </div>
          </div>
        </header>

        <section className="grid min-h-[720px] gap-3 xl:grid-cols-[250px_minmax(600px,1fr)_300px]">
          <aside className="rounded-3xl border border-white/10 bg-[#070a12]/95 p-4">
            <div className="flex items-center justify-between">
              <div><p className="text-[9px] font-black uppercase tracking-[.18em] text-cyan-300">Block library</p><h2 className="mt-1 text-sm font-black">Drag to build</h2></div>
              <Plus size={16} className="text-white/35" />
            </div>
            <p className="mt-2 text-[10px] leading-4 text-white/35">Drop blocks on the forge, then drag them into place.</p>
            <div className="mt-4 space-y-2">
              {PALETTE.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div
                    key={`${item.title}-${index}`}
                    draggable
                    role="button"
                    tabIndex={0}
                    onClick={() => addPaletteItem(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        addPaletteItem(item);
                      }
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("application/x-litlabs-palette", String(index));
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                    className="group flex cursor-grab items-center gap-3 rounded-2xl border border-white/10 bg-white/[.025] p-3 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[.055] active:cursor-grabbing"
                    title={`Click or drag to add ${item.title}`}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border" style={{ borderColor: `${item.color}35`, backgroundColor: `${item.color}12`, color: item.color }}><Icon size={15} /></span>
                    <span className="min-w-0"><span className="block text-[11px] font-black">{item.title}</span><span className="block truncate text-[9px] text-white/35">{item.subtitle}</span></span>
                    <span className="ml-auto text-white/15 group-hover:text-white/45">⋮⋮</span>
                  </div>
                );
              })}
            </div>
            <Link href="/studio?intent=agent" className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-violet-400/25 bg-violet-400/[.08] px-3 py-2.5 text-[10px] font-black text-violet-300 hover:border-violet-400/50">
              <Plus size={13} /> Create specialist agent
            </Link>
          </aside>

          <div className="overflow-hidden rounded-3xl border border-cyan-300/15 bg-[#050812] shadow-[inset_0_0_80px_rgba(0,0,0,.45),0_25px_80px_rgba(0,0,0,.3)]">
            <div className="flex flex-col gap-3 border-b border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <label className="text-[8px] font-black uppercase tracking-[.18em] text-white/30">Mission name</label>
                <input value={missionName} onChange={(event) => setMissionName(event.target.value)} className="mt-1 w-full bg-transparent text-sm font-black text-white outline-none placeholder:text-white/20" placeholder="Name the outcome you want…" />
              </div>
              <div className="flex items-center gap-2">
                {connectingFrom ? <span className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1.5 text-[9px] font-bold text-cyan-200">Choose a target block</span> : <span className="hidden text-[9px] text-white/30 sm:block">Drag blocks · click to inspect</span>}
                {connectingFrom && <button onClick={() => setConnectingFrom(null)} className="text-[9px] font-bold text-white/40 hover:text-white">Cancel</button>}
              </div>
            </div>
            <div
              ref={canvasRef}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = event.dataTransfer.types.includes("application/x-litlabs-node") ? "move" : "copy";
              }}
              onDrop={handleDrop}
              className="relative min-h-[650px] overflow-auto bg-[radial-gradient(circle_at_50%_20%,rgba(169,112,255,.09),transparent_35%)]"
            >
              <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(101,244,255,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(101,244,255,.07)_1px,transparent_1px)] [background-size:32px_32px]" />
              <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
                <defs>
                  <linearGradient id="flow-line" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#65f4ff" stopOpacity=".65" />
                    <stop offset="100%" stopColor="#a970ff" stopOpacity=".75" />
                  </linearGradient>
                </defs>
                {edges.map((edge) => {
                  const from = nodes.find((node) => node.id === edge.from);
                  const to = nodes.find((node) => node.id === edge.to);
                  if (!from || !to) return null;
                  const x1 = from.x + NODE_WIDTH;
                  const y1 = from.y + NODE_HEIGHT / 2;
                  const x2 = to.x;
                  const y2 = to.y + NODE_HEIGHT / 2;
                  const bend = Math.max(60, Math.abs(x2 - x1) * 0.45);
                  return <path key={edge.id} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} fill="none" stroke="url(#flow-line)" strokeWidth="2" strokeDasharray="6 6" />;
                })}
              </svg>

              {nodes.map((node) => {
                const Icon = nodeIcon(node);
                const isSelected = node.id === selectedId;
                const isConnecting = node.id === connectingFrom;
                return (
                  <button
                    key={node.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("application/x-litlabs-node", node.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => selectNode(node)}
                    className="absolute cursor-grab rounded-2xl border p-3 text-left shadow-2xl transition hover:-translate-y-0.5 active:cursor-grabbing"
                    style={{
                      width: NODE_WIDTH,
                      height: NODE_HEIGHT,
                      left: node.x,
                      top: node.y,
                      borderColor: isSelected || isConnecting ? `${node.color}aa` : `${node.color}45`,
                      background: `linear-gradient(145deg, ${node.color}18, rgba(6,9,18,.96) 55%)`,
                      boxShadow: isSelected ? `0 0 0 1px ${node.color}55, 0 0 34px ${node.color}20` : "0 18px 40px rgba(0,0,0,.32)",
                    }}
                  >
                    <span className="flex items-start gap-3">
                      <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border" style={{ borderColor: `${node.color}45`, backgroundColor: `${node.color}15`, color: node.color }}>
                        {node.agentId ? <Image src={node.agentId === "spark" ? "/brand/spark-agent-hero-v2.png" : "/brand/litt-agent-hero-v2.png"} alt="" fill className="object-cover" /> : <Icon size={16} />}
                      </span>
                      <span className="min-w-0"><span className="block truncate text-xs font-black">{node.title}</span><span className="mt-1 block line-clamp-2 text-[9px] leading-3 text-white/40">{node.subtitle}</span></span>
                    </span>
                    <span className="absolute bottom-2 right-3 text-[7px] font-black uppercase tracking-widest" style={{ color: node.color }}>{node.kind}</span>
                  </button>
                );
              })}

              {nodes.length === 0 && (
                <div className="absolute inset-0 grid place-items-center p-8 text-center">
                  <div><Workflow size={34} className="mx-auto text-white/15" /><h3 className="mt-3 text-sm font-black">Your forge is empty</h3><p className="mt-1 text-[10px] text-white/35">Drag LiTT, Spark, and capability blocks here to begin.</p></div>
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-3">
            <section className="rounded-3xl border border-white/10 bg-[#070a12]/95 p-4">
              <div className="flex items-center justify-between"><div><p className="text-[9px] font-black uppercase tracking-[.18em] text-violet-300">Inspector</p><h2 className="mt-1 text-sm font-black">{selected ? selected.title : "Select a block"}</h2></div><Settings2 size={15} className="text-white/30" /></div>
              {selected ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="text-[8px] font-black uppercase tracking-wider text-white/30">Block name</label>
                    <input value={selected.title} onChange={(event) => updateSelected({ title: event.target.value })} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs font-bold outline-none focus:border-violet-400/50" />
                  </div>
                  <div>
                    <label className="text-[8px] font-black uppercase tracking-wider text-white/30">What it does</label>
                    <textarea value={selected.subtitle} onChange={(event) => updateSelected({ subtitle: event.target.value })} rows={3} className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs leading-5 outline-none focus:border-violet-400/50" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setConnectingFrom(selected.id)} className="flex items-center justify-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/[.07] px-3 py-2.5 text-[9px] font-black text-cyan-200 hover:border-cyan-300/50"><Link2 size={12} /> Connect</button>
                    <button onClick={removeSelected} className="flex items-center justify-center gap-2 rounded-xl border border-rose-400/20 bg-rose-400/[.06] px-3 py-2.5 text-[9px] font-black text-rose-300 hover:border-rose-400/45"><Trash2 size={12} /> Remove</button>
                    <button onClick={duplicateSelected} className="col-span-2 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-3 py-2.5 text-[9px] font-black text-white/60 hover:border-violet-300/35 hover:text-violet-200"><Plus size={12} /> Duplicate block</button>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[.025] p-3">
                    <div className="flex items-center justify-between text-[9px]"><span className="text-white/35">Incoming links</span><span className="font-black">{edges.filter((edge) => edge.to === selected.id).length}</span></div>
                    <div className="mt-2 flex items-center justify-between text-[9px]"><span className="text-white/35">Outgoing links</span><span className="font-black">{edges.filter((edge) => edge.from === selected.id).length}</span></div>
                    <div className="mt-2 flex items-center justify-between text-[9px]"><span className="text-white/35">Runtime</span><span className="font-black text-emerald-300">Ready</span></div>
                  </div>
                  {(edges.some((edge) => edge.from === selected.id || edge.to === selected.id)) && (
                    <div>
                      <div className="mb-2 text-[8px] font-black uppercase tracking-wider text-white/30">Connections</div>
                      <div className="space-y-1.5">
                        {edges
                          .filter((edge) => edge.from === selected.id || edge.to === selected.id)
                          .map((edge) => {
                            const peerId = edge.from === selected.id ? edge.to : edge.from;
                            const peer = nodes.find((node) => node.id === peerId);
                            return (
                              <div key={edge.id} className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/20 px-2.5 py-2 text-[9px]">
                                <Link2 size={10} className="text-cyan-300" />
                                <span className="min-w-0 flex-1 truncate text-white/55">
                                  {edge.from === selected.id ? "To" : "From"} {peer?.title || "Unknown block"}
                                </span>
                                <button onClick={() => removeEdge(edge.id)} className="rounded-lg p-1 text-rose-300/60 hover:bg-rose-400/10 hover:text-rose-300" aria-label={`Remove connection with ${peer?.title || "block"}`}>
                                  <XCircle size={11} />
                                </button>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              ) : <p className="mt-4 text-[10px] leading-5 text-white/35">Click any block on the canvas to rename it, explain its job, connect it, or remove it.</p>}
            </section>

            <section className="overflow-hidden rounded-3xl border border-violet-400/20 bg-[#090712]">
              <div className="relative aspect-[16/10]">
                <Image src="/brand/spark-agent-hero-v2.png" alt="Spark in the workflow forge" fill className="object-cover opacity-70" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#090712] via-transparent to-transparent" />
              </div>
              <div className="-mt-8 relative p-4">
                <div className="text-[9px] font-black uppercase tracking-[.18em] text-violet-300">Spark suggestion</div>
                <p className="mt-2 text-xs font-black">Add an approval gate before anything ships.</p>
                <p className="mt-1 text-[9px] leading-4 text-white/35">It keeps you in control and makes the workflow safe to reuse.</p>
              </div>
            </section>
          </aside>
        </section>

        <section className="rounded-3xl border border-white/10 bg-[#070a12] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-[9px] font-black uppercase tracking-[.18em] text-lime-300">{executionMode === "connected" ? "Real mission activity" : "Local mission drafts"}</p><h2 className="mt-1 text-sm font-black">{activeMissions.length ? `${activeMissions.length} mission${activeMissions.length === 1 ? "" : "s"} running` : executionMode === "connected" ? "Forge activity" : "Build now · connect later"}</h2></div>
            <button onClick={() => void loadMissions()} className="rounded-xl border border-white/10 p-2 text-white/40 hover:text-white" aria-label="Refresh missions"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
          </div>
          {error && <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/[.06] px-3 py-2 text-[10px] text-rose-300">{error}</div>}
          <div className="mt-4 grid gap-2 lg:grid-cols-3">
            {loading && missions.length === 0 ? (
              <div className="col-span-full grid min-h-24 place-items-center"><Loader2 className="animate-spin text-white/30" size={18} /></div>
            ) : missions.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-dashed border-white/10 p-7 text-center"><Bot size={22} className="mx-auto text-white/15" /><p className="mt-2 text-xs font-black">No missions yet</p><p className="mt-1 text-[9px] text-white/30">Build the flow above, then press Run workflow.</p></div>
            ) : missions.slice(0, 6).map((mission) => {
              const meta = statusMeta(mission.status);
              const StatusIcon = meta.icon;
              const agent = AGENTS[mission.assigned_to];
              return (
                <article key={mission.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-start gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ color: meta.color, backgroundColor: `${meta.color}12` }}><StatusIcon size={13} className={mission.status === "processing" ? "animate-pulse" : ""} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-black">{mission.task_input?.prompt || "Untitled mission"}</span><span className="mt-1 block text-[8px] text-white/30">{agent?.name || mission.assigned_to} · {relativeTime(mission.created_at)}</span></span>
                    <span className="text-[7px] font-black uppercase" style={{ color: meta.color }}>{meta.label}</span>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end"><Link href="/studio" className="flex items-center gap-2 text-[10px] font-black text-cyan-300">Open execution workspace <ArrowRight size={11} /></Link></div>
        </section>
      </div>
    </main>
  );
}
