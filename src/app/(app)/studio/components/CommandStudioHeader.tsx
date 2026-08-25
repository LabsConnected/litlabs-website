"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import StudioProjectPicker from "./StudioProjectPicker";
import {
  useStudioModelStore,
  type ProviderHealth,
} from "../stores/useStudioModelStore";
import {
  ChevronDown,
  Eye,
  Rocket,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Bell,
  Bot,
  PanelRightOpen,
  Activity,
  MoreHorizontal,
  Plus,
  Terminal,
  Trash2,
  Edit2,
  Download,
  Eraser,
  Settings,
  Check,
} from "lucide-react";
import { OwnerTestModeIndicator } from "@/components/OwnerTestModeIndicator";

const HEALTH_DOT: Record<ProviderHealth, { color: string; label: string }> = {
  available: { color: "#72f238", label: "Available" },
  degraded: { color: "#e3b341", label: "Degraded" },
  unavailable: { color: "#ef4444", label: "Unavailable" },
  locked: { color: "#6f7485", label: "Not configured" },
};

/**
 * CommandStudioHeader — one compact header (~46px).
 *
 * Replaces the stacked permanent rows (AutonomicLoopBanner + StudioTopBar).
 * Everything that used to be a permanent status chip — provider connections,
 * selected model, fallback, repository, PTY, write permission, pipeline
 * health, wallet, environment — collapses into a single Workspace Status
 * popover triggered by the status pill on the left.
 *
 * No fake readiness or health is ever displayed.
 */
export default function CommandStudioHeader({
  branch,
  onPreviewAction,
  onOpenActivityAction,
  activityVisible = false,
  onOpenTerminalAction,
  onOpenInspectorAction,
  onProjectSelectAction,
  onClearChatAction,
  onNewChatAction,
  onDeleteChatAction,
  onRenameChatAction,
  onExportChatAction,
  hasConversation,
  projectReady,
  capabilities,
  busy = false,
  executionMode = "auto",
  onExecutionModeChange,
}: {
  branch?: string;
  onPreviewAction?: () => void;
  /** Opens LiTT -> Live (execution activity). This is an OPEN action,
   *  not a toggle — clicking it always ensures Live is visible. */
  onOpenActivityAction?: () => void;
  /** Truthful: LiTT -> Live is actually visible right now (expanded on
   *  desktop/laptop, or the mobile sheet open, AND the Live tab active).
   *  Used only for styling — it does not gate the click handler. */
  activityVisible?: boolean;
  onOpenTerminalAction?: () => void;
  onOpenInspectorAction?: () => void;
  onProjectSelectAction?: (projectId: string) => void;
  onClearChatAction?: () => void;
  onNewChatAction?: () => void;
  onDeleteChatAction?: () => void;
  onRenameChatAction?: () => void;
  onExportChatAction?: () => void;
  hasConversation?: boolean;
  projectReady?: boolean;
  capabilities: import("../hooks/useConnectionSummary").ConnectionCapabilities;
  /** True while an agent/conversation turn is in flight. */
  busy?: boolean;
  /** Execution mode — shown as AUTO ▾ dropdown in the top bar. */
  executionMode?: "plan" | "act" | "auto";
  onExecutionModeChange?: (mode: "plan" | "act" | "auto") => void;
}) {
  const { balance, isLoading: walletLoading } = useWallet();
  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const fallbackNotice = useStudioModelStore((s) => s.fallbackNotice);
  const providerHealth = useStudioModelStore((s) => s.providerHealth);

  const [statusOpen, setStatusOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [notifCount, setNotifCount] = useState<number | null>(null);
  const statusTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const modeTriggerRef = useRef<HTMLButtonElement>(null);
  const [statusRect, setStatusRect] = useState<DOMRect | null>(null);
  const [overflowRect, setOverflowRect] = useState<DOMRect | null>(null);
  const [modeRect, setModeRect] = useState<DOMRect | null>(null);

  const updateRect = useCallback(() => {
    if (statusTriggerRef.current) {
      setStatusRect(statusTriggerRef.current.getBoundingClientRect());
    }
    if (overflowTriggerRef.current) {
      setOverflowRect(overflowTriggerRef.current.getBoundingClientRect());
    }
    if (modeTriggerRef.current) {
      setModeRect(modeTriggerRef.current.getBoundingClientRect());
    }
  }, []);

  // Poll unread notification count (truthful; falls back to null on error).
  useEffect(() => {
    let cancelled = false;
    const fetchNotifs = async () => {
      try {
        const res = await fetch("/api/notifications/count", { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setNotifCount(typeof data.count === "number" ? data.count : null);
      } catch {
        if (!cancelled) setNotifCount(null);
      }
    };
    void fetchNotifs();
    const id = window.setInterval(fetchNotifs, 45_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!statusOpen && !overflowOpen && !modeOpen) return;
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [statusOpen, overflowOpen, modeOpen, updateRect]);

  const repoConnected = capabilities.repository === "connected";
  const ptyAvailable = capabilities.terminalExecution === "available";
  const ptyIdle = capabilities.terminalExecution === "idle";
  const writesAllowed = capabilities.writeAccess;
  const modelHealth = providerHealth[selectedModel.provider] ?? "available";
  const hasAi = modelHealth === "available" || modelHealth === "degraded";
  const providerCount = hasAi ? 1 : 0;

  // Truthful aggregate status — calculated from actual capabilities AND
  // the real workspace readiness state. "Workspace available" requires
  // the selected project's workspace to be verified ready (projectReady),
  // not merely that repo/terminal capabilities exist.
  // "idle" (server online, no session) counts as having a project —
  // the terminal is ready to connect on demand.
  const hasProject = repoConnected || ptyAvailable || ptyIdle;
  const workspaceReady = Boolean(projectReady);
  const statusColor = workspaceReady && hasAi
    ? "var(--litt-primary)"
    : workspaceReady
      ? "#e3b341"
      : hasProject && hasAi
        ? "#e3b341"
        : hasAi
          ? "var(--litt-primary)"
          : "var(--text-muted)";
  const statusLabel = workspaceReady && hasAi
    ? "Workspace available"
    : workspaceReady
      ? "AI setup required"
      : hasProject && hasAi
        ? "Preparing workspace…"
        : hasAi
          ? "Chat ready"
          : "Chat unavailable";

  return (
    <header
      className="glass-shell flex shrink-0 items-center gap-1.5 sm:gap-2 overflow-hidden whitespace-nowrap border-b px-3 sm:px-4"
      style={{
        height: "var(--studio-header-h)",
        backgroundColor: "rgba(13,9,22,0.88)",
        borderColor: "rgba(155,77,255,0.12)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(155,77,255,0.04)",
      }}
      data-testid="studio-header"
    >
      {/* Brand logo removed — AppShell sidebar already establishes brand identity.
          Studio header focuses on project, branch, workspace status, and actions. */}

      <StudioProjectPicker
        projectId={capabilities.projectId}
        projectName={capabilities.projectName}
        onSelect={(projectId) => onProjectSelectAction?.(projectId)}
      />

      {/* Workspace status dot — compact indicator only, no popover.
          The full status detail lives in the overflow menu (⋯). */}
      <span
        className="hidden sm:flex shrink-0 items-center gap-1"
        title={statusLabel}
        aria-label={statusLabel}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          aria-hidden
          style={{ backgroundColor: statusColor, boxShadow: `0 0 4px ${statusColor}` }}
        />
      </span>

      {/* Execution mode dropdown — AUTO ▾ / PLAN ▾ / ACT ▾
          Moved from the composer to the top bar so it's always visible. */}
      {onExecutionModeChange && (
        <button
          ref={modeTriggerRef}
          type="button"
          onClick={() => setModeOpen((v) => !v)}
          className="glass-chip flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-[11px] font-black transition-all hover:bg-white/5 active:scale-95"
          style={{
            color: executionMode === "auto"
              ? "var(--litt-primary)"
              : executionMode === "plan"
                ? "#3b82f6"
                : "var(--spark-primary)",
            backgroundColor: executionMode === "auto"
              ? "rgba(114,242,56,0.08)"
              : executionMode === "plan"
                ? "rgba(59,130,246,0.10)"
                : "rgba(155,77,255,0.10)",
            borderColor: executionMode === "auto"
              ? "rgba(114,242,56,0.28)"
              : executionMode === "plan"
                ? "rgba(59,130,246,0.28)"
                : "rgba(155,77,255,0.28)",
          }}
          aria-label={`Execution mode: ${executionMode.toUpperCase()}`}
          aria-expanded={Boolean(modeOpen)}
          title={
            executionMode === "auto"
              ? "Auto — work autonomously until complete"
              : executionMode === "plan"
                ? "Plan — inspect and plan without making changes"
                : "Act — make changes and run commands"
          }
          data-testid="execution-mode-trigger"
        >
          <span className="pointer-events-none">{executionMode.toUpperCase()}</span>
          <ChevronDown size={10} className="pointer-events-none" style={{ color: "var(--text-muted)" }} />
        </button>
      )}
      {modeOpen && modeRect && onExecutionModeChange &&
        createPortal(
          <ExecutionModePopover
            rect={modeRect}
            currentMode={executionMode}
            onSelect={(mode) => { onExecutionModeChange(mode); setModeOpen(false); }}
            onClose={() => setModeOpen(false)}
          />,
          document.body,
        )}

      {/* Agent-active indicator — truthful: only while a turn is in flight */}
      {busy && (
        <span
          className="hidden sm:inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-bold"
          style={{
            borderColor: "rgba(167,139,250,0.3)",
            color: "#a78bfa",
            backgroundColor: "rgba(167,139,250,0.08)",
          }}
          title="An agent is working"
          data-testid="agent-active-pill"
        >
          <Bot size={10} className="pointer-events-none" />
          <span className="pointer-events-none">Agent working</span>
          <span
            className="h-1.5 w-1.5 rounded-full animate-pulse"
            aria-hidden
            style={{ backgroundColor: "#a78bfa" }}
          />
        </span>
      )}

      <div className="flex-1" />

      {/* Conversation controls — always visible instead of being hidden in slash commands. */}
      <button
        type="button"
        onClick={onNewChatAction}
        disabled={busy}
        className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold transition-all hover:bg-white/5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          borderColor: "rgba(114,242,56,0.28)",
          color: "var(--litt-primary)",
          backgroundColor: "rgba(114,242,56,0.06)",
        }}
        aria-label="New chat"
        title="Start a new chat"
      >
        <Plus size={12} aria-hidden />
        <span className="hidden sm:inline">New Chat</span>
      </button>

      {/* Notifications — wired to /api/notifications/count */}
      <Link
        href="/dashboard"
        className="relative grid h-8 w-8 sm:h-7 sm:w-7 shrink-0 place-items-center rounded-md transition-all hover:bg-white/10"
        style={{ color: "var(--text-secondary)" }}
        aria-label={`Notifications${notifCount ? ` (${notifCount} unread)` : ""}`}
        title="Notifications"
      >
        <Bell size={14} />
        {notifCount ? (
          <span
            className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full px-1 text-[8px] font-black"
            style={{ backgroundColor: "#ff00a0", color: "#fff" }}
          >
            {notifCount > 99 ? "99+" : notifCount}
          </span>
        ) : null}
      </Link>

      {/* Deploy button — primary gradient action, disabled when no project */}
      <button
        type="button"
        disabled={!projectReady}
        onClick={onPreviewAction}
        className="hidden sm:flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-black transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
        style={{
          background: projectReady
            ? "linear-gradient(135deg, var(--spark-primary), var(--violet-accent))"
            : "var(--studio-surface)",
          color: projectReady ? "#fff" : "var(--text-muted)",
          border: "1px solid rgba(155,77,255,0.4)",
          boxShadow: projectReady ? "var(--studio-glow-purple)" : "none",
        }}
        title={projectReady ? "Preview / Deploy project" : "No project to deploy"}
        aria-label="Deploy"
      >
        <Rocket size={11} className="pointer-events-none" />
        <span className="pointer-events-none">Deploy</span>
      </button>

      <button
        type="button"
        onClick={onOpenInspectorAction}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md border transition-all hover:bg-white/5 active:scale-95"
        style={{ borderColor: "var(--studio-border)", color: "var(--text-secondary)", backgroundColor: "var(--studio-surface)" }}
        title="Workspace inspector"
        aria-label="Open workspace inspector"
      >
        <PanelRightOpen size={13} className="pointer-events-none" />
      </button>

      {/* Activity — opens LiTT -> Live. This is an OPEN action: clicking
          it always ensures Live is visible (expands LiTT if collapsed
          on desktop/laptop, or opens the mobile sheet on mobile). It
          does not collapse/hide LiTT — use the LiTT panel's own
          collapse control for that. */}
      <button
        type="button"
        onClick={onOpenActivityAction}
        aria-label="Open Activity"
        title="Open Activity"
        data-testid="activity-toggle"
        data-active={activityVisible}
        className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold transition-all hover:bg-white/5 active:scale-95"
        style={{
          borderColor: activityVisible
            ? "rgba(155,77,255,.45)"
            : "var(--studio-border)",
          backgroundColor: activityVisible
            ? "rgba(155,77,255,.12)"
            : "var(--studio-surface)",
          color: activityVisible
            ? "var(--spark-primary)"
            : "var(--text-secondary)",
        }}
      >
        <Activity size={13} className="pointer-events-none" />
        <span className="hidden xl:inline pointer-events-none">
          Activity
        </span>
      </button>

      {/* Overflow menu — Preview + Deploy + Settings collapsed here */}
      <button
        ref={overflowTriggerRef}
        type="button"
        onClick={() => setOverflowOpen((v) => !v)}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md transition-all hover:bg-white/10"
        style={{ color: "var(--text-muted)" }}
        aria-label="More actions"
        aria-expanded={Boolean(overflowOpen)}
        title="More"
      >
        <MoreHorizontal size={14} />
      </button>
      {overflowOpen && overflowRect &&
        createPortal(
          <OverflowMenu
            rect={overflowRect}
            onClose={() => setOverflowOpen(false)}
            onPreviewAction={onPreviewAction}
            onNewChatAction={onNewChatAction}
            onClearChatAction={onClearChatAction}
            onDeleteChatAction={onDeleteChatAction}
            onRenameChatAction={onRenameChatAction}
            onExportChatAction={onExportChatAction}
            hasConversation={Boolean(hasConversation)}
            previewDisabled={!projectReady}
            busy={busy}
            settingsHref={`/settings?returnTo=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/studio")}`}
          />,
          document.body,
        )}

      {/* Owner / test-role selector — inline in the header action cluster.
          Self-hides for non-owners, so it adds zero clutter for regular users.
          Treated as session/account context (not a chat action). */}
      <OwnerTestModeIndicator placement="inline" />

      {/* Clerk UserButton removed — account/profile/settings are now accessed
          through the unified AppShell sidebar (Wallet, Settings, Profile). */}
    </header>
  );
}

/* ── Workspace Status popover ─────────────────────────────────── */
function StatusRow({
  label,
  value,
  ok,
  warn,
  detail,
}: {
  label: string;
  value: string;
  ok?: boolean;
  warn?: boolean;
  detail?: string;
}) {
  const Icon = ok ? CircleCheck : warn ? CircleAlert : CircleDot;
  const color = ok ? "var(--litt-primary)" : warn ? "#e3b341" : "var(--text-muted)";
  return (
    <div className="flex items-start gap-2.5 px-3 py-2">
      <Icon size={13} className="mt-0.5 shrink-0" style={{ color }} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          {label}
        </div>
        <div className="text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>
          {value}
        </div>
        {detail && (
          <div className="text-[10px] leading-tight" style={{ color: "var(--text-secondary)" }}>
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceStatusPopover({
  rect,
  onClose,
  onOpenTerminalAction,
  providerCount,
  repoConnected,
  repoName,
  ptyState,
  writesAllowed,
  modelLabel,
  modelHealth,
  fallbackNotice,
  walletBalance,
  connectionSummary,
}: {
  rect: DOMRect;
  onClose: () => void;
  onOpenTerminalAction?: () => void;
  providerCount: number;
  repoConnected: boolean;
  repoName: string | null;
  ptyState: string;
  writesAllowed: boolean;
  modelLabel: string;
  modelHealth: ProviderHealth;
  fallbackNotice: string | null;
  walletBalance: number | null;
  connectionSummary: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const ptyLabel =
    ptyState === "available" ? "Connected" :
    ptyState === "connecting" ? "Connecting…" :
    ptyState === "idle" ? "Ready · no session" :
    ptyState === "error" ? "Error" : "Disconnected";

  const left = Math.min(rect.left, window.innerWidth - 320);
  const top = rect.bottom + 6;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Workspace status"
      className="fixed z-[200] w-80 overflow-hidden rounded-xl border shadow-2xl"
      style={{
        left,
        top,
        backgroundColor: "var(--studio-elevated)",
        borderColor: "var(--studio-border-strong)",
      }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--studio-border)" }}
      >
        <span className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-secondary)" }}>
          Workspace status
        </span>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor: providerCount ? "var(--litt-primary)" : "var(--text-muted)",
            boxShadow: providerCount ? `0 0 4px var(--litt-primary)` : "none",
          }}
          aria-hidden
        />
      </div>
      <div className="max-h-[60dvh] overflow-y-auto divide-y" style={{ borderColor: "var(--studio-border)" }}>
        <StatusRow
          label="AI Providers"
          value={providerCount ? `${providerCount} connected` : "None connected"}
          ok={providerCount > 0}
          warn={providerCount === 0}
          detail={connectionSummary}
        />
        <StatusRow
          label="Selected Model"
          value={modelLabel}
          ok={modelHealth === "available"}
          warn={modelHealth === "degraded" || modelHealth === "locked"}
          detail={fallbackNotice ?? HEALTH_DOT[modelHealth].label}
        />
        <StatusRow
          label="Repository"
          value={repoConnected ? (repoName ?? "Connected") : "Not connected"}
          ok={repoConnected}
          warn={!repoConnected}
          detail={repoConnected ? "GitHub repository linked" : "Connect GitHub to enable files, code, and preview"}
        />
        <StatusRow
          label="Terminal (PTY)"
          value={ptyLabel}
          ok={ptyState === "available" || ptyState === "idle"}
          warn={ptyState === "connecting"}
          detail={ptyState === "available" ? "Ready for command execution" : ptyState === "idle" ? "Server online — open terminal to start a session" : "Open the terminal drawer to connect"}
        />
        {ptyState !== "available" && onOpenTerminalAction && (
          <div className="px-3 py-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenTerminalAction();
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-bold transition hover:bg-white/5"
              style={{
                borderColor: "rgba(114,242,56,0.28)",
                color: "var(--litt-primary)",
                backgroundColor: "rgba(114,242,56,0.06)",
              }}
            >
              <Terminal size={12} aria-hidden />
              Open Terminal & Connect
            </button>
          </div>
        )}
        <StatusRow
          label="Write Permission"
          value={writesAllowed ? "Writes allowed" : "Writes require approval"}
          ok={writesAllowed}
          warn={!writesAllowed}
          detail={writesAllowed ? "File writes apply without approval" : "Approvals required before applying edits"}
        />
        <StatusRow
          label="Wallet"
          value={walletBalance === null ? "—" : `${walletBalance.toLocaleString()} LBC`}
          ok={walletBalance !== null && walletBalance > 0}
          detail="AI credits balance"
        />
        <StatusRow
          label="Environment"
          value={typeof window !== "undefined" ? (window.location.hostname) : "local"}
          detail="Current deployment environment"
        />
      </div>
    </div>
  );
}

/* ── Execution mode popover ────────────────────────────────────── */
function ExecutionModePopover({
  rect,
  currentMode,
  onSelect,
  onClose,
}: {
  rect: DOMRect;
  currentMode: "plan" | "act" | "auto";
  onSelect: (mode: "plan" | "act" | "auto") => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const modes: { id: "plan" | "act" | "auto"; label: string; desc: string; color: string }[] = [
    { id: "auto", label: "AUTO", desc: "Work autonomously until complete", color: "var(--litt-primary)" },
    { id: "plan", label: "PLAN", desc: "Inspect and plan without making changes", color: "#3b82f6" },
    { id: "act", label: "ACT", desc: "Make changes and run commands", color: "var(--spark-primary)" },
  ];

  const left = Math.min(rect.left, window.innerWidth - 220);
  const top = rect.bottom + 6;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Execution mode"
      className="fixed z-[200] w-52 overflow-hidden rounded-xl border shadow-2xl"
      style={{
        left,
        top,
        backgroundColor: "var(--studio-elevated)",
        borderColor: "var(--studio-border-strong)",
      }}
    >
      <div className="py-1">
        {modes.map((m) => {
          const isActive = currentMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(m.id)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-white/5"
              style={{ backgroundColor: isActive ? "rgba(255,255,255,0.03)" : "transparent" }}
            >
              {isActive && <Check size={12} className="shrink-0" style={{ color: m.color }} />}
              {!isActive && <span className="w-3 shrink-0" />}
              <div className="min-w-0">
                <div className="text-[11px] font-black" style={{ color: isActive ? m.color : "var(--text-primary)" }}>
                  {m.label}
                </div>
                <div className="text-[10px] leading-tight" style={{ color: "var(--text-muted)" }}>
                  {m.desc}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Overflow menu — Conversation actions + Preview + Settings ──── */
function OverflowMenu({
  rect,
  onClose,
  onPreviewAction,
  onNewChatAction,
  onClearChatAction,
  onDeleteChatAction,
  onRenameChatAction,
  onExportChatAction,
  hasConversation,
  previewDisabled,
  busy,
  settingsHref,
}: {
  rect: DOMRect;
  onClose: () => void;
  onPreviewAction?: () => void;
  onNewChatAction?: () => void;
  onClearChatAction?: () => void;
  onDeleteChatAction?: () => void;
  onRenameChatAction?: () => void;
  onExportChatAction?: () => void;
  hasConversation: boolean;
  previewDisabled: boolean;
  busy: boolean;
  settingsHref: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const top = rect.bottom + 6;
  const right = window.innerWidth - rect.right;
  const disabled = !hasConversation || busy;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Conversation menu"
      className="fixed z-[200] w-52 overflow-hidden rounded-xl border shadow-2xl"
      style={{
        top,
        right,
        backgroundColor: "var(--studio-elevated)",
        borderColor: "var(--studio-border-strong)",
      }}
    >
      {/* Section: Conversation */}
      <div className="px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-[.16em]" style={{ color: "var(--text-muted)" }}>
        Conversation
      </div>
      <button
        type="button"
        onClick={() => { onClose(); onNewChatAction?.(); }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] font-bold transition-colors hover:bg-white/5"
        style={{ color: "var(--text-primary)" }}
      >
        <Plus size={13} className="pointer-events-none" style={{ color: "var(--litt-primary)" }} />
        New Chat
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { onClose(); onRenameChatAction?.(); }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] font-bold transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
        style={{ color: "var(--text-primary)" }}
      >
        <Edit2 size={13} className="pointer-events-none" style={{ color: "var(--text-secondary)" }} />
        Rename
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { onClose(); onExportChatAction?.(); }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] font-bold transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
        style={{ color: "var(--text-primary)" }}
      >
        <Download size={13} className="pointer-events-none" style={{ color: "var(--text-secondary)" }} />
        Export
      </button>
      <div className="h-px mx-3" style={{ backgroundColor: "var(--studio-border)" }} />
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!window.confirm("Clear all messages from this conversation? The conversation will remain, but its visible message history will be removed.")) return;
          onClose();
          onClearChatAction?.();
        }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] font-bold transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
        style={{ color: "var(--text-primary)" }}
      >
        <Eraser size={13} className="pointer-events-none" style={{ color: "#e3b341" }} />
        Clear Messages
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!window.confirm("Delete this conversation? This removes it from your chat list. Project files, Missions, and audit history will remain.")) return;
          onClose();
          onDeleteChatAction?.();
        }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] font-bold transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-30"
        style={{ color: "#f87171" }}
      >
        <Trash2 size={13} className="pointer-events-none" />
        Delete Conversation
      </button>

      {/* Section: Workspace */}
      <div className="h-px" style={{ backgroundColor: "var(--studio-border)" }} />
      <div className="px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-[.16em]" style={{ color: "var(--text-muted)" }}>
        Workspace
      </div>
      <button
        type="button"
        disabled={previewDisabled}
        onClick={() => { onClose(); onPreviewAction?.(); }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] font-bold transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ color: "var(--text-primary)" }}
      >
        <Eye size={13} className="pointer-events-none" style={{ color: "var(--text-secondary)" }} />
        Preview
      </button>
      <div className="h-px" style={{ backgroundColor: "var(--studio-border)" }} />
      <Link
        href={settingsHref}
        onClick={onClose}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] font-bold transition-colors hover:bg-white/5"
        style={{ color: "var(--text-primary)" }}
      >
        <Settings size={13} className="pointer-events-none" style={{ color: "var(--text-secondary)" }} />
        Settings
      </Link>
    </div>
  );
}
