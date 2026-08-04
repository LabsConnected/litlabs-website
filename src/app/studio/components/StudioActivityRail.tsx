"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Circle,
  GitBranch,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Bot,
  FileEdit,
  Rocket,
  Heart,
  AlertTriangle,
} from "lucide-react";
import type { ChatMessage } from "../stores/useStudioAgentStore";
import { AGENT_META, type AgentId } from "../stores/useStudioAgentStore";

interface ActivityEvent {
  id: string;
  type: "message" | "file" | "build" | "deploy" | "agent" | "error";
  label: string;
  detail?: string;
  timestamp: number;
  status: "success" | "pending" | "error" | "info";
}

interface StudioActivityRailProps {
  messages: ChatMessage[];
  busy: boolean;
  activeAgentId: AgentId;
  projectName: string | null;
  modelLabel: string;
  terminalStatus: "connected" | "disconnected" | "connecting" | "error";
  repositoryName: string | null;
  branch?: string | null;
  onOpenTerminal?: () => void;
  onSelectAgent?: (id: AgentId) => void;
}

/**
 * StudioActivityRail — premium right-side activity panel.
 *
 * Shows live status, mission timeline (derived from conversation messages),
 * active agents, project health, and recent events. All data is derived
 * from real conversation state — no fake events.
 */
export default function StudioActivityRail({
  messages,
  busy,
  activeAgentId,
  projectName,
  modelLabel,
  terminalStatus,
  repositoryName,
  branch,
  onOpenTerminal,
  onSelectAgent,
}: StudioActivityRailProps) {
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [healthOpen, setHealthOpen] = useState(true);

  // Derive activity events from conversation messages
  const events = useMemo<ActivityEvent[]>(() => {
    const result: ActivityEvent[] = [];
    const recent = messages.slice(-8);
    for (const msg of recent) {
      if (msg.role === "user") {
        result.push({
          id: msg.id ?? `u-${msg.createdAt ?? Date.now()}`,
          type: "message",
          label: "User message sent",
          detail: msg.content.slice(0, 60) + (msg.content.length > 60 ? "…" : ""),
          timestamp: msg.createdAt ?? Date.now(),
          status: "info",
        });
      } else if (msg.role === "assistant") {
        const agentName = msg.agentSlug ? AGENT_META[msg.agentSlug as AgentId]?.displayName ?? "LiTT" : "LiTT";
        const isFailed = msg.status === "failed";
        const isPending = msg.status === "pending" || msg.status === "streaming";
        result.push({
          id: msg.id ?? `a-${msg.createdAt ?? Date.now()}`,
          type: "agent",
          label: `${agentName} responded`,
          detail: isFailed ? "Response failed" : isPending ? "Generating…" : msg.content.slice(0, 60) + (msg.content.length > 60 ? "…" : ""),
          timestamp: msg.createdAt ?? Date.now(),
          status: isFailed ? "error" : isPending ? "pending" : "success",
        });
      }
    }
    return result.reverse();
  }, [messages]);

  // Active agents crew — only LiTT and Spark are official Studio agents.
  // Coder and Researcher capabilities are consolidated into LiTT.
  const crewAgents = useMemo(() => {
    const ids: AgentId[] = ["litt", "spark"];
    return ids.map((id) => ({
      id,
      meta: AGENT_META[id],
      active: id === activeAgentId,
    })).filter((a) => a.meta);
  }, [activeAgentId]);

  const statusColor = busy ? "var(--spark-primary)" : terminalStatus === "connected" ? "var(--litt-primary)" : "var(--text-muted)";
  const statusLabel = busy ? "Working" : terminalStatus === "connected" ? "Active" : "Idle";

  return (
    <aside
      className="hidden lg:flex h-full shrink-0 flex-col border-l overflow-hidden"
      style={{
        width: "var(--studio-rail-w)",
        backgroundColor: "var(--studio-surface)",
        borderLeft: "1px solid var(--studio-border)",
        backdropFilter: "blur(12px)",
      }}
      data-testid="studio-activity-rail"
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--studio-border)" }}
      >
        <div className="flex items-center gap-2">
          <Activity size={13} style={{ color: "var(--spark-primary)" }} className="pointer-events-none" />
          <span className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-secondary)" }}>
            Activity
          </span>
        </div>
        <span
          className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-bold"
          style={{
            color: statusColor,
            borderColor: `${statusColor}40`,
            backgroundColor: `${statusColor}10`,
          }}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${busy ? "animate-pulse" : ""}`}
            style={{ backgroundColor: statusColor, boxShadow: `0 0 4px ${statusColor}` }}
            aria-hidden
          />
          {statusLabel}
        </span>
      </div>

      {/* Scrollable content */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5 studio-scroll">
        {/* Mission Timeline */}
        <Section
          title="Mission Timeline"
          open={timelineOpen}
          onToggle={() => setTimelineOpen((v) => !v)}
        >
          {events.length === 0 ? (
            <EmptyHint text="No activity yet. Send a message to start a mission." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {events.map((ev) => (
                <TimelineEntry key={ev.id} event={ev} />
              ))}
            </div>
          )}
        </Section>

        {/* Active Agents */}
        <Section
          title="Active Agents"
          open={agentsOpen}
          onToggle={() => setAgentsOpen((v) => !v)}
        >
          <div className="flex flex-col gap-1">
            {crewAgents.map(({ id, meta, active }) => (
              <button
                key={id}
                type="button"
                onClick={() => onSelectAgent?.(id)}
                className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-all hover:bg-white/5 active:scale-[0.98]"
                style={{
                  borderColor: active ? `${meta.color}40` : "var(--studio-border)",
                  backgroundColor: active ? `${meta.color}08` : "transparent",
                }}
                title={`Switch to ${meta.displayName}`}
                aria-label={`Switch agent to ${meta.displayName}`}
              >
                <div
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-black"
                  style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
                >
                  {meta.displayName[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold truncate" style={{ color: active ? "var(--text-primary)" : "var(--text-secondary)" }}>
                    {meta.displayName}
                  </div>
                  <div className="text-[9px] font-medium truncate" style={{ color: "var(--text-muted)" }}>
                    {meta.role}
                  </div>
                </div>
                {active && (
                  <span
                    className="h-1.5 w-1.5 rounded-full animate-pulse"
                    style={{ backgroundColor: meta.color, boxShadow: `0 0 4px ${meta.color}` }}
                    aria-hidden
                  />
                )}
              </button>
            ))}
          </div>
        </Section>

        {/* Project Health */}
        <Section
          title="Project Health"
          open={healthOpen}
          onToggle={() => setHealthOpen((v) => !v)}
        >
          <div className="flex flex-col gap-1">
            <HealthRow
              icon={GitBranch}
              label="Repository"
              value={repositoryName ?? "Not connected"}
              status={repositoryName ? "success" : "muted"}
            />
            <HealthRow
              icon={CheckCircle2}
              label="Branch"
              value={branch ?? "—"}
              status={branch ? "success" : "muted"}
            />
            <HealthRow
              icon={Bot}
              label="AI Model"
              value={modelLabel}
              status="success"
            />
            <HealthRow
              icon={Rocket}
              label="Terminal"
              value={terminalStatus === "connected" ? "Connected" : terminalStatus === "connecting" ? "Connecting…" : "Disconnected"}
              status={terminalStatus === "connected" ? "success" : terminalStatus === "connecting" ? "pending" : "muted"}
              onClick={terminalStatus !== "connected" ? onOpenTerminal : undefined}
            />
            <HealthRow
              icon={Zap}
              label="Project"
              value={projectName ?? "No project"}
              status={projectName ? "success" : "muted"}
            />
          </div>
        </Section>
      </div>
    </aside>
  );
}

/* ── Collapsible Section ────────────────────────────────────────── */
function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: "var(--studio-border)",
        backgroundColor: "var(--studio-card)",
        backdropFilter: "blur(8px)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-2.5 py-2 transition hover:bg-white/5"
      >
        <span className="text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: "var(--text-secondary)" }}>
          {title}
        </span>
        {open ? (
          <ChevronDown size={12} style={{ color: "var(--text-muted)" }} className="pointer-events-none" />
        ) : (
          <ChevronRight size={12} style={{ color: "var(--text-muted)" }} className="pointer-events-none" />
        )}
      </button>
      {open && (
        <div
          className="border-t px-2.5 py-2"
          style={{ borderColor: "var(--studio-border)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Timeline Entry ─────────────────────────────────────────────── */
function TimelineEntry({ event }: { event: ActivityEvent }) {
  const cfg = {
    success: { color: "var(--litt-primary)", icon: CheckCircle2 },
    pending: { color: "var(--spark-primary)", icon: Clock },
    error: { color: "var(--error)", icon: XCircle },
    info: { color: "var(--text-muted)", icon: Circle },
  }[event.status];
  const Icon = cfg.icon;

  const timeStr = useMemo(() => {
    const d = new Date(event.timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [event.timestamp]);

  return (
    <div className="flex items-start gap-2">
      <Icon
        size={12}
        strokeWidth={2}
        style={{ color: cfg.color, marginTop: 1 }}
        className={`pointer-events-none shrink-0 ${event.status === "pending" ? "animate-pulse" : ""}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-bold truncate" style={{ color: "var(--text-primary)" }}>
            {event.label}
          </span>
          <span className="text-[8px] font-medium shrink-0" style={{ color: "var(--text-muted)" }}>
            {timeStr}
          </span>
        </div>
        {event.detail && (
          <div className="text-[9px] leading-tight truncate" style={{ color: "var(--text-muted)" }}>
            {event.detail}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Health Row ─────────────────────────────────────────────────── */
function HealthRow({
  icon: Icon,
  label,
  value,
  status,
  onClick,
}: {
  icon: typeof GitBranch;
  label: string;
  value: string;
  status: "success" | "pending" | "error" | "muted";
  onClick?: () => void;
}) {
  const cfg = {
    success: { color: "var(--litt-primary)" },
    pending: { color: "var(--spark-primary)" },
    error: { color: "var(--error)" },
    muted: { color: "var(--text-muted)" },
  }[status];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-white/5 disabled:cursor-default"
    >
      <Icon size={13} strokeWidth={1.7} style={{ color: cfg.color }} className="pointer-events-none shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          {label}
        </div>
        <div className="text-[11px] font-bold truncate" style={{ color: "var(--text-primary)" }}>
          {value}
        </div>
      </div>
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{ backgroundColor: cfg.color, boxShadow: status !== "muted" ? `0 0 4px ${cfg.color}` : "none" }}
        aria-hidden
      />
    </button>
  );
}

/* ── Empty Hint ─────────────────────────────────────────────────── */
function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1 py-1.5">
      <AlertTriangle size={11} style={{ color: "var(--text-muted)" }} className="pointer-events-none shrink-0" />
      <span className="text-[10px] leading-tight" style={{ color: "var(--text-muted)" }}>
        {text}
      </span>
    </div>
  );
}
