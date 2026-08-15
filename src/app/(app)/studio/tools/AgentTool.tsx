"use client";

/**
 * AgentTool — MY AI CREW management page.
 *
 * CANONICAL CORRECTION:
 * This file previously implemented a SECOND independent chat system with
 * localStorage history, textarea, provider selector, streaming, and
 * /api/gemini/chat calls. That violated docs/product/AGENT_MANAGEMENT.md
 * and the routing contract in studio-destinations.ts.
 *
 * Now: tool=agents → agent management/configuration ONLY.
 *       tool=chat  → canonical Studio conversation.
 *
 * Chat with LiTT/Spark navigates to ?tool=chat preserving conversation ID
 * and agent selection. No chat composer exists here.
 */

import { useState, useEffect, useCallback, useMemo, Suspense, lazy } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  MessageSquare,
  Settings as SettingsIcon,
  X,
  ChevronRight,
  Package,
  Brain,
  Shield,
  Activity,
  Volume2,
  Cpu,
  Zap,
  Search,
  Rocket,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Boxes,
  Eye,
  RotateCcw,
} from "lucide-react";
import {
  CORE_PERSONALITIES,
  type AgentDefinition,
} from "@/lib/agent-registry";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import { useStudioModelStore } from "../stores/useStudioModelStore";
import { useConversationStore } from "../stores/useConversationStore";

/* ─── Types ──────────────────────────────────────────────────────────── */

type InstalledCapability = {
  id: string;
  capability_key: string;
  name: string;
  icon: string;
  enabled: boolean;
  status: string;
  required_connections: string[];
};

type AgentStatus = "online" | "setup" | "degraded" | "offline";

type DetailTab =
  | "overview"
  | "capabilities"
  | "tools"
  | "permissions"
  | "memory"
  | "model"
  | "activity"
  | "settings";

/* ─── Agent artwork mapping ──────────────────────────────────────────── */

const AGENT_ARTWORK: Record<string, { poster: string; hero: string; model3dUrl?: string }> = {
  litt: {
    poster: "/brand/litt-agent-hero-v2.png",
    hero: "/brand/litt-mascot-hero.png",
    // model3dUrl: undefined — no GLB yet, use poster only
  },
  spark: {
    poster: "/brand/spark-agent-hero-v2.png",
    hero: "/brand/spark-agent-portrait.png",
  },
};

/* ─── 3D Viewer (lazy-loaded only when user clicks "View 3D") ────────── */

const ModelViewer3D = lazy(() =>
  import("./AgentModelViewer").then((m) => ({ default: m.AgentModelViewer })),
);

/* ─── Main Component ─────────────────────────────────────────────────── */

export default function AgentTool() {
  const { resolvedColors: T } = useTheme();
  const { userId } = useClerkAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Canonical conversation store — to preserve conversation ID when navigating to chat
  const selectedConversationId = useConversationStore((s) => s.selectedConversationId);
  const activeAgentSlug = useConversationStore((s) => s.activeAgentSlug);

  // Real connection capabilities — derived from actual system state
  const { capabilities: connCaps, loading: capsLoading } = useConnectionSummary();

  // Model store — for showing the canonical model routing
  const selectedModel = useStudioModelStore((s) => s.selectedModel);

  // Installed marketplace capabilities
  const [installedCaps, setInstalledCaps] = useState<InstalledCapability[]>([]);
  const [installedLoading, setInstalledLoading] = useState(false);

  // Detail view
  const [detailAgent, setDetailAgent] = useState<AgentDefinition | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");

  // 3D viewer
  const [viewer3DAgent, setViewer3DAgent] = useState<AgentDefinition | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Load installed capabilities from Marketplace API
  useEffect(() => {
    if (!userId) return;
    setInstalledLoading(true);
    fetch("/api/marketplace/installations")
      .then((r) => r.json())
      .then((data: { installations?: Array<{ id: string; enabled: boolean; marketplace_items?: { capability_key: string; name: string; icon: string; status: string; required_connections: string[]; compatible_assistants: string[] } }> }) => {
        if (data.installations) {
          const caps: InstalledCapability[] = data.installations
            .filter((inst) => inst.marketplace_items)
            .map((inst) => ({
              id: inst.id,
              capability_key: inst.marketplace_items?.capability_key ?? "",
              name: inst.marketplace_items?.name ?? "Unknown",
              icon: inst.marketplace_items?.icon ?? "📦",
              enabled: inst.enabled,
              status: inst.marketplace_items?.status ?? "available",
              required_connections: inst.marketplace_items?.required_connections ?? [],
            }));
          setInstalledCaps(caps);
        }
      })
      .catch(() => {})
      .finally(() => setInstalledLoading(false));
  }, [userId]);

  /* ─── Derive agent status from real connections ────────────────────── */

  const getAgentStatus = useCallback(
    (agent: AgentDefinition): AgentStatus => {
      if (!agent.enabled) return "offline";
      // LiTT depends on terminal + GitHub for full operation
      if (agent.id === "litt") {
        const termOk = connCaps.terminalExecution === "available" || connCaps.terminalExecution === "idle";
        if (termOk && connCaps.githubInstalled) return "online";
        if (connCaps.terminalExecution === "connecting" || connCaps.terminalExecution === "degraded" || connCaps.terminalExecution === "error") return "degraded";
        return "setup";
      }
      // Spark depends on creative providers
      if (agent.id === "spark") {
        const hasCreative = connCaps.connectedProviders.some((p) =>
          ["fal", "minimax", "skybox", "together", "hf"].includes(p),
        );
        return hasCreative ? "online" : "setup";
      }
      return "online";
    },
    [connCaps],
  );

  /* ─── Navigate to canonical chat preserving conversation + agent ───── */

  const chatWithAgent = useCallback(
    (agentSlug: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tool", "chat");
      params.set("agent", agentSlug);
      // Preserve conversation ID if one exists
      if (selectedConversationId) {
        params.set("conversation", selectedConversationId);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname, selectedConversationId],
  );

  /* ─── Filter agents by search ──────────────────────────────────────── */

  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return CORE_PERSONALITIES;
    const q = searchQuery.toLowerCase();
    return CORE_PERSONALITIES.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.domains.some((d) => d.includes(q)),
    );
  }, [searchQuery]);

  /* ─── Get capabilities for a specific agent ────────────────────────── */

  const getAgentCapabilities = useCallback(
    (agentId: string): InstalledCapability[] => {
      return installedCaps.filter((cap) => {
        // For now, all installed caps are available to core personalities
        // since LiTT has allowlist ["*"] and Spark has creative tools
        return agentId === "litt" || agentId === "spark";
      });
    },
    [installedCaps],
  );

  /* ─── Status colors ────────────────────────────────────────────────── */

  const statusColor = (status: AgentStatus): string => {
    switch (status) {
      case "online": return "#22c55e";
      case "setup": return "#f59e0b";
      case "degraded": return "#f59e0b";
      case "offline": return "#64748b";
    }
  };

  const statusLabel = (status: AgentStatus): string => {
    switch (status) {
      case "online": return "Online";
      case "setup": return "Setup needed";
      case "degraded": return "Degraded";
      case "offline": return "Offline";
    }
  };

  /* ─── 3D viewer close ──────────────────────────────────────────────── */

  const close3DViewer = useCallback(() => setViewer3DAgent(null), []);

  /* ─── Render: 3D Viewer overlay ────────────────────────────────────── */

  if (viewer3DAgent) {
    const artwork = AGENT_ARTWORK[viewer3DAgent.id];
    return (
      <Suspense fallback={<div className="grid h-full place-items-center" style={{ color: T.textMuted }}><Loader2 className="animate-spin" size={24} /></div>}>
        <ModelViewer3D
          posterUrl={artwork?.poster}
          modelUrl={artwork?.model3dUrl}
          agentName={viewer3DAgent.name}
          agentColor={viewer3DAgent.color}
          onClose={close3DViewer}
        />
      </Suspense>
    );
  }

  /* ─── Render: Agent Detail ─────────────────────────────────────────── */

  if (detailAgent) {
    return (
      <AgentDetailView
        agent={detailAgent}
        tab={detailTab}
        onTabChange={setDetailTab}
        onBack={() => setDetailAgent(null)}
        onChat={() => chatWithAgent(detailAgent.slug)}
        onView3D={() => setViewer3DAgent(detailAgent)}
        capabilities={getAgentCapabilities(detailAgent.id)}
        installedLoading={installedLoading}
        connCaps={connCaps}
        capsLoading={capsLoading}
        selectedModel={selectedModel}
        has3DModel={!!AGENT_ARTWORK[detailAgent.id]?.model3dUrl}
        artwork={AGENT_ARTWORK[detailAgent.id]}
        status={getAgentStatus(detailAgent)}
      />
    );
  }

  /* ─── Render: MY AI CREW grid ──────────────────────────────────────── */

  return (
    <div className="flex h-full flex-col overflow-hidden select-none">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 border-b shrink-0"
        style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "50" }}
      >
        <div>
          <h1 className="text-lg font-black tracking-tight" style={{ color: T.textColor }}>
            My AI Crew
          </h1>
          <p className="text-[11px] mt-0.5" style={{ color: T.textMuted }}>
            Manage the AI operators working with you
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: T.textMuted }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agents..."
              className="w-40 rounded-lg border px-7 py-1.5 text-[11px] outline-none transition focus:w-56"
              style={{
                backgroundColor: T.bgColor,
                borderColor: T.borderColor + "30",
                color: T.textColor,
              }}
            />
          </div>
          <Link
            href="/marketplace"
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition hover:opacity-80"
            style={{ borderColor: T.accentColor + "40", color: T.accentColor }}
          >
            <Rocket size={12} /> Find Agents
          </Link>
        </div>
      </div>

      {/* Agent cards grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Section label */}
        <div className="mb-3 text-[9px] font-black uppercase tracking-[.2em]" style={{ color: T.textMuted }}>
          Installed
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredAgents.map((agent) => {
            const status = getAgentStatus(agent);
            const artwork = AGENT_ARTWORK[agent.id];
            const agentCaps = getAgentCapabilities(agent.id);
            const enabledCapCount = agentCaps.filter((c) => c.enabled).length;
            const isActiveAgent = activeAgentSlug === agent.slug;

            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                status={status}
                statusColor={statusColor(status)}
                statusLabel={statusLabel(status)}
                posterUrl={artwork?.poster}
                has3DModel={!!artwork?.model3dUrl}
                enabledCapCount={enabledCapCount}
                totalCaps={agentCaps.length}
                isActiveAgent={isActiveAgent}
                modelLabel={selectedModel.label}
                onChat={() => chatWithAgent(agent.slug)}
                onConfigure={() => { setDetailAgent(agent); setDetailTab("overview"); }}
                onView3D={() => setViewer3DAgent(agent)}
              />
            );
          })}
        </div>

        {filteredAgents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search size={32} className="mb-3 opacity-30" style={{ color: T.textMuted }} />
            <p className="text-sm font-bold" style={{ color: T.textMuted }}>No agents found</p>
            <p className="text-[11px] mt-1" style={{ color: T.textMuted }}>Try a different search term</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Agent Card ─────────────────────────────────────────────────────── */

function AgentCard({
  agent,
  status,
  statusColor: sColor,
  statusLabel: sLabel,
  posterUrl,
  has3DModel,
  enabledCapCount,
  totalCaps,
  isActiveAgent,
  modelLabel,
  onChat,
  onConfigure,
  onView3D,
}: {
  agent: AgentDefinition;
  status: AgentStatus;
  statusColor: string;
  statusLabel: string;
  posterUrl?: string;
  has3DModel: boolean;
  enabledCapCount: number;
  totalCaps: number;
  isActiveAgent: boolean;
  modelLabel: string;
  onChat: () => void;
  onConfigure: () => void;
  onView3D: () => void;
}) {
  const { resolvedColors: T } = useTheme();

  return (
    <div
      className="group relative overflow-hidden rounded-2xl border transition-all duration-300 hover:-translate-y-1"
      style={{
        borderColor: isActiveAgent ? `${agent.color}40` : `${T.borderColor}25`,
        background: `linear-gradient(180deg, ${T.boxBg}80, ${T.bgColor}40)`,
        boxShadow: isActiveAgent
          ? `0 0 24px ${agent.color}20, 0 8px 32px rgba(0,0,0,0.3)`
          : "0 4px 24px rgba(0,0,0,0.2)",
      }}
    >
      {/* Poster artwork */}
      <div
        className="relative h-48 overflow-hidden"
        style={{
          background: `radial-gradient(ellipse at center, ${agent.color}15, transparent 70%), linear-gradient(135deg, #0a0a0f, #151027)`,
        }}
      >
        {posterUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- agent artwork */
          <img
            src={posterUrl}
            alt={agent.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            style={{ objectPosition: "center top" }}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-4xl font-black" style={{ color: agent.color }}>{agent.name[0]}</div>
          </div>
        )}

        {/* Status badge */}
        <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border px-2.5 py-1 backdrop-blur-md"
          style={{ borderColor: `${sColor}40`, background: `${sColor}15` }}>
          <span className="relative flex h-2 w-2">
            {status === "online" && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: sColor }} />
            )}
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: sColor }} />
          </span>
          <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: sColor }}>{sLabel}</span>
        </div>

        {/* Active agent badge */}
        {isActiveAgent && (
          <div className="absolute left-3 top-3 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase backdrop-blur-md"
            style={{ borderColor: `${agent.color}40`, background: `${agent.color}20`, color: agent.color }}>
            Active
          </div>
        )}

        {/* 3D button (only if model exists) */}
        {has3DModel && (
          <button
            onClick={onView3D}
            className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border px-2 py-1 text-[9px] font-bold backdrop-blur-md transition hover:scale-105"
            style={{ borderColor: `${agent.color}40`, background: `${agent.color}20`, color: agent.color }}
          >
            <Boxes size={11} /> View 3D
          </button>
        )}
      </div>

      {/* Card body */}
      <div className="p-4">
        {/* Name + role */}
        <div className="flex items-center gap-2">
          <h3 className="text-base font-black" style={{ color: agent.color }}>{agent.name}</h3>
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: T.textMuted }}>
            {agent.role.split("·")[0].trim()}
          </span>
        </div>

        {/* Description */}
        <p className="mt-1.5 text-[11px] leading-relaxed line-clamp-2" style={{ color: T.textMuted }}>
          {agent.description}
        </p>

        {/* Capabilities summary */}
        <div className="mt-3 flex flex-wrap gap-1">
          {agent.domains.slice(0, 5).map((d) => (
            <span
              key={d}
              className="rounded px-1.5 py-0.5 text-[8px] font-bold"
              style={{ background: `${agent.color}10`, color: `${agent.color}cc` }}
            >
              {d}
            </span>
          ))}
          {agent.domains.length > 5 && (
            <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ color: T.textMuted }}>
              +{agent.domains.length - 5}
            </span>
          )}
        </div>

        {/* Model + caps info */}
        <div className="mt-3 flex items-center justify-between text-[9px]" style={{ color: T.textMuted }}>
          <span className="flex items-center gap-1">
            <Cpu size={10} /> {modelLabel}
          </span>
          <span className="flex items-center gap-1">
            <Package size={10} /> {enabledCapCount}/{totalCaps} caps
          </span>
        </div>

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          <button
            onClick={onChat}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-black transition hover:scale-[1.02]"
            style={{
              background: `linear-gradient(135deg, ${agent.color}, ${agent.color}cc)`,
              color: "#0a0a0f",
              boxShadow: `0 4px 16px ${agent.color}30`,
            }}
          >
            <MessageSquare size={13} /> Chat with {agent.name}
          </button>
          <button
            onClick={onConfigure}
            className="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[11px] font-bold transition hover:opacity-80"
            style={{ borderColor: `${T.borderColor}30`, color: T.textMuted }}
          >
            <SettingsIcon size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Agent Detail View ──────────────────────────────────────────────── */

function AgentDetailView({
  agent,
  tab,
  onTabChange,
  onBack,
  onChat,
  onView3D,
  capabilities,
  installedLoading,
  connCaps,
  capsLoading,
  selectedModel,
  has3DModel,
  artwork,
  status,
}: {
  agent: AgentDefinition;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onBack: () => void;
  onChat: () => void;
  onView3D: () => void;
  capabilities: InstalledCapability[];
  installedLoading: boolean;
  connCaps: ReturnType<typeof useConnectionSummary>["capabilities"];
  capsLoading: boolean;
  selectedModel: ReturnType<typeof useStudioModelStore.getState>["selectedModel"];
  has3DModel: boolean;
  artwork: { poster: string; hero: string; model3dUrl?: string } | undefined;
  status: AgentStatus;
}) {
  const { resolvedColors: T } = useTheme();

  const tabs: { id: DetailTab; label: string; icon: typeof Cpu }[] = [
    { id: "overview", label: "Overview", icon: Cpu },
    { id: "capabilities", label: "Capabilities", icon: Package },
    { id: "tools", label: "Tools", icon: Zap },
    { id: "permissions", label: "Permissions", icon: Shield },
    { id: "memory", label: "Memory", icon: Brain },
    { id: "model", label: "Model", icon: Cpu },
    { id: "activity", label: "Activity", icon: Activity },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header with poster + back */}
      <div
        className="relative shrink-0 overflow-hidden border-b"
        style={{ borderColor: T.borderColor + "20" }}
      >
        {/* Hero artwork */}
        <div className="relative h-32 overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${agent.color}10, #0a0a0f)` }}>
          {artwork?.hero && (
            /* eslint-disable-next-line @next/next/no-img-element -- agent hero */
            <img src={artwork.hero} alt="" className="h-full w-full object-cover opacity-50" style={{ objectPosition: "center top" }} />
          )}
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent, ${T.bgColor}f0)` }} />
        </div>

        {/* Header content */}
        <div className="relative -mt-12 px-5 pb-4">
          <div className="flex items-end justify-between">
            <div className="flex items-end gap-3">
              {/* Poster thumbnail */}
              <div className="h-16 w-16 overflow-hidden rounded-xl border-2 shrink-0"
                style={{ borderColor: `${agent.color}40`, background: T.bgColor }}>
                {artwork?.poster && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={artwork.poster} alt={agent.name} className="h-full w-full object-cover" />
                )}
              </div>
              <div>
                <button onClick={onBack} className="mb-1 flex items-center gap-1 text-[10px] font-bold transition hover:opacity-80"
                  style={{ color: T.textMuted }}>
                  <ChevronRight size={11} className="rotate-180" /> Back to Crew
                </button>
                <h1 className="text-xl font-black" style={{ color: agent.color }}>{agent.name}</h1>
                <p className="text-[10px]" style={{ color: T.textMuted }}>{agent.role}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {has3DModel && (
                <button onClick={onView3D}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold transition hover:opacity-80"
                  style={{ borderColor: `${agent.color}40`, color: agent.color }}>
                  <Boxes size={12} /> View 3D
                </button>
              )}
              <button onClick={onChat}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-black transition hover:scale-105"
                style={{ background: agent.color, color: "#0a0a0f" }}>
                <MessageSquare size={12} /> Chat
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-3 py-2 border-b shrink-0 overflow-x-auto"
        style={{ borderColor: T.borderColor + "15", backgroundColor: T.boxBg + "30" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className="flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded font-bold transition-all whitespace-nowrap"
            style={{
              backgroundColor: tab === t.id ? `${agent.color}15` : "transparent",
              color: tab === t.id ? agent.color : T.textMuted,
            }}
          >
            <t.icon size={11} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === "overview" && (
          <DetailOverview agent={agent} status={status} connCaps={connCaps} capsLoading={capsLoading} />
        )}
        {tab === "capabilities" && (
          <DetailCapabilities
            agent={agent}
            capabilities={capabilities}
            loading={installedLoading}
          />
        )}
        {tab === "tools" && <DetailTools agent={agent} connCaps={connCaps} />}
        {tab === "permissions" && <DetailPermissions agent={agent} connCaps={connCaps} />}
        {tab === "memory" && <DetailMemory agent={agent} />}
        {tab === "model" && <DetailModel agent={agent} selectedModel={selectedModel} />}
        {tab === "activity" && <DetailActivity agent={agent} />}
        {tab === "settings" && <DetailSettings agent={agent} />}
      </div>
    </div>
  );
}

/* ─── Detail Tab: Overview ───────────────────────────────────────────── */

function DetailOverview({
  agent,
  status,
  connCaps,
  capsLoading,
}: {
  agent: AgentDefinition;
  status: AgentStatus;
  connCaps: ReturnType<typeof useConnectionSummary>["capabilities"];
  capsLoading: boolean;
}) {
  const { resolvedColors: T } = useTheme();

  const statusColors: Record<AgentStatus, string> = {
    online: "#22c55e",
    setup: "#f59e0b",
    degraded: "#f59e0b",
    offline: "#64748b",
  };
  const sColor = statusColors[status];

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Status */}
      <div className="rounded-xl border p-4" style={{ borderColor: `${sColor}25`, background: `${sColor}08` }}>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            {status === "online" && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: sColor }} />
            )}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: sColor }} />
          </span>
          <span className="text-sm font-black" style={{ color: sColor }}>
            {status === "online" ? "Online" : status === "setup" ? "Setup needed" : status === "degraded" ? "Degraded" : "Offline"}
          </span>
        </div>
        <p className="mt-2 text-[11px]" style={{ color: T.textMuted }}>
          {status === "online"
            ? `${agent.name} is operational and ready to work.`
            : status === "setup"
              ? `${agent.name} needs additional connections to be fully operational.`
              : `${agent.name} is currently unavailable.`}
        </p>
      </div>

      {/* Purpose */}
      <div>
        <div className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: T.accentColor }}>Purpose</div>
        <p className="text-[12px] leading-relaxed" style={{ color: T.textColor }}>{agent.description}</p>
      </div>

      {/* Personality */}
      <div>
        <div className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: T.accentColor }}>Personality</div>
        <p className="text-[11px] leading-relaxed" style={{ color: T.textMuted }}>{agent.personality}</p>
      </div>

      {/* Domains */}
      <div>
        <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.accentColor }}>Capability Domains</div>
        <div className="flex flex-wrap gap-1.5">
          {agent.domains.map((d) => (
            <span key={d} className="rounded-lg px-2 py-1 text-[10px] font-bold"
              style={{ background: `${agent.color}10`, color: `${agent.color}cc`, border: `1px solid ${agent.color}20` }}>
              {d}
            </span>
          ))}
        </div>
      </div>

      {/* Connection status (real, derived) */}
      <div>
        <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.accentColor }}>
          Connections {capsLoading && <Loader2 size={10} className="inline animate-spin" />}
        </div>
        <div className="space-y-1.5">
          <ConnectionRow label="GitHub" connected={connCaps.githubInstalled} detail={connCaps.repositoryName ?? "Not connected"} />
          <ConnectionRow label="Terminal" connected={connCaps.terminalExecution === "available" || connCaps.terminalExecution === "idle"} detail={connCaps.terminalExecution === "available" ? "Connected" : connCaps.terminalExecution === "idle" ? "Ready · no session" : connCaps.terminalExecution} />
          <ConnectionRow label="Voice" connected={connCaps.voiceHealth.available} detail={connCaps.voiceHealth.available ? "Healthy" : "Not configured"} />
          <ConnectionRow label="Workspace" connected={connCaps.workspaceStatus === "ready"} detail={connCaps.workspaceStatus ?? "Not ready"} />
        </div>
      </div>
    </div>
  );
}

function ConnectionRow({ label, connected, detail }: { label: string; connected: boolean; detail: string }) {
  const { resolvedColors: T } = useTheme();
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2"
      style={{ borderColor: `${T.borderColor}15`, background: T.bgColor + "50" }}>
      <div className="flex items-center gap-2">
        {connected ? (
          <CheckCircle2 size={13} style={{ color: "#22c55e" }} />
        ) : (
          <AlertCircle size={13} style={{ color: "#f59e0b" }} />
        )}
        <span className="text-[11px] font-bold" style={{ color: T.textColor }}>{label}</span>
      </div>
      <span className="text-[10px]" style={{ color: T.textMuted }}>{detail}</span>
    </div>
  );
}

/* ─── Detail Tab: Capabilities ───────────────────────────────────────── */

function DetailCapabilities({
  agent,
  capabilities,
  loading,
}: {
  agent: AgentDefinition;
  capabilities: InstalledCapability[];
  loading: boolean;
}) {
  const { resolvedColors: T } = useTheme();

  return (
    <div className="space-y-3 max-w-2xl">
      {loading && (
        <div className="flex items-center gap-2 text-[11px] opacity-50" style={{ color: T.textMuted }}>
          <Loader2 size={13} className="animate-spin" /> Loading capabilities...
        </div>
      )}
      {!loading && capabilities.length === 0 && (
        <div className="text-center py-8">
          <Package size={24} className="mx-auto mb-3 opacity-30" style={{ color: T.textMuted }} />
          <p className="text-[12px] font-bold mb-1" style={{ color: T.textMuted }}>No capabilities installed</p>
          <p className="text-[10px] mb-4" style={{ color: T.textMuted }}>Install capabilities from the Marketplace to extend {agent.name}&apos;s tools.</p>
          <Link href={`/marketplace?assistant=${agent.slug}`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-bold transition hover:opacity-80"
            style={{ borderColor: `${agent.color}40`, color: agent.color }}>
            <Package size={12} /> Browse Marketplace
          </Link>
        </div>
      )}
      {capabilities.map((cap) => (
        <div key={cap.id} className="rounded-xl border p-3"
          style={{ borderColor: cap.enabled ? `${agent.color}20` : `${T.borderColor}15`, background: T.bgColor + "50" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base">{cap.icon}</span>
              <span className="text-[12px] font-bold" style={{ color: cap.enabled ? T.textColor : T.textMuted }}>{cap.name}</span>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: cap.enabled ? `${agent.color}15` : `${T.borderColor}10`,
                color: cap.enabled ? agent.color : T.textMuted,
              }}>
              {cap.enabled ? "ENABLED" : "OFF"}
            </span>
          </div>
          {cap.required_connections.length > 0 && (
            <div className="mt-1.5 text-[9px]" style={{ color: T.textMuted }}>
              Requires: {cap.required_connections.join(", ")}
            </div>
          )}
        </div>
      ))}
      {capabilities.length > 0 && (
        <Link href={`/marketplace?assistant=${agent.slug}`}
          className="block text-center text-[11px] py-2.5 rounded-lg border transition hover:opacity-80"
          style={{ borderColor: `${T.borderColor}20`, color: T.textMuted }}>
          <Package size={11} className="inline mr-1" /> Manage in Marketplace
        </Link>
      )}
    </div>
  );
}

/* ─── Detail Tab: Tools ──────────────────────────────────────────────── */

function DetailTools({
  agent,
  connCaps,
}: {
  agent: AgentDefinition;
  connCaps: ReturnType<typeof useConnectionSummary>["capabilities"];
}) {
  const { resolvedColors: T } = useTheme();

  const allTools = connCaps.availableTools;
  const allowedTools = agent.tools.allowlist.includes("*") ? allTools : allTools.filter((t) => agent.tools.allowlist.includes(t));

  return (
    <div className="space-y-3 max-w-2xl">
      <div>
        <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.accentColor }}>Tool Allowlist</div>
        <p className="text-[11px] mb-3" style={{ color: T.textMuted }}>
          {agent.tools.allowlist.includes("*")
            ? `${agent.name} has access to all available tools.`
            : `${agent.name} can only use: ${agent.tools.allowlist.join(", ")}`}
        </p>
      </div>
      <div>
        <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.accentColor }}>Available Tools ({allowedTools.length})</div>
        {allowedTools.length === 0 ? (
          <p className="text-[11px]" style={{ color: T.textMuted }}>No tools currently available. Connect services to enable tools.</p>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {allowedTools.map((tool) => (
              <div key={tool} className="flex items-center gap-2 rounded-lg border px-3 py-2"
                style={{ borderColor: `${T.borderColor}15`, background: T.bgColor + "50" }}>
                <Zap size={12} style={{ color: agent.color }} />
                <span className="text-[11px] font-bold" style={{ color: T.textColor }}>{tool}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {agent.tools.requiredConnections.length > 0 && (
        <div>
          <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.accentColor }}>Required Connections</div>
          <div className="flex flex-wrap gap-1.5">
            {agent.tools.requiredConnections.map((c) => (
              <span key={c} className="rounded-lg px-2 py-1 text-[10px] font-bold"
                style={{ background: "#f59e0b15", color: "#f59e0b", border: "1px solid #f59e0b25" }}>
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Detail Tab: Permissions ────────────────────────────────────────── */

function DetailPermissions({ agent, connCaps }: { agent: AgentDefinition; connCaps: ReturnType<typeof useConnectionSummary>["capabilities"] }) {
  const { resolvedColors: T } = useTheme();

  const permissions = [
    { label: "Write access", granted: connCaps.writeAccess, detail: connCaps.writeAccess ? "Can write files" : "Read-only" },
    { label: "Terminal execution", granted: connCaps.terminalExecution === "available" || connCaps.terminalExecution === "idle", detail: connCaps.terminalExecution === "available" ? "Connected" : connCaps.terminalExecution === "idle" ? "Ready · no session" : connCaps.terminalExecution },
    { label: "GitHub access", granted: connCaps.githubInstalled, detail: connCaps.repositoryName ?? "Not connected" },
    { label: "Deployment", granted: false, detail: "Requires approval" },
    { label: "Voice", granted: connCaps.voiceHealth.available, detail: connCaps.voiceHealth.available ? "Available" : "Not configured" },
  ];

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.accentColor }}>Access Control</div>
      {permissions.map((p) => (
        <div key={p.label} className="flex items-center justify-between rounded-xl border px-3 py-2.5"
          style={{ borderColor: `${T.borderColor}15`, background: T.bgColor + "50" }}>
          <div className="flex items-center gap-2">
            <Shield size={13} style={{ color: p.granted ? "#22c55e" : "#f59e0b" }} />
            <span className="text-[11px] font-bold" style={{ color: T.textColor }}>{p.label}</span>
          </div>
          <span className="text-[10px]" style={{ color: T.textMuted }}>{p.detail}</span>
        </div>
      ))}
      <div className="rounded-xl border p-3 text-[10px]" style={{ borderColor: `${T.borderColor}15`, background: T.bgColor + "50", color: T.textMuted }}>
        <Shield size={11} className="inline mr-1" />
        Approval behavior: Writes and deployments require explicit user approval before execution.
      </div>
    </div>
  );
}

/* ─── Detail Tab: Memory ─────────────────────────────────────────────── */

function DetailMemory({ agent }: { agent: AgentDefinition }) {
  const { resolvedColors: T } = useTheme();

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.accentColor }}>Memory</div>
      <p className="text-[11px] leading-relaxed" style={{ color: T.textMuted }}>
        Memory persistence is managed at the project level. {agent.name} shares conversation context within each project.
      </p>
      <div className="rounded-xl border p-3 text-[10px]" style={{ borderColor: `${T.borderColor}15`, background: T.bgColor + "50", color: T.textMuted }}>
        <div className="flex justify-between mb-1"><span>Storage</span><span style={{ color: agent.color }}>Project-scoped</span></div>
        <div className="flex justify-between"><span>Scope</span><span style={{ color: T.accentColor }}>Per-conversation</span></div>
      </div>
      <Link href="/settings/memory"
        className="block text-center text-[11px] py-2.5 rounded-lg border transition hover:opacity-80"
        style={{ borderColor: `${T.borderColor}20`, color: T.textMuted }}>
        <Brain size={11} className="inline mr-1" /> Memory Settings
      </Link>
    </div>
  );
}

/* ─── Detail Tab: Model ──────────────────────────────────────────────── */

function DetailModel({
  agent,
  selectedModel,
}: {
  agent: AgentDefinition;
  selectedModel: ReturnType<typeof useStudioModelStore.getState>["selectedModel"];
}) {
  const { resolvedColors: T } = useTheme();

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.accentColor }}>Model Routing</div>
      <div className="rounded-xl border p-4" style={{ borderColor: `${agent.color}20`, background: `${agent.color}05` }}>
        <div className="flex items-center gap-2">
          <Cpu size={16} style={{ color: agent.color }} />
          <span className="text-sm font-black" style={{ color: T.textColor }}>{selectedModel.label}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
          <div>
            <div className="opacity-50 mb-0.5" style={{ color: T.textMuted }}>Provider</div>
            <div className="font-bold" style={{ color: T.textColor }}>{selectedModel.provider}</div>
          </div>
          <div>
            <div className="opacity-50 mb-0.5" style={{ color: T.textMuted }}>Model</div>
            <div className="font-bold" style={{ color: T.textColor }}>{selectedModel.model}</div>
          </div>
          <div>
            <div className="opacity-50 mb-0.5" style={{ color: T.textMuted }}>Cost</div>
            <div className="font-bold" style={{ color: T.textColor }}>{selectedModel.cost}</div>
          </div>
          <div>
            <div className="opacity-50 mb-0.5" style={{ color: T.textMuted }}>Speed</div>
            <div className="font-bold" style={{ color: T.textColor }}>{selectedModel.speed}</div>
          </div>
        </div>
        {selectedModel.description && (
          <p className="mt-3 text-[10px] leading-relaxed" style={{ color: T.textMuted }}>{selectedModel.description}</p>
        )}
      </div>
      <div className="text-[10px]" style={{ color: T.textMuted }}>
        Default task: <span className="font-bold" style={{ color: agent.color }}>{agent.defaultModelTask}</span>
      </div>
      <Link href="/settings/models"
        className="block text-center text-[11px] py-2.5 rounded-lg border transition hover:opacity-80"
        style={{ borderColor: `${T.borderColor}20`, color: T.textMuted }}>
        <Cpu size={11} className="inline mr-1" /> Model Settings
      </Link>
    </div>
  );
}

/* ─── Detail Tab: Activity ───────────────────────────────────────────── */

function DetailActivity({ agent }: { agent: AgentDefinition }) {
  const { resolvedColors: T } = useTheme();

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.accentColor }}>Recent Activity</div>
      <p className="text-[11px]" style={{ color: T.textMuted }}>
        Activity from {agent.name}&apos;s missions, builds, and tool executions will appear here.
      </p>
      <div className="rounded-xl border p-6 text-center" style={{ borderColor: `${T.borderColor}15`, background: T.bgColor + "50" }}>
        <Activity size={24} className="mx-auto mb-2 opacity-30" style={{ color: T.textMuted }} />
        <p className="text-[11px] font-bold" style={{ color: T.textMuted }}>No recent activity</p>
        <p className="text-[10px] mt-1" style={{ color: T.textMuted }}>Start a conversation to see actions here.</p>
      </div>
    </div>
  );
}

/* ─── Detail Tab: Settings ───────────────────────────────────────────── */

function DetailSettings({ agent }: { agent: AgentDefinition }) {
  const { resolvedColors: T } = useTheme();

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.accentColor }}>Settings</div>
      <div className="rounded-xl border p-4" style={{ borderColor: `${T.borderColor}15`, background: T.bgColor + "50" }}>
        <div className="grid grid-cols-2 gap-3 text-[10px]">
          <div>
            <div className="opacity-50 mb-0.5" style={{ color: T.textMuted }}>Version</div>
            <div className="font-bold" style={{ color: T.textColor }}>{agent.version}</div>
          </div>
          <div>
            <div className="opacity-50 mb-0.5" style={{ color: T.textMuted }}>Billing</div>
            <div className="font-bold" style={{ color: T.textColor }}>{agent.billingModel}</div>
          </div>
          <div>
            <div className="opacity-50 mb-0.5" style={{ color: T.textMuted }}>Minimum plan</div>
            <div className="font-bold" style={{ color: T.textColor }}>{agent.minimumPlan}</div>
          </div>
          <div>
            <div className="opacity-50 mb-0.5" style={{ color: T.textMuted }}>Per-run cost</div>
            <div className="font-bold" style={{ color: T.textColor }}>{agent.cost.perRun} BITS</div>
          </div>
        </div>
      </div>
      <Link href="/settings/agents"
        className="block text-center text-[11px] py-2.5 rounded-lg border transition hover:opacity-80"
        style={{ borderColor: `${T.borderColor}20`, color: T.textMuted }}>
        <SettingsIcon size={11} className="inline mr-1" /> Agent Settings
      </Link>
    </div>
  );
}
