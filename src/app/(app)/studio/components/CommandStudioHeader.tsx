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
  Eye,
  Rocket,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Bell,
  PanelBottom,
  MoreHorizontal,
  Plus,
  Terminal,
  Trash2,
  Edit2,
  Download,
  Eraser,
  Settings,
} from "lucide-react";
import { OwnerTestModeIndicator } from "@/components/OwnerTestModeIndicator";
import {
  runtimePhaseLabel,
  type ProjectRuntimeState,
} from "@/lib/projects/runtime-state";

const HEALTH_DOT: Record<ProviderHealth, { color: string; label: string }> = {
  available: { color: "#72f238", label: "Available" },
  degraded: { color: "#e3b341", label: "Degraded" },
  unavailable: { color: "#ef4444", label: "Unavailable" },
  locked: { color: "#6f7485", label: "Not configured" },
};

export type StudioTopBarMode = "plan" | "act" | "auto";
export type StudioTopBarDockTab = "activity" | "files" | "terminal" | "inspector" | "media";

const MODE_META: { id: StudioTopBarMode; label: string; desc: string; color: string; tint: string; border: string }[] = [
  { id: "plan", label: "PLAN", desc: "Inspect and explain; do not change files", color: "#3b82f6", tint: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.35)" },
  { id: "act", label: "ACT", desc: "Make changes; approvals may be required", color: "#8b5cf6", tint: "rgba(139,92,246,0.12)", border: "rgba(139,92,246,0.35)" },
  { id: "auto", label: "AUTO", desc: "LiTT chooses when to plan and when to act", color: "#22d3ee", tint: "rgba(34,211,238,0.10)", border: "rgba(34,211,238,0.32)" },
];

/**
 * CommandStudioHeader — the single top command bar (52px).
 *
 * One bar owns: brand + project switcher · segmented PLAN/ACT/AUTO ·
 * truthful agent-status pill (idle / working / approval needed) · preview
 * quick action · dock toggle · overflow. The old 15-control header, the
 * permanent mode-description strip, and the separate Activity/Tools/
 * Terminal/Inspector buttons are gone — secondary surfaces live in the
 * dock. Visual redesign only: every behavior is preserved.
 *
 * No fake readiness or health is ever displayed.
 */
export default function CommandStudioHeader({
  onPreviewAction,
  onToggleDockAction,
  onOpenDockTabAction,
  dockOpen = false,
  onProjectSelectAction,
  onCreateProjectAction,
  onDeleteProjectAction,
  onProjectRenamedAction,
  onDeployAction,
  onClearChatAction,
  onNewChatAction,
  onDeleteChatAction,
  onRenameChatAction,
  onExportChatAction,
  hasConversation,
  runtime,
  runtimeLoading,
  mutationActionsAllowed = false,
  capabilities,
  busy = false,
  approvalPending = false,
  executionMode = "auto",
  onExecutionModeChange,
}: {
  onPreviewAction?: () => void;
  /** Toggles the bottom dock (Activity/Files/Terminal/Inspector/Media). */
  onToggleDockAction?: () => void;
  /** Opens the dock on a specific tab (used by the status popover + overflow menu). */
  onOpenDockTabAction?: (tab: StudioTopBarDockTab) => void;
  dockOpen?: boolean;
  onProjectSelectAction?: (projectId: string) => void;
  /** Creates a new blank project (picker "+ New project" entry). */
  onCreateProjectAction?: () => void;
  /**
   * Fired after the project switcher confirms a server-side project
   * deletion. The parent clears the active project when it matches.
   */
  onDeleteProjectAction?: (projectId: string) => void;
  onProjectRenamedAction?: (projectId: string, name: string) => void;
  /** Prefills the chat composer with a deploy request (real deploy runs through LiTT). */
  onDeployAction?: () => void;
  onClearChatAction?: () => void;
  onNewChatAction?: () => void;
  onDeleteChatAction?: () => void;
  onRenameChatAction?: () => void;
  onExportChatAction?: () => void;
  hasConversation?: boolean;
  runtime: ProjectRuntimeState;
  runtimeLoading: boolean;
  mutationActionsAllowed?: boolean;
  capabilities: import("../hooks/useConnectionSummary").ConnectionCapabilities;
  /** True while an agent/conversation turn is in flight. */
  busy?: boolean;
  /** True while an approval gate is waiting on the user. */
  approvalPending?: boolean;
  /** Execution mode — shown as a segmented PLAN/ACT/AUTO control. */
  executionMode?: StudioTopBarMode;
  onExecutionModeChange?: (mode: StudioTopBarMode) => void;
}) {
  const { balance, isLoading: walletLoading } = useWallet();
  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const fallbackNotice = useStudioModelStore((s) => s.fallbackNotice);
  const providerHealth = useStudioModelStore((s) => s.providerHealth);

  const [statusOpen, setStatusOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [notifCount, setNotifCount] = useState<number | null>(null);
  const statusTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const [statusRect, setStatusRect] = useState<DOMRect | null>(null);
  const [overflowRect, setOverflowRect] = useState<DOMRect | null>(null);

  const updateRect = useCallback(() => {
    if (statusTriggerRef.current) {
      setStatusRect(statusTriggerRef.current.getBoundingClientRect());
    }
    if (overflowTriggerRef.current) {
      setOverflowRect(overflowTriggerRef.current.getBoundingClientRect());
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
    if (!statusOpen && !overflowOpen) return;
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [statusOpen, overflowOpen, updateRect]);

  const writesAllowed = capabilities.writeAccess;
  const modelHealth = providerHealth[selectedModel.provider]
    ?? providerHealth[selectedModel.apiProvider ?? ""];
  const hasAi = modelHealth === "available" || modelHealth === "degraded";
  const providerCount = hasAi ? 1 : 0;

  const runtimeReady = runtime.phase === "ready" && runtime.executionAvailable;
  const statusLabel = runtimeLoading || runtime.phase === "resolving"
    ? "Runtime status checking"
    : runtime.phase === "idle" || !runtime.projectId
      ? "No project selected"
      : runtime.phase !== "ready"
        ? runtimePhaseLabel(runtime.phase)
        : modelHealth === undefined
          ? "Runtime status checking"
          : !hasAi
            ? "AI provider unavailable"
            : modelHealth === "available"
              ? "Runtime verified"
              : "Runtime verified · provider degraded";
  const statusColor = statusLabel === "Runtime verified"
    ? "#22d3ee"
    : runtimeLoading || modelHealth === undefined
      ? "#e3b341"
      : runtime.phase === "error" || runtime.phase === "unauthenticated" || modelHealth === "unavailable"
        ? "#ef4444"
        : "#e3b341";

  // Status pill: approval gates and agent work take precedence over the
  // ambient runtime label — both are truthful, derived from live state.
  const pill = approvalPending
    ? { label: "Approval needed", short: "Approval", color: "#e3b341", pulse: true }
    : busy
      ? { label: "Agent working", short: "Working", color: "#22d3ee", pulse: true }
      : {
          label: statusLabel,
          short: statusLabel === "Runtime verified" ? "Ready"
            : statusLabel === "Runtime verified · provider degraded" ? "Degraded"
            : statusLabel === "Runtime status checking" ? "Checking"
            : statusLabel === "No project selected" ? "No project"
            : statusLabel === "AI provider unavailable" ? "No AI"
            : statusLabel,
          color: statusColor,
          pulse: false,
        };

  return (
    <header
      className="no-scrollbar flex h-[52px] shrink-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden whitespace-nowrap border-b px-3 sm:gap-2 sm:px-4 sm:overflow-hidden"
      style={{
        backgroundColor: "#0d0916",
        borderColor: "rgba(255,255,255,0.07)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
      }}
      data-testid="studio-header"
    >
      {/* Brand */}
      <div className="flex shrink-0 items-center gap-2 pr-1" data-testid="studio-brand">
        <div
          className="grid h-7 w-7 place-items-center rounded-lg"
          style={{
            background: "linear-gradient(135deg, rgba(34,211,238,0.25), rgba(139,92,246,0.18))",
            border: "1px solid rgba(34,211,238,0.35)",
            boxShadow: "0 0 12px rgba(34,211,238,0.25)",
          }}
          aria-hidden="true"
        >
          <span className="text-[11px] font-black" style={{ color: "#22d3ee" }}>L</span>
        </div>
        <span className="hidden text-[13px] font-bold tracking-tight text-white md:inline">
          LiTT <span style={{ color: "#22d3ee" }}>Studio</span>
        </span>
      </div>

      <StudioProjectPicker
        projectId={capabilities.projectId}
        projectName={capabilities.projectName}
        onSelect={(projectId) => onProjectSelectAction?.(projectId)}
        onCreateProject={() => onCreateProjectAction?.()}
        onDeleteProject={(projectId) => onDeleteProjectAction?.(projectId)}
        onProjectRenamed={(projectId, name) => onProjectRenamedAction?.(projectId, name)}
      />

      {/* Agent-status pill — truthful: working / approval needed / ambient runtime.
          Clicking opens the full workspace-status popover. */}
      <button
        ref={statusTriggerRef}
        type="button"
        onClick={() => setStatusOpen((v) => !v)}
        className="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-all hover:bg-white/5 active:scale-95"
        style={{
          borderColor: `${pill.color}45`,
          backgroundColor: `${pill.color}0f`,
          color: pill.color,
        }}
        aria-label={pill.label}
        aria-expanded={statusOpen}
        title={pill.label}
        data-testid="agent-status-pill"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${pill.pulse ? "animate-pulse" : ""}`}
          aria-hidden
          style={{ backgroundColor: pill.color, boxShadow: `0 0 6px ${pill.color}` }}
        />
        <span className="hidden sm:inline">{pill.short}</span>
      </button>
      {statusOpen && statusRect &&
        createPortal(
          <WorkspaceStatusPopover
            rect={statusRect}
            onClose={() => setStatusOpen(false)}
            onOpenTerminalAction={() => onOpenDockTabAction?.("terminal")}
            providerCount={providerCount}
            repoConnected={capabilities.repository === "connected"}
            repoName={capabilities.repositoryName}
            ptyState={capabilities.terminalStatus}
            writesAllowed={writesAllowed}
            modelLabel={selectedModel.label}
            modelHealth={modelHealth}
            fallbackNotice={fallbackNotice}
            walletBalance={walletLoading ? null : balance}
            connectionSummary={capabilities.connectionSummary}
          />,
          document.body,
        )}

      <div className="flex-1" />

      {/* Preview quick action — only when the runtime is actually verified. */}
      {mutationActionsAllowed && runtimeReady && (
        <button
          type="button"
          onClick={onPreviewAction}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-all active:scale-95 sm:flex"
          style={{
            background: "linear-gradient(135deg, rgba(34,211,238,0.9), rgba(59,130,246,0.9))",
            color: "#04121a",
            boxShadow: "0 0 14px rgba(34,211,238,0.35)",
          }}
          title="Open the live preview"
          aria-label="Preview"
          data-testid="preview-quick-action"
        >
          <Eye size={12} className="pointer-events-none" />
          <span className="pointer-events-none">Preview</span>
        </button>
      )}

      {/* New chat */}
      <button
        type="button"
        onClick={onNewChatAction}
        disabled={busy}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-bold transition-all hover:bg-white/5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          borderColor: "rgba(34,211,238,0.30)",
          color: "#22d3ee",
          backgroundColor: "rgba(34,211,238,0.06)",
        }}
        aria-label="New chat"
        title="Start a new chat"
      >
        <Plus size={13} aria-hidden />
        <span className="hidden lg:inline">New Chat</span>
      </button>

      {/* Notifications — wired to /api/notifications/count */}
      <Link
        href="/dashboard"
        className="relative hidden min-h-9 min-w-9 shrink-0 place-items-center rounded-lg transition-all hover:bg-white/10 sm:grid"
        style={{ color: "var(--text-secondary)" }}
        aria-label={`Notifications${notifCount ? ` (${notifCount} unread)` : ""}`}
        title="Notifications"
      >
        <Bell size={14} />
        {notifCount ? (
          <span
            className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full px-1 text-[8px] font-black"
            style={{ backgroundColor: "#ef4444", color: "#fff" }}
          >
            {notifCount > 99 ? "99+" : notifCount}
          </span>
        ) : null}
      </Link>

      {/* Dock toggle — the single entry point to Activity/Files/Terminal/Inspector/Media */}
      <button
        type="button"
        onClick={onToggleDockAction}
        className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition-all hover:bg-white/5 active:scale-95"
        style={{
          borderColor: dockOpen ? "rgba(34,211,238,0.45)" : "rgba(255,255,255,0.07)",
          color: dockOpen ? "#22d3ee" : "var(--text-secondary)",
          backgroundColor: dockOpen ? "rgba(34,211,238,0.08)" : "transparent",
        }}
        title="Toggle the dock — activity, files, terminal, inspector, media"
        aria-label={dockOpen ? "Close dock" : "Open dock"}
        aria-pressed={dockOpen}
        data-testid="studio-dock-toggle"
      >
        <PanelBottom size={14} className="pointer-events-none" />
        <span className="hidden lg:inline">Dock</span>
      </button>

      {/* Overflow — conversation actions, deploy, terminal, settings */}
      <button
        ref={overflowTriggerRef}
        type="button"
        onClick={() => setOverflowOpen((v) => !v)}
        className="grid min-h-9 min-w-9 shrink-0 place-items-center rounded-lg transition-all hover:bg-white/10"
        style={{ color: "var(--text-muted)" }}
        aria-label="More actions"
        aria-expanded={Boolean(overflowOpen)}
        title="More"
      >
        <MoreHorizontal size={15} />
      </button>
      {overflowOpen && overflowRect &&
        createPortal(
          <OverflowMenu
            rect={overflowRect}
            onClose={() => setOverflowOpen(false)}
            onPreviewAction={onPreviewAction}
            onDeployAction={onDeployAction}
            onNewChatAction={onNewChatAction}
            onClearChatAction={onClearChatAction}
            onDeleteChatAction={onDeleteChatAction}
            onRenameChatAction={onRenameChatAction}
            onExportChatAction={onExportChatAction}
            onOpenDockTabAction={onOpenDockTabAction}
            executionMode={executionMode}
            onExecutionModeChange={onExecutionModeChange}
            hasConversation={Boolean(hasConversation)}
            previewDisabled={!runtimeReady}
            busy={busy}
            settingsHref={`/settings?returnTo=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/studio")}`}
          />,
          document.body,
        )}

      {/* Owner / test-role selector — inline in the header action cluster.
          Self-hides for non-owners, so it adds zero clutter for regular users. */}
      <OwnerTestModeIndicator placement="inline" />
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
  const color = ok ? "#22d3ee" : warn ? "#e3b341" : "var(--text-muted)";
  return (
    <div className="flex items-start gap-2.5 px-3 py-2">
      <Icon size={13} className="mt-0.5 shrink-0" style={{ color }} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          {label}
        </div>
        <div className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
          {value}
        </div>
        {detail && (
          <div className="text-[11px] leading-tight" style={{ color: "var(--text-secondary)" }}>
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
        backgroundColor: "rgba(24,18,38,0.96)",
        borderColor: "rgba(255,255,255,0.13)",
      }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "rgba(255,255,255,0.07)" }}
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--text-secondary)" }}>
          Workspace status
        </span>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor: providerCount ? "#22d3ee" : "var(--text-muted)",
            boxShadow: providerCount ? "0 0 4px #22d3ee" : "none",
          }}
          aria-hidden
        />
      </div>
      <div className="max-h-[60dvh] overflow-y-auto divide-y" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
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
          detail={ptyState === "available" ? "Ready for command execution" : ptyState === "idle" ? "Server online — open the terminal in the dock to connect" : "Open the terminal in the dock to connect"}
        />
        {ptyState !== "available" && onOpenTerminalAction && (
          <div className="px-3 py-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenTerminalAction();
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition hover:bg-white/5"
              style={{
                borderColor: "rgba(34,211,238,0.30)",
                color: "#22d3ee",
                backgroundColor: "rgba(34,211,238,0.06)",
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

/* ── Overflow menu — Conversation actions + Preview + Deploy + Dock ──── */
function OverflowMenu({
  rect,
  onClose,
  onPreviewAction,
  onDeployAction,
  onNewChatAction,
  onClearChatAction,
  onDeleteChatAction,
  onRenameChatAction,
  onExportChatAction,
  onOpenDockTabAction,
  executionMode,
  onExecutionModeChange,
  hasConversation,
  previewDisabled,
  busy,
  settingsHref,
}: {
  rect: DOMRect;
  onClose: () => void;
  onPreviewAction?: () => void;
  onDeployAction?: () => void;
  onNewChatAction?: () => void;
  onClearChatAction?: () => void;
  onDeleteChatAction?: () => void;
  onRenameChatAction?: () => void;
  onExportChatAction?: () => void;
  onOpenDockTabAction?: (tab: StudioTopBarDockTab) => void;
  executionMode: StudioTopBarMode;
  onExecutionModeChange?: (mode: StudioTopBarMode) => void;
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
        backgroundColor: "rgba(24,18,38,0.96)",
        borderColor: "rgba(255,255,255,0.13)",
      }}
    >
      {/* Section: Conversation */}
      <div className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
        Conversation
      </div>
      <button
        type="button"
        onClick={() => { onClose(); onNewChatAction?.(); }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-bold transition-colors hover:bg-white/5"
        style={{ color: "var(--text-primary)" }}
      >
        <Plus size={13} className="pointer-events-none" style={{ color: "#22d3ee" }} />
        New Chat
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { onClose(); onRenameChatAction?.(); }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-bold transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
        style={{ color: "var(--text-primary)" }}
      >
        <Edit2 size={13} className="pointer-events-none" style={{ color: "var(--text-secondary)" }} />
        Rename
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { onClose(); onExportChatAction?.(); }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-bold transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
        style={{ color: "var(--text-primary)" }}
      >
        <Download size={13} className="pointer-events-none" style={{ color: "var(--text-secondary)" }} />
        Export
      </button>
      <div className="h-px mx-3" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!window.confirm("Clear all messages from this conversation? The conversation will remain, but its visible message history will be removed.")) return;
          onClose();
          onClearChatAction?.();
        }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-bold transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
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
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-bold transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
        style={{ color: "#f87171" }}
      >
        <Trash2 size={13} className="pointer-events-none" />
        Delete Conversation
      </button>

      {/* Section: Workspace */}
      <div className="h-px" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
      <div className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
        Workspace
      </div>
      <button
        type="button"
        disabled={previewDisabled}
        onClick={() => { onClose(); onPreviewAction?.(); }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-bold transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ color: "var(--text-primary)" }}
      >
        <Eye size={13} className="pointer-events-none" style={{ color: "var(--text-secondary)" }} />
        Preview
      </button>
      {onDeployAction && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => { onClose(); onDeployAction(); }}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-bold transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ color: "var(--text-primary)" }}
          title="Ask LiTT to deploy this project to a live public URL"
        >
          <Rocket size={13} className="pointer-events-none" style={{ color: "#22d3ee" }} />
          Deploy…
        </button>
      )}
      {onOpenDockTabAction && (
        <button
          type="button"
          onClick={() => { onClose(); onOpenDockTabAction("terminal"); }}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-bold transition-colors hover:bg-white/5"
          style={{ color: "var(--text-primary)" }}
          aria-label="Terminal"
        >
          <Terminal size={13} className="pointer-events-none" style={{ color: "var(--text-secondary)" }} />
          Terminal
        </button>
      )}
      {onExecutionModeChange && (
        <>
          <div className="h-px" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
          <div className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
            Run mode
          </div>
          <div className="flex gap-1 px-3 pb-2" role="group" aria-label="Execution mode" data-testid="execution-mode-segmented">
            {MODE_META.map((m) => {
              const isActive = m.id === executionMode;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onClose(); onExecutionModeChange(m.id); }}
                  className="flex-1 rounded-md px-1.5 py-1.5 text-[10px] font-bold transition-all"
                  style={{
                    color: isActive ? m.color : "var(--text-muted)",
                    backgroundColor: isActive ? m.tint : "transparent",
                    boxShadow: isActive ? `inset 0 0 0 1px ${m.border}` : "none",
                  }}
                  aria-pressed={isActive}
                  title={`${m.label} — ${m.desc}`}
                  data-testid={`execution-mode-${m.id}`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </>
      )}
      <div className="h-px" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
      <Link
        href={settingsHref}
        onClick={onClose}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-bold transition-colors hover:bg-white/5"
        style={{ color: "var(--text-primary)" }}
      >
        <Settings size={13} className="pointer-events-none" style={{ color: "var(--text-secondary)" }} />
        Settings
      </Link>
    </div>
  );
}
