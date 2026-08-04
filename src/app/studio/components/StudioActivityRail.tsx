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
  Search,
  Filter,
  EyeOff,
  Check,
  Trash2,
  PanelRightClose,
} from "lucide-react";
import type { ChatMessage } from "../stores/useStudioAgentStore";
import { AGENT_META, type AgentId } from "../stores/useStudioAgentStore";

type EventSource = "litt" | "spark" | "user" | "system";
type EventCategory = "message" | "mission" | "voice" | "error" | "build" | "deploy" | "agent";

interface ActivityEvent {
  id: string;
  type: "message" | "file" | "build" | "deploy" | "agent" | "error";
  source: EventSource;
  category: EventCategory;
  label: string;
  detail?: string;
  timestamp: number;
  status: "success" | "pending" | "error" | "info";
}

type TimelineFilter = "all" | "litt" | "spark" | "user" | "errors" | "voice" | "missions";
type ScopeFilter = "all" | "conversation" | "session" | "project";

const TIMELINE_FILTERS: { id: TimelineFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "litt", label: "LiTT" },
  { id: "spark", label: "Spark" },
  { id: "user", label: "User" },
  { id: "errors", label: "Errors" },
  { id: "voice", label: "Voice" },
  { id: "missions", label: "Missions" },
];

const TIMELINE_SCOPES: { id: ScopeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "conversation", label: "Conversation" },
  { id: "session", label: "Session" },
  { id: "project", label: "Project" },
];

const DAY_MS = 86_400_000;

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
  /** Called when the user clicks the rail's close button. */
  onClose?: () => void;
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
  onClose,
}: StudioActivityRailProps) {
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [healthOpen, setHealthOpen] = useState(true);

  // ── Mission Timeline / Activity log controls ───────────────────────
  // Two-layer model: clearing the *view* never touches the persistent
  // system history (the `messages` array owned by the parent store).
  // `clearedAt` and `archivedIds` only hide entries from the visible list.
  const [tlFilter, setTlFilter] = useState<TimelineFilter>("all");
  const [tlScope, setTlScope] = useState<ScopeFilter>("all");
  const [tlSearch, setTlSearch] = useState("");
  const [tlSearchOpen, setTlSearchOpen] = useState(false);
  const [tlFilterOpen, setTlFilterOpen] = useState(false);
  const [tlRetentionOpen, setTlRetentionOpen] = useState(false);
  const [clearedAt, setClearedAt] = useState<number | null>(null);
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [collapsedAll, setCollapsedAll] = useState(false);
  const [hideSystemNoise, setHideSystemNoise] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [hideCompleted24h, setHideCompleted24h] = useState(false);
  const [autoCollapseOlder, setAutoCollapseOlder] = useState(false);
  const [pinFailures, setPinFailures] = useState(true);
  const [clearedNotice, setClearedNotice] = useState(false);
  const [sessionStart] = useState<number>(() => Date.now());

  // Derive activity events from conversation messages.
  // The full `messages` array is the persistent system log and is never
  // mutated here — only the visible projection below can be cleared.
  const events = useMemo<ActivityEvent[]>(() => {
    const result: ActivityEvent[] = [];
    const recent = messages.slice(-8);
    for (const msg of recent) {
      if (msg.role === "user") {
        result.push({
          id: msg.id ?? `u-${msg.createdAt ?? Date.now()}`,
          type: "message",
          source: "user",
          category: "message",
          label: "User message sent",
          detail: msg.content.slice(0, 60) + (msg.content.length > 60 ? "…" : ""),
          timestamp: msg.createdAt ?? Date.now(),
          status: "info",
        });
      } else if (msg.role === "assistant") {
        const slug = msg.agentSlug as AgentId | null;
        const mode = msg.agentMode;
        const source: EventSource = slug === "spark" || mode === "spark" ? "spark" : "litt";
        // Display label: "LiTT · Spark Mode responded" or "LiTT responded"
        const agentName = slug ? AGENT_META[slug]?.displayName ?? "LiTT" : "LiTT";
        const modeSuffix = mode && mode !== "standard" ? ` · ${mode === "spark" ? "Spark Mode" : mode.charAt(0).toUpperCase() + mode.slice(1)} Mode` : "";
        const isFailed = msg.status === "failed";
        const isPending = msg.status === "pending" || msg.status === "streaming";
        result.push({
          id: msg.id ?? `a-${msg.createdAt ?? Date.now()}`,
          type: isFailed ? "error" : "agent",
          source,
          category: isFailed ? "error" : "agent",
          label: `${agentName}${modeSuffix} responded`,
          detail: isFailed ? "Response failed" : isPending ? "Generating…" : msg.content.slice(0, 60) + (msg.content.length > 60 ? "…" : ""),
          timestamp: msg.createdAt ?? Date.now(),
          status: isFailed ? "error" : isPending ? "pending" : "success",
        });
      }
    }
    return result.reverse();
  }, [messages]);

  // Visible projection — applies clear/archive/filter/search/scope/retention.
  const visibleEvents = useMemo(() => {
    const now = Date.now();
    let list = events.filter((ev) => {
      if (clearedAt != null && ev.timestamp <= clearedAt) return false;
      if (archivedIds.has(ev.id)) return false;
      if (tlFilter === "litt" && ev.source !== "litt") return false;
      if (tlFilter === "spark" && ev.source !== "spark") return false;
      if (tlFilter === "user" && ev.source !== "user") return false;
      if (tlFilter === "errors" && ev.status !== "error" && ev.category !== "error") return false;
      if (tlFilter === "voice" && ev.category !== "voice") return false;
      if (tlFilter === "missions" && ev.category !== "mission") return false;
      if (tlScope === "session" && ev.timestamp < sessionStart) return false;
      if (hideSystemNoise && ev.source === "system") return false;
      if (onlyUnread && readIds.has(ev.id)) return false;
      if (hideCompleted24h && ev.status === "success" && now - ev.timestamp > DAY_MS) return false;
      if (tlSearch.trim()) {
        const q = tlSearch.toLowerCase();
        const hay = `${ev.label} ${ev.detail ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (pinFailures) {
      const pinned = list.filter((e) => e.status === "error");
      const rest = list.filter((e) => e.status !== "error");
      list = [...pinned, ...rest];
    }
    return list;
  }, [events, clearedAt, archivedIds, tlFilter, tlScope, sessionStart, hideSystemNoise, onlyUnread, readIds, hideCompleted24h, pinFailures, tlSearch]);

  const clearView = () => {
    setClearedAt(Date.now());
    setClearedNotice(true);
  };
  const clearCompleted = () => {
    setArchivedIds((prev) => {
      const next = new Set(prev);
      for (const ev of visibleEvents) {
        if (ev.status === "success") next.add(ev.id);
      }
      return next;
    });
  };
  const markAllRead = () => {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const ev of visibleEvents) next.add(ev.id);
      return next;
    });
  };
  const markRead = (id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

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
    <>
      {/* Mobile overlay backdrop — click to close */}
      <div
        className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm lg:hidden"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="
          fixed right-0 top-0 z-[91] flex h-full flex-col overflow-hidden
          lg:static lg:z-auto lg:h-full lg:shrink-0 lg:border-l
        "
        style={{
          width: "var(--studio-rail-w)",
          maxWidth: "85vw",
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
        <div className="flex items-center gap-2">
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
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-md hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
              aria-label="Hide Activity panel"
              title="Hide Activity"
              data-testid="activity-rail-close"
            >
              <PanelRightClose size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5 studio-scroll">
        {/* Mission Timeline */}
        <Section
          title="Mission Timeline"
          open={timelineOpen}
          onToggle={() => setTimelineOpen((v) => !v)}
          extra={
            events.length > 0 ? (
              <span
                className="rounded-full px-1.5 py-0.5 text-[8px] font-bold"
                style={{
                  color: "var(--text-muted)",
                  backgroundColor: "var(--studio-border)",
                }}
                aria-label={`${visibleEvents.length} visible of ${events.length} total`}
              >
                {visibleEvents.length}/{events.length}
              </span>
            ) : undefined
          }
        >
          {events.length === 0 ? (
            <EmptyHint text="No activity yet. Send a message to start a mission." />
          ) : (
            <div className="flex flex-col gap-2">
              {/* Toolbar — Clear / Clear completed / Collapse / Filter / Search / Mark read / Hide noise */}
              <div className="flex flex-wrap items-center gap-1">
                <ToolBtn
                  icon={Trash2}
                  label="Clear"
                  title="Clear view — system history is preserved"
                  onClick={clearView}
                />
                <ToolBtn
                  icon={CheckCircle2}
                  label="Clear done"
                  title="Clear completed entries from view"
                  onClick={clearCompleted}
                />
                <ToolBtn
                  icon={collapsedAll ? ChevronDown : ChevronRight}
                  label="Collapse"
                  title="Collapse all entries"
                  active={collapsedAll}
                  onClick={() => setCollapsedAll((v) => !v)}
                />
                <ToolBtn
                  icon={Filter}
                  title="Filter"
                  active={tlFilterOpen || tlFilter !== "all"}
                  onClick={() => setTlFilterOpen((v) => !v)}
                />
                <ToolBtn
                  icon={Search}
                  title="Search"
                  active={tlSearchOpen || !!tlSearch}
                  onClick={() => setTlSearchOpen((v) => !v)}
                />
                <ToolBtn
                  icon={Check}
                  title="Mark all read"
                  onClick={markAllRead}
                />
                <ToolBtn
                  icon={EyeOff}
                  title="Hide system noise"
                  active={hideSystemNoise}
                  onClick={() => setHideSystemNoise((v) => !v)}
                />
              </div>

              {/* Search input */}
              {tlSearchOpen && (
                <input
                  type="search"
                  value={tlSearch}
                  onChange={(e) => setTlSearch(e.target.value)}
                  placeholder="Search activity…"
                  aria-label="Search activity"
                  className="w-full rounded-lg border px-2 py-1 text-[10px] outline-none focus:border-[rgba(114,242,56,0.4)]"
                  style={{
                    borderColor: "var(--studio-border)",
                    backgroundColor: "var(--studio-surface)",
                    color: "var(--text-primary)",
                  }}
                />
              )}

              {/* Filter chips */}
              {tlFilterOpen && (
                <div className="flex flex-wrap gap-1" role="group" aria-label="Filter activity">
                  {TIMELINE_FILTERS.map((f) => (
                    <Chip
                      key={f.id}
                      label={f.label}
                      active={tlFilter === f.id}
                      onClick={() => setTlFilter(f.id)}
                    />
                  ))}
                </div>
              )}

              {/* Scope chips */}
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Activity scope">
                <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Scope
                </span>
                {TIMELINE_SCOPES.map((s) => (
                  <Chip
                    key={s.id}
                    label={s.label}
                    active={tlScope === s.id}
                    onClick={() => setTlScope(s.id)}
                  />
                ))}
                <Chip
                  label="Unread only"
                  active={onlyUnread}
                  onClick={() => setOnlyUnread((v) => !v)}
                />
              </div>

              {/* Retention options */}
              <div className="rounded-lg border" style={{ borderColor: "var(--studio-border)" }}>
                <button
                  type="button"
                  onClick={() => setTlRetentionOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-2 py-1 text-[9px] font-bold uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  Retention
                  {tlRetentionOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                </button>
                {tlRetentionOpen && (
                  <div className="flex flex-col gap-1 border-t px-2 py-1.5" style={{ borderColor: "var(--studio-border)" }}>
                    <ToggleRow
                      label="Hide completed after 24h"
                      checked={hideCompleted24h}
                      onChange={() => setHideCompleted24h((v) => !v)}
                    />
                    <ToggleRow
                      label="Auto-collapse older items"
                      checked={autoCollapseOlder}
                      onChange={() => setAutoCollapseOlder((v) => !v)}
                    />
                    <ToggleRow
                      label="Keep failures pinned"
                      checked={pinFailures}
                      onChange={() => setPinFailures((v) => !v)}
                    />
                  </div>
                )}
              </div>

              {/* Cleared notice — confirms system history is preserved */}
              {clearedNotice && (
                <div
                  className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-[9px]"
                  style={{
                    borderColor: "rgba(114,242,56,0.25)",
                    backgroundColor: "rgba(114,242,56,0.06)",
                    color: "var(--litt-primary)",
                  }}
                  role="status"
                >
                  <span>View cleared — persistent system history preserved.</span>
                  <button
                    type="button"
                    onClick={() => setClearedNotice(false)}
                    className="shrink-0 rounded px-1 hover:bg-white/10"
                    aria-label="Dismiss notice"
                  >
                    <XSmall />
                  </button>
                </div>
              )}

              {/* Entries */}
              {visibleEvents.length === 0 ? (
                <EmptyHint text="No entries match the current filters." />
              ) : (
                <div className="flex flex-col gap-1.5">
                  {visibleEvents.map((ev) => {
                    const isOld = Date.now() - ev.timestamp > DAY_MS;
                    const collapsed = collapsedAll || (autoCollapseOlder && isOld);
                    const unread = !readIds.has(ev.id);
                    return (
                      <TimelineEntry
                        key={ev.id}
                        event={ev}
                        collapsed={collapsed}
                        unread={unread}
                        onRead={() => markRead(ev.id)}
                      />
                    );
                  })}
                </div>
              )}
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
    </>
  );
}

/* ── Collapsible Section ────────────────────────────────────────── */
function Section({
  title,
  open,
  onToggle,
  extra,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  extra?: React.ReactNode;
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
        <span className="flex items-center gap-1.5">
          {extra}
          {open ? (
            <ChevronDown size={12} style={{ color: "var(--text-muted)" }} className="pointer-events-none" />
          ) : (
            <ChevronRight size={12} style={{ color: "var(--text-muted)" }} className="pointer-events-none" />
          )}
        </span>
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
function TimelineEntry({
  event,
  collapsed,
  unread,
  onRead,
}: {
  event: ActivityEvent;
  collapsed?: boolean;
  unread?: boolean;
  onRead?: () => void;
}) {
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
    <div
      className="flex items-start gap-2 rounded-md px-1 py-0.5 transition hover:bg-white/5"
      onMouseEnter={onRead}
    >
      <span className="relative mt-1 shrink-0">
        <Icon
          size={12}
          strokeWidth={2}
          style={{ color: cfg.color }}
          className={`pointer-events-none ${event.status === "pending" ? "animate-pulse" : ""}`}
        />
        {unread && (
          <span
            className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: "var(--spark-primary)", boxShadow: "0 0 4px var(--spark-primary)" }}
            aria-label="unread"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-bold truncate" style={{ color: "var(--text-primary)" }}>
            {event.label}
          </span>
          <span className="text-[8px] font-medium shrink-0" style={{ color: "var(--text-muted)" }}>
            {timeStr}
          </span>
        </div>
        {event.detail && !collapsed && (
          <div className="text-[9px] leading-tight truncate" style={{ color: "var(--text-muted)" }}>
            {event.detail}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Toolbar button ─────────────────────────────────────────────── */
function ToolBtn({
  icon: Icon,
  label,
  title,
  active,
  onClick,
}: {
  icon: typeof Filter;
  label?: string;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className="flex items-center gap-1 rounded-md border px-1.5 py-1 text-[9px] font-bold transition hover:bg-white/8"
      style={{
        borderColor: active ? "rgba(114,242,56,0.35)" : "var(--studio-border)",
        backgroundColor: active ? "rgba(114,242,56,0.08)" : "transparent",
        color: active ? "var(--litt-primary)" : "var(--text-secondary)",
      }}
    >
      <Icon size={11} className="pointer-events-none" />
      {label && <span>{label}</span>}
    </button>
  );
}

/* ── Filter chip ────────────────────────────────────────────────── */
function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full border px-2 py-0.5 text-[9px] font-bold transition hover:bg-white/8"
      style={{
        borderColor: active ? "rgba(114,242,56,0.4)" : "var(--studio-border)",
        backgroundColor: active ? "rgba(114,242,56,0.1)" : "transparent",
        color: active ? "var(--litt-primary)" : "var(--text-muted)",
      }}
    >
      {label}
    </button>
  );
}

/* ── Toggle row ─────────────────────────────────────────────────── */
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 text-[9px]" style={{ color: "var(--text-secondary)" }}>
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className="relative h-3.5 w-6 shrink-0 rounded-full transition"
        style={{ backgroundColor: checked ? "var(--litt-primary)" : "var(--studio-border)" }}
      >
        <span
          className="absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all"
          style={{ left: checked ? "calc(100% - 12px)" : "2px" }}
        />
      </button>
    </label>
  );
}

/* ── Small X (inline SVG — avoids lucide version gaps) ──────────── */
function XSmall() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
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
