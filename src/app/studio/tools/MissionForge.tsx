"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  Database,
  FileJson,
  Globe,
  Loader2,
  Mail,
  Maximize2,
  MessageSquare,
  Minus,
  Network,
  Package,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Target,
  Trash2,
  Webhook,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";

/* ─── Types ───────────────────────────────────────────────────────── */
type MissionNodeType =
  | "trigger"
  | "input"
  | "assistant"
  | "capability"
  | "condition"
  | "approval"
  | "action"
  | "output";

type NodeRunStatus = "idle" | "pending" | "running" | "waiting" | "completed" | "failed" | "skipped";

type MissionNode = {
  id: string;
  type: MissionNodeType;
  title: string;
  subtitle: string;
  color: string;
  x: number;
  y: number;
  assistantId?: "litt" | "spark";
  capabilityKey?: string;
  config: Record<string, string | number | boolean>;
  status?: NodeRunStatus;
};

type MissionEdge = { id: string; from: string; to: string };

type LibraryCategory = {
  label: string;
  items: LibraryItem[];
};

type LibraryItem = {
  type: MissionNodeType;
  title: string;
  subtitle: string;
  color: string;
  icon: typeof Bot;
  assistantId?: "litt" | "spark";
  capabilityKey?: string;
  keywords?: string[];
};

type InstalledCap = {
  id: string;
  enabled: boolean;
  capability_key: string;
  name: string;
  icon: string;
  status: string;
  required_connections: string[];
  compatible_assistants: string[];
};

/* ─── Constants ───────────────────────────────────────────────────── */
const NODE_WIDTH = 184;
const NODE_HEIGHT = 92;
const STORAGE_KEY = "litlabs-mission-forge-v1";

const STARTER_NODES: MissionNode[] = [
  { id: "brief", type: "input", title: "Mission brief", subtitle: "Your goal and constraints", color: "#65f4ff", x: 54, y: 118, config: {} },
  { id: "litt", type: "assistant", title: "LiTT", subtitle: "Plans, builds, and directs", color: "#a8ff2f", x: 306, y: 76, assistantId: "litt", config: { mode: "plan_and_coordinate", model: "auto", approval: "before_writes" } },
  { id: "spark", type: "assistant", title: "Spark", subtitle: "Explores creative directions", color: "#a970ff", x: 306, y: 232, assistantId: "spark", config: { mode: "creative", model: "auto" } },
  { id: "approval", type: "approval", title: "Approval gate", subtitle: "You review before shipping", color: "#ffca5c", x: 558, y: 154, config: { approval_type: "user_approval" } },
];

const STARTER_EDGES: MissionEdge[] = [
  { id: "brief-litt", from: "brief", to: "litt" },
  { id: "brief-spark", from: "brief", to: "spark" },
  { id: "litt-approval", from: "litt", to: "approval" },
  { id: "spark-approval", from: "spark", to: "approval" },
];

/* Static library items (triggers, inputs, logic, approvals, actions, outputs) */
const STATIC_LIBRARY: LibraryCategory[] = [
  {
    label: "Start",
    items: [
      { type: "trigger", title: "Manual Start", subtitle: "Click to run", color: "#fbbf24", icon: Play, keywords: ["manual", "start", "run", "trigger"] },
      { type: "trigger", title: "Webhook", subtitle: "HTTP endpoint trigger", color: "#fbbf24", icon: Webhook, keywords: ["webhook", "http", "api", "endpoint", "post", "request"] },
      { type: "trigger", title: "Schedule", subtitle: "Cron-based scheduler", color: "#fbbf24", icon: Clock3, keywords: ["cron", "schedule", "hourly", "daily", "weekly", "timer", "interval"] },
    ],
  },
  {
    label: "Inputs",
    items: [
      { type: "input", title: "Mission Brief", subtitle: "Goal + context", color: "#65f4ff", icon: Target, keywords: ["brief", "mission", "goal", "input", "context"] },
      { type: "input", title: "File", subtitle: "Upload a file", color: "#65f4ff", icon: FileJson, keywords: ["file", "upload", "input"] },
      { type: "input", title: "Repository", subtitle: "Connect a repo", color: "#65f4ff", icon: Code2, keywords: ["repo", "repository", "github", "code", "input"] },
    ],
  },
  {
    label: "Assistants",
    items: [
      { type: "assistant", title: "LiTT", subtitle: "Copilot + builder", color: "#a8ff2f", icon: Brain, assistantId: "litt", keywords: ["litt", "ai", "agent", "code", "build", "plan"] },
      { type: "assistant", title: "Spark", subtitle: "Creative explorer", color: "#a970ff", icon: Sparkles, assistantId: "spark", keywords: ["spark", "creative", "image", "brand", "writing"] },
    ],
  },
  {
    label: "Logic",
    items: [
      { type: "condition", title: "Condition", subtitle: "If / else branch", color: "#60a5fa", icon: Network, keywords: ["if", "else", "condition", "branch", "logic"] },
    ],
  },
  {
    label: "Approvals",
    items: [
      { type: "approval", title: "User Approval", subtitle: "Pause for your review", color: "#ffca5c", icon: CheckCircle2, keywords: ["approval", "review", "pause", "gate", "user"] },
      { type: "approval", title: "Review Changes", subtitle: "Review code changes", color: "#ffca5c", icon: CheckCircle2, keywords: ["review", "changes", "code", "diff", "approval"] },
    ],
  },
  {
    label: "Actions",
    items: [
      { type: "action", title: "Write File", subtitle: "Write to workspace", color: "#34d399", icon: FileJson, keywords: ["write", "file", "save", "action"] },
      { type: "action", title: "Run Command", subtitle: "Execute shell command", color: "#34d399", icon: Zap, keywords: ["run", "command", "shell", "terminal", "exec"] },
      { type: "action", title: "Database Insert", subtitle: "Save to database", color: "#34d399", icon: Database, keywords: ["database", "db", "sql", "save", "store", "insert"] },
      { type: "action", title: "Send Email", subtitle: "Email notification", color: "#34d399", icon: Mail, keywords: ["email", "mail", "smtp", "send", "notify"] },
      { type: "action", title: "Discord Message", subtitle: "Post to Discord", color: "#34d399", icon: MessageSquare, keywords: ["discord", "notify", "alert", "channel", "message"] },
    ],
  },
  {
    label: "Outputs",
    items: [
      { type: "output", title: "Save Artifact", subtitle: "Store result", color: "#a8ff2f", icon: Package, keywords: ["save", "artifact", "store", "output"] },
      { type: "output", title: "Ship Result", subtitle: "Deploy or publish", color: "#a8ff2f", icon: Zap, keywords: ["ship", "deploy", "publish", "output", "result"] },
      { type: "output", title: "Notify User", subtitle: "Send notification", color: "#a8ff2f", icon: MessageSquare, keywords: ["notify", "notification", "alert", "output"] },
    ],
  },
];

/* Capability display names from registry */
const CAP_DISPLAY: Record<string, { title: string; icon: typeof Bot }> = {
  "github.code_review": { title: "Code Review", icon: Code2 },
  "github.repository_search": { title: "Repository Search", icon: Search },
  "workflow.build_test": { title: "Build and Test", icon: Zap },
  "workflow.landing_page": { title: "Landing Page", icon: Globe },
  "content.social_plan": { title: "Social Content Planner", icon: MessageSquare },
  "creative.brand_kit": { title: "Brand Kit", icon: Sparkles },
  "content.copy_edit": { title: "Writing Polish", icon: Brain },
  "vercel.deploy": { title: "Deploy to Vercel", icon: Zap },
  "supabase.schema_assist": { title: "Schema Assist", icon: Database },
};

function defaultConfig(title: string): Record<string, string | number | boolean> {
  switch (title) {
    case "Webhook":
      return { endpoint: "/api/v1/ingest", method: "POST", headers: "Content-Type: application/json" };
    case "Schedule":
      return { preset: "hourly", cron: "0 * * * *" };
    case "Database Insert":
      return { table: "mission_output", cluster: "primary" };
    case "Send Email":
      return { to: "", subject: "Mission Alert", body: "Mission finished execution." };
    case "Discord Message":
      return { webhook_url: "", message_template: "Mission completed: {{status}}" };
    case "LiTT":
      return { mode: "plan_and_coordinate", model: "auto", approval: "before_writes" };
    case "Spark":
      return { mode: "creative", model: "auto" };
    default:
      return {};
  }
}

function toYAML(nodes: MissionNode[], edges: MissionEdge[], name: string): string {
  const lines: string[] = [
    "# LiTTree-LabStudios Mission Forge",
    `# Generated: ${new Date().toISOString()}`,
    "",
    'version: "1.0"',
    `name: "${name.toLowerCase().replace(/\s+/g, "_")}"`,
    `nodes: ${nodes.length}`,
    `edges: ${edges.length}`,
    "",
    "workflow:",
  ];
  nodes.forEach((n, i) => {
    lines.push(
      `  - id: ${n.id}`,
      `    type: ${n.type}`,
      `    title: "${n.title}"`,
    );
    if (n.assistantId) lines.push(`    assistant: ${n.assistantId}`);
    if (n.capabilityKey) lines.push(`    capability: ${n.capabilityKey}`);
    if (Object.keys(n.config).length) {
      lines.push("    config:");
      Object.entries(n.config).forEach(([k, v]) => {
        const val = typeof v === "string" ? `"${v.replace(/"/g, '\\"')}"` : String(v);
        lines.push(`      ${k}: ${val}`);
      });
    }
    if (i < nodes.length - 1) lines.push("");
  });
  lines.push("", "edges:");
  edges.forEach((e) => {
    lines.push(`  - from: ${e.from} → to: ${e.to}`);
  });
  return lines.join("\n");
}

function nodeIcon(node: MissionNode): typeof Bot {
  if (node.assistantId === "litt") return Brain;
  if (node.assistantId === "spark") return Sparkles;
  if (node.capabilityKey && CAP_DISPLAY[node.capabilityKey]) return CAP_DISPLAY[node.capabilityKey].icon;
  if (node.type === "trigger") return Zap;
  if (node.type === "input") return Target;
  if (node.type === "approval") return CheckCircle2;
  if (node.type === "output") return Package;
  if (node.type === "condition") return Network;
  if (node.type === "action") return Database;
  return Bot;
}

/* ─── Component ───────────────────────────────────────────────────── */
export default function MissionForge() {
  const { resolvedColors: T } = useTheme();
  const { userId } = useClerkAuth();
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeIdCounter = useRef(0);
  const panRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);

  const [nodes, setNodes] = useState<MissionNode[]>(STARTER_NODES);
  const [edges, setEdges] = useState<MissionEdge[]>(STARTER_EDGES);
  const [selectedId, setSelectedId] = useState<string>("litt");
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [missionName, setMissionName] = useState("Launch a new creative project");
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState("");
  const [showYaml, setShowYaml] = useState(false);
  const [yamlCopied, setYamlCopied] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotPrompt, setCopilotPrompt] = useState("");
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>(["[SYS] Mission Forge initialized.", "[SYS] Ready to build."]);
  const [installedCaps, setInstalledCaps] = useState<InstalledCap[]>([]);
  const [, setCapsLoading] = useState(false);
  const [mobileSheet, setMobileSheet] = useState<"library" | "inspector" | "copilot" | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  /* Load installed capabilities from Marketplace */
  useEffect(() => {
    if (!userId) return;
    setCapsLoading(true);
    fetch("/api/marketplace/installations")
      .then((r) => r.json())
      .then((data: { installations?: Array<{ id: string; enabled: boolean; marketplace_items?: { capability_key: string; name: string; icon: string; status: string; required_connections: string[]; compatible_assistants: string[] } }> }) => {
        if (data.installations) {
          const caps: InstalledCap[] = data.installations.map((inst) => ({
            id: inst.id,
            enabled: inst.enabled,
            capability_key: inst.marketplace_items?.capability_key ?? "",
            name: inst.marketplace_items?.name ?? "Unknown",
            icon: inst.marketplace_items?.icon ?? "📦",
            status: inst.marketplace_items?.status ?? "available",
            required_connections: inst.marketplace_items?.required_connections ?? [],
            compatible_assistants: inst.marketplace_items?.compatible_assistants ?? [],
          }));
          setInstalledCaps(caps);
        }
      })
      .catch(() => {})
      .finally(() => setCapsLoading(false));
  }, [userId]);

  /* Load draft from localStorage */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { nodes?: MissionNode[]; edges?: MissionEdge[]; missionName?: string };
        if (parsed.nodes?.length) setNodes(parsed.nodes);
        if (parsed.edges) setEdges(parsed.edges);
        if (parsed.missionName) setMissionName(parsed.missionName);
      }
    } catch {}
    setHydrated(true);
  }, []);

  /* Save draft to localStorage */
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges, missionName }));
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [nodes, edges, missionName, hydrated]);

  /* Build dynamic capability library items — memoized so reference is stable across renders */
  const capabilityLibrary = useMemo<LibraryCategory>(() => ({
    label: "Installed Capabilities",
    items: installedCaps
      .filter((c) => c.enabled)
      .map((c) => {
        const capDef = CAPABILITY_REGISTRY[c.capability_key];
        const display = CAP_DISPLAY[c.capability_key];
        const assistant = capDef?.assistant === "spark" ? "spark" : capDef?.assistant === "litt" ? "litt" : undefined;
        return {
          type: "capability" as MissionNodeType,
          title: display?.title ?? c.name,
          subtitle: capDef?.requiredConnections?.length ? `Needs: ${capDef.requiredConnections.join(", ")}` : "Ready",
          color: assistant === "spark" ? "#a970ff" : "#22d3ee",
          icon: display?.icon ?? Package,
          capabilityKey: c.capability_key,
          assistantId: assistant,
          keywords: [c.capability_key, c.name],
        };
      }),
  }), [installedCaps]);

  const allLibraryCategories = useMemo(() => [...STATIC_LIBRARY, capabilityLibrary], [capabilityLibrary]);

  const filteredCategories = useMemo(() => {
    if (!libraryFilter.trim()) return allLibraryCategories;
    const q = libraryFilter.toLowerCase();
    return allLibraryCategories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (i) =>
            i.title.toLowerCase().includes(q) ||
            i.subtitle.toLowerCase().includes(q) ||
            i.keywords?.some((k) => k.includes(q)),
        ),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [allLibraryCategories, libraryFilter]);

  /* Node operations */
  const addNode = (item: LibraryItem) => {
    nodeIdCounter.current += 1;
    const node: MissionNode = {
      id: `${item.type}-${Date.now()}`,
      type: item.type,
      title: item.title,
      subtitle: item.subtitle,
      color: item.color,
      x: 70 + (nodes.length % 3) * 220,
      y: 80 + Math.floor(nodes.length / 3) * 120,
      assistantId: item.assistantId,
      capabilityKey: item.capabilityKey,
      config: defaultConfig(item.title),
    };
    setNodes((prev) => [...prev, node]);
    setSelectedId(node.id);
    setMobileSheet(null);
  };

  const canvasPoint = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      x: Math.max(12, (clientX - (rect?.left ?? 0) - viewport.x) / viewport.scale - NODE_WIDTH / 2),
      y: Math.max(12, (clientY - (rect?.top ?? 0) - viewport.y) / viewport.scale - NODE_HEIGHT / 2),
    };
  };

  const canvasBounds = useMemo(() => ({
    width: Math.max(1400, ...nodes.map((node) => node.x + NODE_WIDTH + 240)),
    height: Math.max(900, ...nodes.map((node) => node.y + NODE_HEIGHT + 240)),
  }), [nodes]);

  const zoomCanvas = useCallback((nextScale: number, clientX?: number, clientY?: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    setViewport((current) => {
      const scale = Math.min(2, Math.max(0.35, nextScale));
      const anchorX = clientX == null ? (rect?.width ?? 0) / 2 : clientX - (rect?.left ?? 0);
      const anchorY = clientY == null ? (rect?.height ?? 0) / 2 : clientY - (rect?.top ?? 0);
      const worldX = (anchorX - current.x) / current.scale;
      const worldY = (anchorY - current.y) / current.scale;
      return { x: anchorX - worldX * scale, y: anchorY - worldY * scale, scale };
    });
  }, []);

  const fitCanvas = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || nodes.length === 0) {
      setViewport({ x: 0, y: 0, scale: 1 });
      return;
    }
    const minX = Math.min(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxX = Math.max(...nodes.map((node) => node.x + NODE_WIDTH));
    const maxY = Math.max(...nodes.map((node) => node.y + NODE_HEIGHT));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const scale = Math.min(1.35, Math.max(0.35, Math.min((rect.width - 96) / width, (rect.height - 96) / height)));
    setViewport({
      x: (rect.width - width * scale) / 2 - minX * scale,
      y: (rect.height - height * scale) / 2 - minY * scale,
      scale,
    });
  }, [nodes]);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const point = canvasPoint(e.clientX, e.clientY);
    const moveId = e.dataTransfer.getData("application/x-mission-node");
    if (moveId) {
      setNodes((prev) => prev.map((n) => (n.id === moveId ? { ...n, ...point } : n)));
      return;
    }
    const paletteIndex = Number(e.dataTransfer.getData("application/x-mission-palette"));
    const flat = allLibraryCategories.flatMap((c) => c.items);
    const item = flat[paletteIndex];
    if (!item) return;
    const node: MissionNode = {
      id: `${item.type}-${Date.now()}`,
      type: item.type,
      title: item.title,
      subtitle: item.subtitle,
      color: item.color,
      assistantId: item.assistantId,
      capabilityKey: item.capabilityKey,
      config: defaultConfig(item.title),
      ...point,
    };
    setNodes((prev) => [...prev, node]);
    setSelectedId(node.id);
  };

  const selectNode = (node: MissionNode) => {
    if (connectingFrom && connectingFrom !== node.id) {
      const dup = edges.some((e) => e.from === connectingFrom && e.to === node.id);
      if (!dup) {
        setEdges((prev) => [...prev, { id: `${connectingFrom}-${node.id}-${Date.now()}`, from: connectingFrom, to: node.id }]);
      }
      setConnectingFrom(null);
    }
    setSelectedId(node.id);
  };

  const updateSelected = (patch: Partial<MissionNode>) => {
    if (!selectedId) return;
    setNodes((prev) => prev.map((n) => (n.id === selectedId ? { ...n, ...patch } : n)));
  };

  const updateConfig = (field: string, value: string | number | boolean) => {
    if (!selectedId) return;
    setNodes((prev) => prev.map((n) => (n.id === selectedId ? { ...n, config: { ...n.config, [field]: value } } : n)));
  };

  const removeSelected = () => {
    if (!selectedId) return;
    setNodes((prev) => prev.filter((n) => n.id !== selectedId));
    setEdges((prev) => prev.filter((e) => e.from !== selectedId && e.to !== selectedId));
    setSelectedId("");
    setConnectingFrom(null);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const copy: MissionNode = {
      ...selected,
      id: `${selected.type}-${Date.now()}`,
      title: `${selected.title} copy`,
      x: selected.x + 34,
      y: selected.y + 34,
    };
    setNodes((prev) => [...prev, copy]);
    setSelectedId(copy.id);
  };

  const removeEdge = (edgeId: string) => {
    setEdges((prev) => prev.filter((e) => e.id !== edgeId));
  };

  /* Keyboard shortcuts */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable;
      if (editing) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        removeSelected();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && selected) {
        e.preventDefault();
        duplicateSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  /* Save / Reset / Run */
  const saveFlow = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges, missionName }));
    } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const resetFlow = () => {
    setNodes(STARTER_NODES);
    setEdges(STARTER_EDGES);
    setSelectedId("litt");
    setConnectingFrom(null);
  };

  const log = useCallback((msg: string) => {
    const ts = new Date().toISOString().split("T")[1].slice(0, 8);
    setLogs((prev) => [...prev, `[${ts}] ${msg}`]);
  }, []);

  const runWorkflow = async () => {
    if (running || nodes.length < 2 || missionName.trim().length < 4) return;
    const hasTrigger = nodes.some((n) => n.type === "trigger" || n.type === "input");
    if (!hasTrigger) {
      log("[ERR] No start node found. Add a trigger or input.");
      return;
    }
    const hasOutput = nodes.some((n) => n.type === "output");
    if (!hasOutput) {
      log("[WRN] No output node detected. Results may not be saved.");
    }
    setRunning(true);
    log("[EXEC] Starting mission execution...");
    setNodes((prev) => prev.map((n) => ({ ...n, status: "pending" as NodeRunStatus })));

    /* Topological-ish execution: process nodes in order */
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, status: "running" as NodeRunStatus } : n)));
      log(`[RUN] ${node.type}/${node.title}`);

      if (node.type === "approval") {
        setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, status: "waiting" as NodeRunStatus } : n)));
        log(`[WAIT] Approval required: ${node.title}`);
        /* In real implementation, this would pause and wait for user action */
        await new Promise((r) => setTimeout(r, 800));
        log(`[OK] Auto-approved in draft mode (real runs require user action)`);
      }

      await new Promise((r) => setTimeout(r, 400));
      setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, status: "completed" as NodeRunStatus } : n)));
      log(`[OK] ${node.title} completed`);
    }

    log("[SYS] Mission execution completed.");
    setRunning(false);
  };

  /* Copilot: natural language workflow creation */
  const handleCopilot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!copilotPrompt.trim()) return;
    const prompt = copilotPrompt;
    setCopilotPrompt("");
    setCopilotLoading(true);
    log(`[AI] Interpreting: "${prompt}"`);

    const lowered = prompt.toLowerCase();
    const detected: LibraryItem[] = [];

    /* Always start with a brief */
    detected.push(STATIC_LIBRARY[1].items[0]); /* Mission Brief */

    /* Detect triggers */
    if (lowered.match(/webhook|http|endpoint|api|post|request/)) detected.push(STATIC_LIBRARY[0].items[1]);
    if (lowered.match(/cron|schedule|hourly|daily|weekly|timer|interval/)) detected.push(STATIC_LIBRARY[0].items[2]);
    if (lowered.match(/push|pull request|pr|github/)) detected.push(STATIC_LIBRARY[0].items[0]); /* Manual start for now */

    /* Detect assistants */
    if (lowered.match(/image|visual|brand|creative|music|social|content|writing|caption/)) {
      detected.push(STATIC_LIBRARY[2].items[1]); /* Spark */
    }
    detected.push(STATIC_LIBRARY[2].items[0]); /* LiTT always */

    /* Detect capabilities */
    if (lowered.match(/review|code review|pull request/)) {
      detected.push({ type: "capability", title: "Code Review", subtitle: "Needs: github", color: "#22d3ee", icon: Code2, capabilityKey: "github.code_review" });
    }
    if (lowered.match(/build|test|deploy/)) {
      detected.push({ type: "capability", title: "Build and Test", subtitle: "Needs: terminal", color: "#22d3ee", icon: Zap, capabilityKey: "workflow.build_test" });
    }
    if (lowered.match(/social|campaign|post/)) {
      detected.push({ type: "capability", title: "Social Content Planner", subtitle: "Ready", color: "#a970ff", icon: MessageSquare, capabilityKey: "content.social_plan" });
    }
    if (lowered.match(/research|web|find/)) {
      detected.push({ type: "capability", title: "Landing Page", subtitle: "Ready", color: "#22d3ee", icon: Globe, capabilityKey: "workflow.landing_page" });
    }

    /* Detect actions */
    if (lowered.match(/database|db|sql|save|store|persist/)) detected.push(STATIC_LIBRARY[5].items[2]);
    if (lowered.match(/discord|notify|alert|channel|message/)) detected.push(STATIC_LIBRARY[5].items[4]);
    if (lowered.match(/email|mail|smtp/)) detected.push(STATIC_LIBRARY[5].items[3]);

    /* Always end with approval + output */
    detected.push(STATIC_LIBRARY[4].items[0]); /* User Approval */
    detected.push(STATIC_LIBRARY[6].items[1]); /* Ship Result */

    /* Try Gemini for smarter assembly */
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Build a mission workflow for: "${prompt}". Reply ONLY with a JSON array of node objects [{"type":"trigger|input|assistant|capability|condition|approval|action|output","title":"...","subtitle":"...","assistantId":"litt|spark","capabilityKey":"..."}]. Use only "litt" or "spark" for assistantId. Do not use "Logic Orchestrator" or "Task Champion".`,
          systemPrompt: "You are a mission architect. Output ONLY valid JSON arrays. No explanations. Only use assistantId values 'litt' or 'spark'.",
        }),
      });
      const data = await res.json();
      const raw = data.response?.match(/\[[\s\S]*\]/)?.[0];
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const geminiNodes: MissionNode[] = parsed.map((n: Record<string, unknown>, i: number) => {
            const type = n.type as MissionNodeType;
            const title = (n.title as string) || "Node";
            const capKey = n.capabilityKey as string | undefined;
            return {
              id: `${type}-${Date.now() + i}`,
              type,
              title,
              subtitle: (n.subtitle as string) || "",
              color: n.assistantId === "spark" ? "#a970ff" : type === "trigger" ? "#fbbf24" : type === "input" ? "#65f4ff" : type === "approval" ? "#ffca5c" : type === "output" ? "#a8ff2f" : type === "capability" ? "#22d3ee" : "#34d399",
              x: 70 + (i % 3) * 220,
              y: 80 + Math.floor(i / 3) * 120,
              assistantId: n.assistantId as "litt" | "spark" | undefined,
              capabilityKey: capKey,
              config: defaultConfig(title),
            };
          });
          /* Auto-connect nodes in sequence */
          const geminiEdges: MissionEdge[] = [];
          for (let i = 0; i < geminiNodes.length - 1; i++) {
            geminiEdges.push({ id: `${geminiNodes[i].id}-${geminiNodes[i + 1].id}`, from: geminiNodes[i].id, to: geminiNodes[i + 1].id });
          }
          setNodes(geminiNodes);
          setEdges(geminiEdges);
          setSelectedId(geminiNodes[0]?.id ?? "");
          log(`[OK] LiTT created ${geminiNodes.length}-node mission draft. Review before running.`);
          setCopilotLoading(false);
          return;
        }
      }
    } catch {
      /* fall through to local */
    }

    /* Local fallback */
    const builtNodes: MissionNode[] = detected.map((item, i) => ({
      id: `${item.type}-${Date.now() + i}`,
      type: item.type,
      title: item.title,
      subtitle: item.subtitle,
      color: item.color,
      x: 70 + (i % 3) * 220,
      y: 80 + Math.floor(i / 3) * 120,
      assistantId: item.assistantId,
      capabilityKey: item.capabilityKey,
      config: defaultConfig(item.title),
    }));
    const builtEdges: MissionEdge[] = [];
    for (let i = 0; i < builtNodes.length - 1; i++) {
      builtEdges.push({ id: `${builtNodes[i].id}-${builtNodes[i + 1].id}`, from: builtNodes[i].id, to: builtNodes[i + 1].id });
    }
    setNodes(builtNodes);
    setEdges(builtEdges);
    setSelectedId(builtNodes[0]?.id ?? "");
    log(`[OK] Created ${builtNodes.length}-node mission draft from keywords. Review before running.`);
    setCopilotLoading(false);
  };

  const yaml = toYAML(nodes, edges, missionName);
  const copyYaml = async () => {
    await navigator.clipboard.writeText(yaml);
    setYamlCopied(true);
    setTimeout(() => setYamlCopied(false), 2000);
  };

  /* Status colors */
  const statusColor = (status?: NodeRunStatus) => {
    switch (status) {
      case "running": return "#22d3ee";
      case "completed": return "#34d399";
      case "failed": return "#fb7185";
      case "waiting": return "#ffca5c";
      case "skipped": return "#94a3b8";
      default: return "#64748b";
    }
  };

  /* ── Render ── */
  return (
    <div className="flex h-full overflow-hidden bg-[#03050a] text-white">
      {/* ── LEFT: Node Library (desktop) ── */}
      <aside
        className="hidden md:flex w-[260px] shrink-0 flex-col border-r"
        style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "90" }}
      >
        <div className="px-3 py-3 border-b" style={{ borderColor: T.borderColor + "15" }}>
          <div className="flex items-center gap-2">
            <Workflow size={14} style={{ color: T.accentColor }} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.accentColor }}>
              Mission Forge
            </span>
          </div>
          <p className="text-[9px] mt-1 opacity-50" style={{ color: T.textMuted }}>
            Build reusable Missions by connecting LiTT, Spark, tools, approvals, and outputs.
          </p>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30` }}>
            <Search size={12} className="shrink-0" style={{ color: T.textMuted }} />
            <input
              value={libraryFilter}
              onChange={(e) => setLibraryFilter(e.target.value)}
              placeholder="Filter nodes..."
              className="bg-transparent text-[10px] outline-none w-full"
              style={{ color: T.textColor }}
            />
            {libraryFilter && (
              <button onClick={() => setLibraryFilter("")} style={{ color: T.textMuted }}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Library categories */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {filteredCategories.map((cat) => (
            <div key={cat.label} className="space-y-1.5">
              <div className="text-[8px] font-bold uppercase tracking-widest px-1 opacity-40" style={{ color: T.textMuted }}>
                {cat.label}
              </div>
              {cat.items.map((item, idx) => {
                const Icon = item.icon;
                const capDef = item.capabilityKey ? CAPABILITY_REGISTRY[item.capabilityKey] : undefined;
                const isUnavailable = capDef?.status === "unavailable";
                return (
                  <div
                    key={`${cat.label}-${item.title}-${idx}`}
                    draggable
                    role="button"
                    tabIndex={0}
                    onClick={() => addNode(item)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addNode(item); } }}
                    onDragStart={(e) => {
                      const flat = allLibraryCategories.flatMap((c) => c.items);
                      const flatIndex = flat.indexOf(item);
                      e.dataTransfer.setData("application/x-mission-palette", String(flatIndex));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="group flex items-center gap-2 rounded-lg p-2 cursor-grab transition-all hover:scale-[1.02] active:cursor-grabbing"
                    style={{
                      background: isUnavailable ? "rgba(255,0,0,0.04)" : `${item.color}08`,
                      border: `1px solid ${isUnavailable ? "rgba(255,100,100,0.15)" : `${item.color}25`}`,
                      opacity: isUnavailable ? 0.5 : 1,
                    }}
                    title={isUnavailable ? "Unavailable — requires setup" : `Click or drag to add ${item.title}`}
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded" style={{ borderColor: `${item.color}35`, backgroundColor: `${item.color}12`, color: item.color, border: `1px solid ${item.color}35` }}>
                      <Icon size={11} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold truncate" style={{ color: T.textColor }}>{item.title}</div>
                      <div className="text-[8px] truncate" style={{ color: T.textMuted }}>{item.subtitle}</div>
                    </div>
                    {isUnavailable && <span className="text-[7px] font-bold uppercase" style={{ color: "#fb7185" }}>Setup</span>}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Manage capabilities link */}
          <Link
            href="/marketplace"
            className="flex items-center gap-2 px-2 py-2 rounded-lg text-[10px] transition-all hover:opacity-80"
            style={{ color: T.textMuted, border: `1px solid ${T.borderColor}20` }}
          >
            <Package size={12} style={{ color: T.accentColor }} />
            <span>Manage capabilities</span>
            <ChevronRight size={9} className="ml-auto opacity-30" />
          </Link>
        </div>
      </aside>

      {/* ── CENTER: Canvas ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-12 border-b shrink-0" style={{ borderColor: T.borderColor + "15", backgroundColor: T.boxBg + "50" }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="grid h-7 w-7 place-items-center rounded-lg border" style={{ borderColor: "#a8ff2f30", backgroundColor: "#a8ff2f10", color: "#a8ff2f" }}>
              <Workflow size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold truncate" style={{ color: T.textColor }}>Mission Forge</div>
              <div className="text-[9px] opacity-50 truncate" style={{ color: T.textMuted }}>{nodes.length} blocks · {edges.length} links</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              value={missionName}
              onChange={(e) => setMissionName(e.target.value)}
              className="hidden sm:block bg-transparent text-[10px] font-bold outline-none w-40 truncate"
              style={{ color: T.textColor }}
              placeholder="Mission name..."
            />
            <button onClick={saveFlow} className="flex items-center gap-1 text-[9px] px-2 py-1 rounded border transition-all hover:opacity-80" style={{ borderColor: T.borderColor + "20", color: T.textMuted }}>
              <Save size={10} /> {saved ? "Saved" : "Save"}
            </button>
            <button onClick={resetFlow} className="flex items-center gap-1 text-[9px] px-2 py-1 rounded border transition-all hover:opacity-80" style={{ borderColor: T.borderColor + "20", color: T.textMuted }}>
              <RefreshCw size={10} /> Reset
            </button>
            <button
              onClick={() => void runWorkflow()}
              disabled={running || nodes.length < 2}
              className="flex items-center gap-1 text-[9px] px-3 py-1 rounded font-bold transition-all disabled:opacity-40"
              style={{ backgroundColor: "#a8ff2f", color: "#03050a" }}
            >
              {running ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} fill="currentColor" />} Run
            </button>
            <button
              onClick={() => setShowYaml(true)}
              className="flex items-center gap-1 text-[9px] px-2 py-1 rounded border transition-all hover:opacity-80"
              style={{ borderColor: T.borderColor + "20", color: T.textMuted }}
            >
              <FileJson size={10} /> YAML
            </button>
            {/* Mobile buttons */}
            <button onClick={() => setMobileSheet("library")} className="md:hidden p-1 rounded border" style={{ borderColor: T.borderColor + "20", color: T.textMuted }}>
              <Plus size={12} />
            </button>
            <button onClick={() => setMobileSheet("inspector")} className="md:hidden p-1 rounded border" style={{ borderColor: T.borderColor + "20", color: T.textMuted }}>
              <Settings size={12} />
            </button>
            <button onClick={() => setCopilotOpen(true)} className="p-1 rounded border transition-all hover:opacity-80" style={{ borderColor: "#a8ff2f30", color: "#a8ff2f" }}>
              <Brain size={12} />
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes("application/x-mission-node") ? "move" : "copy"; }}
          onDrop={handleDrop}
          onWheel={(e) => {
            e.preventDefault();
            zoomCanvas(viewport.scale * (e.deltaY > 0 ? 0.9 : 1.1), e.clientX, e.clientY);
          }}
          onPointerDown={(e) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest("button,input,textarea,select,a")) return;
            panRef.current = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, x: viewport.x, y: viewport.y };
            e.currentTarget.setPointerCapture(e.pointerId);
            setIsPanning(true);
          }}
          onPointerMove={(e) => {
            const pan = panRef.current;
            if (!pan || pan.pointerId !== e.pointerId) return;
            setViewport((current) => ({ ...current, x: pan.x + e.clientX - pan.clientX, y: pan.y + e.clientY - pan.clientY }));
          }}
          onPointerUp={(e) => {
            if (panRef.current?.pointerId === e.pointerId) {
              panRef.current = null;
              setIsPanning(false);
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onDoubleClick={fitCanvas}
          className={`relative flex-1 overflow-hidden touch-none ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
          style={{
            backgroundImage:
              "linear-gradient(105deg,rgba(3,5,11,.96),rgba(3,5,11,.72) 48%,rgba(3,5,11,.88)),url('/wallpapers/litt-afterglow.webp')",
          }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_48%_30%,rgba(101,244,255,.08),transparent_32%),radial-gradient(circle_at_78%_68%,rgba(169,112,255,.09),transparent_30%)]" />

          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: canvasBounds.width, height: canvasBounds.height, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
          >
          {/* SVG edges */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            <defs>
              <linearGradient id="mission-line" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#65f4ff" stopOpacity=".65" />
                <stop offset="100%" stopColor="#a970ff" stopOpacity=".75" />
              </linearGradient>
            </defs>
            {edges.map((edge) => {
              const from = nodes.find((n) => n.id === edge.from);
              const to = nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              const x1 = from.x + NODE_WIDTH;
              const y1 = from.y + NODE_HEIGHT / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_HEIGHT / 2;
              const bend = Math.max(60, Math.abs(x2 - x1) * 0.45);
              return (
                <g key={edge.id}>
                  <path d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} fill="none" stroke="url(#mission-line)" strokeWidth="2" strokeDasharray="6 6" />
                  <circle cx={x2} cy={y2} r="3" fill="#a970ff" opacity="0.6" />
                </g>
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map((node) => {
            const Icon = nodeIcon(node);
            const isSelected = node.id === selectedId;
            const isConnecting = node.id === connectingFrom;
            const sColor = statusColor(node.status);
            return (
              <button
                key={node.id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("application/x-mission-node", node.id); e.dataTransfer.effectAllowed = "move"; }}
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
                    {node.assistantId ? (
                      <Image src={node.assistantId === "spark" ? "/brand/spark-agent-hero-v2.png" : "/brand/litt-agent-hero-v2.png"} alt="" fill className="object-cover" />
                    ) : (
                      <Icon size={16} />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-black">{node.title}</span>
                    <span className="mt-1 block line-clamp-2 text-[9px] leading-3 text-white/40">{node.subtitle}</span>
                  </span>
                </span>
                <span className="absolute bottom-2 right-3 text-[7px] font-black uppercase tracking-widest" style={{ color: node.color }}>{node.type}</span>
                {node.status && node.status !== "idle" && (
                  <span className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full border-2 border-[#03050a]" style={{ backgroundColor: sColor, boxShadow: `0 0 6px ${sColor}` }} />
                )}
              </button>
            );
          })}

          {nodes.length === 0 && (
            <div className="absolute inset-0 grid place-items-center p-8 text-center">
              <div>
                <Workflow size={34} className="mx-auto text-white/15" />
                <h3 className="mt-3 text-sm font-black">Your Mission Forge is empty</h3>
                <p className="mt-1 text-[10px] text-white/35">Drag LiTT, Spark, triggers, and capabilities here to begin.</p>
              </div>
            </div>
          )}
          </div>

          <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-xl border p-1 shadow-2xl backdrop-blur-xl" style={{ backgroundColor: `${T.boxBg}e8`, borderColor: `${T.borderColor}35` }}>
            <button onClick={() => zoomCanvas(viewport.scale / 1.15)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10" title="Zoom out"><Minus size={14} /></button>
            <button onClick={() => setViewport((current) => ({ ...current, scale: 1 }))} className="min-w-[54px] rounded-lg px-2 py-2 text-[9px] font-black hover:bg-white/10" title="Reset zoom">{Math.round(viewport.scale * 100)}%</button>
            <button onClick={() => zoomCanvas(viewport.scale * 1.15)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10" title="Zoom in"><Plus size={14} /></button>
            <span className="mx-1 h-5 w-px" style={{ backgroundColor: `${T.borderColor}35` }} />
            <button onClick={fitCanvas} className="flex h-8 items-center gap-1 rounded-lg px-2 text-[9px] font-bold hover:bg-white/10" title="Fit mission to canvas"><Maximize2 size={12} /> Fit</button>
            <button onClick={() => setViewport({ x: 0, y: 0, scale: 1 })} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10" title="Reset canvas"><RefreshCw size={12} /></button>
          </div>
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border px-3 py-1.5 text-[8px] font-bold backdrop-blur-xl" style={{ backgroundColor: `${T.boxBg}d8`, borderColor: `${T.borderColor}25`, color: T.textMuted }}>
            Drag empty space to move · Wheel to zoom · Double-click to fit
          </div>
        </div>

        {/* Execution log (collapsible) */}
        <div className="h-[120px] border-t shrink-0 flex flex-col" style={{ borderColor: T.borderColor + "15", backgroundColor: T.boxBg + "40" }}>
          <div className="flex items-center justify-between px-3 py-1.5 border-b shrink-0" style={{ borderColor: T.borderColor + "10" }}>
            <span className="text-[8px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>Execution Log</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setLogs(["[SYS] Log cleared."])} className="text-[8px] opacity-50 hover:opacity-100" style={{ color: T.textMuted }}>Clear</button>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: running ? "#22d3ee" : T.borderColor, boxShadow: running ? "0 0 6px #22d3ee" : "none" }} />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-1.5 font-mono text-[9px] space-y-0.5">
            {logs.map((l, i) => {
              let cls = "opacity-60";
              if (l.includes("[OK]")) cls = "text-emerald-400";
              if (l.includes("[SYS]")) cls = "text-cyan-400";
              if (l.includes("[WRN]")) cls = "text-amber-400";
              if (l.includes("[ERR]")) cls = "text-red-400";
              if (l.includes("[EXEC]")) cls = "text-white font-bold";
              if (l.includes("[AI]")) cls = "text-violet-400";
              if (l.includes("[RUN]")) cls = "text-white";
              if (l.includes("[WAIT]")) cls = "text-amber-300";
              return <div key={i} className={cls} style={{ color: cls.includes("text-") ? undefined : T.textMuted }}>{l}</div>;
            })}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Inspector (desktop) ── */}
      <aside
        className="hidden md:flex w-[320px] shrink-0 border-l flex-col"
        style={{ borderColor: T.borderColor + "15", backgroundColor: T.boxBg + "50" }}
      >
        <div className="px-3 py-3 border-b shrink-0" style={{ borderColor: T.borderColor + "15" }}>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: T.accentColor }}>Inspector</span>
              <h2 className="text-xs font-bold mt-0.5" style={{ color: T.textColor }}>{selected ? selected.title : "Select a node"}</h2>
            </div>
            <Settings size={14} style={{ color: T.textMuted }} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {selected ? (
            <div className="space-y-3">
              {/* General */}
              <div>
                <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Node Name</label>
                <input
                  value={selected.title}
                  onChange={(e) => updateSelected({ title: e.target.value })}
                  className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[11px] font-bold outline-none"
                  style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }}
                />
              </div>
              <div>
                <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Description</label>
                <textarea
                  value={selected.subtitle}
                  onChange={(e) => updateSelected({ subtitle: e.target.value })}
                  rows={2}
                  className="mt-1 w-full resize-none rounded-lg px-2.5 py-1.5 text-[10px] outline-none"
                  style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }}
                />
              </div>

              {/* Assistant config */}
              {selected.type === "assistant" && selected.assistantId && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Mode</label>
                    <select
                      value={String(selected.config.mode || "")}
                      onChange={(e) => updateConfig("mode", e.target.value)}
                      className="mt-1 w-full rounded-lg px-2 py-1.5 text-[10px] outline-none"
                      style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }}
                    >
                      {selected.assistantId === "litt" && (
                        <>
                          <option value="plan_and_coordinate">Plan and coordinate</option>
                          <option value="code">Write code</option>
                          <option value="research">Research</option>
                          <option value="review">Review and inspect</option>
                        </>
                      )}
                      {selected.assistantId === "spark" && (
                        <>
                          <option value="creative">Creative</option>
                          <option value="image">Generate image</option>
                          <option value="branding">Branding</option>
                          <option value="writing">Writing</option>
                        </>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Model</label>
                    <select
                      value={String(selected.config.model || "auto")}
                      onChange={(e) => updateConfig("model", e.target.value)}
                      className="mt-1 w-full rounded-lg px-2 py-1.5 text-[10px] outline-none"
                      style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }}
                    >
                      <option value="auto">Auto Best</option>
                      <option value="gemini">Gemini 2.5</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </div>
                  {selected.assistantId === "litt" && (
                    <div>
                      <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Approval</label>
                      <select
                        value={String(selected.config.approval || "before_writes")}
                        onChange={(e) => updateConfig("approval", e.target.value)}
                        className="mt-1 w-full rounded-lg px-2 py-1.5 text-[10px] outline-none"
                        style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }}
                      >
                        <option value="before_writes">Before writes</option>
                        <option value="before_all">Before all actions</option>
                        <option value="never">Never (autonomous)</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Trigger config */}
              {selected.type === "trigger" && selected.title === "Webhook" && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Endpoint</label>
                    <input value={String(selected.config.endpoint || "")} onChange={(e) => updateConfig("endpoint", e.target.value)} placeholder="/api/v1/ingest" className="mt-1 w-full rounded-lg px-2 py-1.5 text-[10px] outline-none" style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                  </div>
                  <div>
                    <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Method</label>
                    <div className="flex gap-1 mt-1">
                      {["GET", "POST", "PUT"].map((m) => (
                        <button key={m} onClick={() => updateConfig("method", m)} className="flex-1 py-1 text-[9px] font-bold rounded border transition-all" style={{ background: selected.config.method === m ? "#fbbf2415" : "transparent", borderColor: selected.config.method === m ? "#fbbf2440" : `${T.borderColor}20`, color: selected.config.method === m ? "#fbbf24" : T.textMuted }}>{m}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {selected.type === "trigger" && selected.title === "Schedule" && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Preset</label>
                    <div className="grid grid-cols-3 gap-1 mt-1">
                      {[{ id: "hourly", label: "Hourly", cron: "0 * * * *" }, { id: "daily", label: "Daily", cron: "0 0 * * *" }, { id: "weekly", label: "Weekly", cron: "0 0 * * 0" }].map((p) => (
                        <button key={p.id} onClick={() => { updateConfig("preset", p.id); updateConfig("cron", p.cron); }} className="py-1 text-[9px] font-bold rounded border transition-all" style={{ background: selected.config.preset === p.id ? "#fbbf2415" : "transparent", borderColor: selected.config.preset === p.id ? "#fbbf2440" : `${T.borderColor}20`, color: selected.config.preset === p.id ? "#fbbf24" : T.textMuted }}>{p.label}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Cron</label>
                    <input value={String(selected.config.cron || "")} onChange={(e) => { updateConfig("cron", e.target.value); updateConfig("preset", "custom"); }} placeholder="0 * * * *" className="mt-1 w-full rounded-lg px-2 py-1.5 text-[10px] font-mono outline-none" style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                  </div>
                </div>
              )}

              {/* Action configs */}
              {selected.type === "action" && selected.title === "Database Insert" && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Table</label>
                    <input value={String(selected.config.table || "")} onChange={(e) => updateConfig("table", e.target.value)} placeholder="mission_output" className="mt-1 w-full rounded-lg px-2 py-1.5 text-[10px] outline-none" style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                  </div>
                </div>
              )}
              {selected.type === "action" && selected.title === "Send Email" && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>To</label>
                    <input value={String(selected.config.to || "")} onChange={(e) => updateConfig("to", e.target.value)} placeholder="user@example.com" className="mt-1 w-full rounded-lg px-2 py-1.5 text-[10px] outline-none" style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                  </div>
                  <div>
                    <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Subject</label>
                    <input value={String(selected.config.subject || "")} onChange={(e) => updateConfig("subject", e.target.value)} className="mt-1 w-full rounded-lg px-2 py-1.5 text-[10px] outline-none" style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                  </div>
                  <div>
                    <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Body</label>
                    <textarea value={String(selected.config.body || "")} onChange={(e) => updateConfig("body", e.target.value)} rows={3} className="mt-1 w-full resize-none rounded-lg px-2 py-1.5 text-[10px] outline-none" style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                  </div>
                </div>
              )}
              {selected.type === "action" && selected.title === "Discord Message" && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Webhook URL</label>
                    <input value={String(selected.config.webhook_url || "")} onChange={(e) => updateConfig("webhook_url", e.target.value)} placeholder="https://discord.com/api/webhooks/..." className="mt-1 w-full rounded-lg px-2 py-1.5 text-[10px] outline-none" style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                  </div>
                  <div>
                    <label className="text-[8px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.textMuted }}>Message</label>
                    <textarea value={String(selected.config.message_template || "")} onChange={(e) => updateConfig("message_template", e.target.value)} rows={2} className="mt-1 w-full resize-none rounded-lg px-2 py-1.5 text-[10px] outline-none" style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                  </div>
                </div>
              )}

              {/* Capability info */}
              {selected.type === "capability" && selected.capabilityKey && (
                <div className="rounded-lg p-2.5 text-[9px] space-y-1" style={{ background: "rgba(0,0,0,0.25)", border: `1px solid ${T.borderColor}15` }}>
                  <div className="flex justify-between"><span style={{ color: T.textMuted }}>Capability</span><span style={{ color: selected.color }}>{selected.capabilityKey}</span></div>
                  {CAPABILITY_REGISTRY[selected.capabilityKey] && (
                    <>
                      <div className="flex justify-between"><span style={{ color: T.textMuted }}>Assistant</span><span style={{ color: T.textColor }}>{CAPABILITY_REGISTRY[selected.capabilityKey].assistant}</span></div>
                      <div className="flex justify-between"><span style={{ color: T.textMuted }}>Connections</span><span style={{ color: T.textColor }}>{CAPABILITY_REGISTRY[selected.capabilityKey].requiredConnections.join(", ") || "None"}</span></div>
                      <div className="flex justify-between"><span style={{ color: T.textMuted }}>Status</span><span style={{ color: CAPABILITY_REGISTRY[selected.capabilityKey].status === "available" ? "#34d399" : "#fb7185" }}>{CAPABILITY_REGISTRY[selected.capabilityKey].status}</span></div>
                    </>
                  )}
                </div>
              )}

              {/* Connections */}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setConnectingFrom(selected.id)} className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-[9px] font-bold transition-all" style={{ border: `1px solid ${selected.color}30`, color: selected.color, background: `${selected.color}08` }}>
                  <ArrowRight size={11} /> Connect
                </button>
                <button onClick={removeSelected} className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-[9px] font-bold transition-all" style={{ border: "1px solid rgba(251,113,133,0.2)", color: "#fb7185", background: "rgba(251,113,133,0.06)" }}>
                  <Trash2 size={11} /> Remove
                </button>
                <button onClick={duplicateSelected} className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg py-2 text-[9px] font-bold transition-all" style={{ border: `1px solid ${T.borderColor}20`, color: T.textMuted }}>
                  <Plus size={11} /> Duplicate
                </button>
              </div>

              {/* Edge info */}
              <div className="rounded-lg p-2.5 space-y-1.5 text-[9px]" style={{ background: "rgba(0,0,0,0.2)", border: `1px solid ${T.borderColor}10` }}>
                <div className="flex justify-between"><span style={{ color: T.textMuted }}>Incoming</span><span style={{ color: T.textColor }}>{edges.filter((e) => e.to === selected.id).length}</span></div>
                <div className="flex justify-between"><span style={{ color: T.textMuted }}>Outgoing</span><span style={{ color: T.textColor }}>{edges.filter((e) => e.from === selected.id).length}</span></div>
              </div>

              {/* Connected edges */}
              {edges.some((e) => e.from === selected.id || e.to === selected.id) && (
                <div>
                  <div className="text-[8px] font-bold uppercase tracking-wider opacity-40 mb-1.5" style={{ color: T.textMuted }}>Connections</div>
                  <div className="space-y-1">
                    {edges.filter((e) => e.from === selected.id || e.to === selected.id).map((edge) => {
                      const peerId = edge.from === selected.id ? edge.to : edge.from;
                      const peer = nodes.find((n) => n.id === peerId);
                      return (
                        <div key={edge.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[9px]" style={{ background: "rgba(0,0,0,0.2)", border: `1px solid ${T.borderColor}10` }}>
                          <ArrowRight size={9} style={{ color: selected.color }} />
                          <span className="flex-1 truncate" style={{ color: T.textMuted }}>{edge.from === selected.id ? "→" : "←"} {peer?.title || "Unknown"}</span>
                          <button onClick={() => removeEdge(edge.id)} className="opacity-50 hover:opacity-100" style={{ color: "#fb7185" }}><X size={10} /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-4 opacity-40">
              <Settings size={24} className="mb-2" style={{ color: T.textMuted }} />
              <p className="text-[10px]" style={{ color: T.textMuted }}>Click a node to configure it.</p>
            </div>
          )}
        </div>
      </aside>

      {/* ── Copilot Drawer ── */}
      {copilotOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={() => setCopilotOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm h-full flex flex-col" style={{ backgroundColor: T.boxBg, borderLeft: `1px solid ${T.borderColor}30` }}>
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: T.borderColor + "15" }}>
              <div className="flex items-center gap-2">
                <Brain size={14} style={{ color: "#a8ff2f" }} />
                <span className="text-xs font-bold" style={{ color: T.textColor }}>Forge Copilot</span>
              </div>
              <button onClick={() => setCopilotOpen(false)} style={{ color: T.textMuted }}><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-[10px] mb-3 opacity-60" style={{ color: T.textMuted }}>
                Describe a Mission in natural language. LiTT will create a draft graph for you to review.
              </p>
              <div className="space-y-2 mb-4">
                {[
                  "Review every pull request and summarize risks",
                  "Generate a weekly social campaign",
                  "Build and test my project after every push",
                  "Create an image, write a caption, and save both",
                ].map((ex) => (
                  <button key={ex} onClick={() => setCopilotPrompt(ex)} className="w-full text-left px-3 py-2 text-[10px] rounded-lg border transition-all hover:opacity-80" style={{ borderColor: T.borderColor + "20", color: T.textMuted }}>
                    {ex}
                  </button>
                ))}
              </div>
              <form onSubmit={handleCopilot} className="space-y-2">
                <textarea
                  value={copilotPrompt}
                  onChange={(e) => setCopilotPrompt(e.target.value)}
                  placeholder="Describe a Mission…"
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-[11px] outline-none resize-none"
                  style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }}
                />
                <button
                  type="submit"
                  disabled={copilotLoading || !copilotPrompt.trim()}
                  className="w-full py-2 text-[11px] font-bold rounded-lg disabled:opacity-40 transition-all"
                  style={{ backgroundColor: "#a8ff2f", color: "#03050a" }}
                >
                  {copilotLoading ? <Loader2 size={12} className="animate-spin mx-auto" /> : "Generate draft with LiTT"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── YAML Export Modal ── */}
      {showYaml && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.85)" }} onClick={() => setShowYaml(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-xl border flex flex-col overflow-hidden" style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "30", maxHeight: "80vh" }}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: T.borderColor + "15" }}>
              <div className="flex items-center gap-2">
                <FileJson size={14} style={{ color: T.accentColor }} />
                <span className="text-sm font-bold" style={{ color: T.textColor }}>Mission YAML</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={copyYaml} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-all" style={{ borderColor: T.borderColor + "20", color: yamlCopied ? "#34d399" : T.accentColor }}>
                  {yamlCopied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                </button>
                <button onClick={() => setShowYaml(false)} style={{ color: T.textMuted }}><X size={16} /></button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto">
              <pre className="font-mono text-[10px] leading-relaxed whitespace-pre-wrap" style={{ color: T.textMuted }}>{yaml}</pre>
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile Sheets ── */}
      {mobileSheet && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end" style={{ backgroundColor: "rgba(0,0,0,0.6)" }} onClick={() => setMobileSheet(null)}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-t-xl max-h-[70vh] flex flex-col" style={{ backgroundColor: T.boxBg, borderTop: `1px solid ${T.borderColor}30` }}>
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: T.borderColor + "15" }}>
              <span className="text-xs font-bold" style={{ color: T.textColor }}>
                {mobileSheet === "library" ? "Node Library" : mobileSheet === "inspector" ? "Inspector" : "Copilot"}
              </span>
              <button onClick={() => setMobileSheet(null)} style={{ color: T.textMuted }}><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {mobileSheet === "library" && (
                <div className="space-y-3">
                  {filteredCategories.map((cat) => (
                    <div key={cat.label}>
                      <div className="text-[8px] font-bold uppercase tracking-widest mb-1 opacity-40" style={{ color: T.textMuted }}>{cat.label}</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {cat.items.map((item, idx) => {
                          const Icon = item.icon;
                          return (
                            <button key={`${cat.label}-${idx}`} onClick={() => addNode(item)} className="flex flex-col items-start rounded-lg p-2" style={{ background: `${item.color}08`, border: `1px solid ${item.color}25` }}>
                              <Icon size={14} style={{ color: item.color }} />
                              <span className="text-[10px] font-bold mt-1" style={{ color: T.textColor }}>{item.title}</span>
                              <span className="text-[8px] truncate" style={{ color: T.textMuted }}>{item.subtitle}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {mobileSheet === "inspector" && selected && (
                <div className="space-y-3">
                  <input value={selected.title} onChange={(e) => updateSelected({ title: e.target.value })} className="w-full rounded-lg px-2.5 py-1.5 text-[11px] font-bold outline-none" style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                  <textarea value={selected.subtitle} onChange={(e) => updateSelected({ subtitle: e.target.value })} rows={2} className="w-full resize-none rounded-lg px-2.5 py-1.5 text-[10px] outline-none" style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { setConnectingFrom(selected.id); setMobileSheet(null); }} className="rounded-lg py-2 text-[9px] font-bold" style={{ border: `1px solid ${selected.color}30`, color: selected.color }}>Connect</button>
                    <button onClick={removeSelected} className="rounded-lg py-2 text-[9px] font-bold" style={{ border: "1px solid rgba(251,113,133,0.2)", color: "#fb7185" }}>Remove</button>
                  </div>
                </div>
              )}
              {mobileSheet === "copilot" && (
                <form onSubmit={(e) => { void handleCopilot(e); setMobileSheet(null); }} className="space-y-2">
                  <textarea value={copilotPrompt} onChange={(e) => setCopilotPrompt(e.target.value)} placeholder="Describe a Mission…" rows={3} className="w-full rounded-lg px-3 py-2 text-[11px] outline-none resize-none" style={{ background: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                  <button type="submit" disabled={copilotLoading || !copilotPrompt.trim()} className="w-full py-2 text-[11px] font-bold rounded-lg disabled:opacity-40" style={{ backgroundColor: "#a8ff2f", color: "#03050a" }}>
                    {copilotLoading ? "Generating..." : "Generate with LiTT"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
