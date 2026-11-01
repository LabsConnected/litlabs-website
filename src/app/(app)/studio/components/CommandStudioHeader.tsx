"use client";

import { HEALTH_LEVEL_COLOR, terminalHealthOf } from "@/lib/studio/terminal-health";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import StudioProjectPicker from "./StudioProjectPicker";
import GlobalLittStudioEntry from "@/components/global-litt/GlobalLittStudioEntry";
import {
  useStudioModelStore,
  type ProviderHealth,
} from "../stores/useStudioModelStore";
import { resolveSelectedModelHealth } from "../lib/model-health";
import {
  Eye,
  Rocket,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Bell,
  PanelRight,
  MessageSquare,
  SquareTerminal,
  MoreHorizontal,
  Plus,
  Terminal,
  Trash2,
  Edit2,
  Download,
  Eraser,
  Settings,
  LayoutGrid,
  ChevronDown,
  RotateCcw,
  ExternalLink,
  Maximize2,
} from "lucide-react";
import { OwnerTestModeIndicator } from "@/components/OwnerTestModeIndicator";
import {
  runtimePhaseLabel,
  type ProjectRuntimeState,
} from "@/lib/projects/runtime-state";
import {
  STAGE_SURFACE_META,
  type StudioStageSurface,
} from "./shell/stage-surfaces";
import type { StudioShellControls } from "./shell/StudioShell";
import type { StudioSaveTone } from "../lib/save-events";

const HEALTH_DOT: Record<ProviderHealth, { color: string; label: string }> = {
  available: { color: "#72f238", label: "Available" },
  degraded: { color: "#e3b341", label: "Degraded" },
  unavailable: { color: "#ef4444", label: "Unavailable" },
  locked: { color: "#6f7485", label: "Not configured" },
};

export type StudioTopBarMode = "plan" | "act" | "auto";
export type StudioTopBarDockTab = "activity" | "files" | "terminal" | "inspector" | "media";

/** Commands handled by the parent for the consolidated Layout menu. */
export type StudioLayoutCommand =
  | "focus-chat"
  | "focus-canvas"
  | "toggle-inspector"
  | "toggle-dock"
  | "open-terminal";

/** Primary surfaces rendered as the toolbar seg control (approved v1
    order). Remaining surfaces are reachable through the Layout menu. */
const SEG_SURFACES: StudioStageSurface[] = ["design", "code", "preview"];
/** Secondary surfaces — listed in the Layout menu's "Open" section. */
const SECONDARY_SURFACES: StudioStageSurface[] = [
  "files",
  "browser",
  "images",
  "assets",
  "deploy",
  "activity",
];

const MODE_META: { id: StudioTopBarMode; label: string; desc: string; color: string; tint: string; border: string }[] = [
  { id: "plan", label: "PLAN", desc: "Inspect and explain; do not change files", color: "#3b82f6", tint: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.35)" },
  { id: "act", label: "ACT", desc: "Make changes; approvals may be required", color: "#8b5cf6", tint: "rgba(139,92,246,0.12)", border: "rgba(139,92,246,0.35)" },
  { id: "auto", label: "AUTO", desc: "LiTT chooses when to plan and when to act", color: "var(--color-accent)", tint: "color-mix(in srgb, var(--color-accent) 10%, transparent)", border: "color-mix(in srgb, var(--color-accent) 32%, transparent)" },
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
  surface,
  onSurfaceChange,
  saveLabel = null,
  saveTone = null,
  onExportAction,
  onLayoutCommand,
  inspectorOpen = false,
  shellControls = null,
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
  /** Active stage surface — renders the Preview/Code/Design seg control. */
  surface?: StudioStageSurface;
  onSurfaceChange?: (surface: StudioStageSurface) => void;
  /** Truthful save label from useStudioSaveLabel — null renders nothing. */
  saveLabel?: string | null;
  saveTone?: StudioSaveTone | null;
  /** Project export (ZIP) — downloads the real workspace archive. */
  onExportAction?: () => void;
  /** Consolidated layout menu commands (focus, dock, reset, …). */
  onLayoutCommand?: (command: StudioLayoutCommand) => void;
  inspectorOpen?: boolean;
  /** Docking controls exposed by StudioShell for the Layout menu. */
  shellControls?: StudioShellControls | null;
}) {
  const { balance, isLoading: walletLoading } = useWallet();
  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const fallbackNotice = useStudioModelStore((s) => s.fallbackNotice);
  const providerHealth = useStudioModelStore((s) => s.providerHealth);

  const [statusOpen, setStatusOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [notifCount, setNotifCount] = useState<number | null>(null);
  const statusTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const layoutTriggerRef = useRef<HTMLButtonElement>(null);
  const [statusRect, setStatusRect] = useState<DOMRect | null>(null);
  const [overflowRect, setOverflowRect] = useState<DOMRect | null>(null);
  const [layoutRect, setLayoutRect] = useState<DOMRect | null>(null);

  const updateRect = useCallback(() => {
    if (statusTriggerRef.current) {
      setStatusRect(statusTriggerRef.current.getBoundingClientRect());
    }
    if (overflowTriggerRef.current) {
      setOverflowRect(overflowTriggerRef.current.getBoundingClientRect());
    }
    if (layoutTriggerRef.current) {
      setLayoutRect(layoutTriggerRef.current.getBoundingClientRect());
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
    if (!statusOpen && !overflowOpen && !layoutOpen) return;
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [statusOpen, overflowOpen, layoutOpen, updateRect]);

  const writesAllowed = capabilities.writeAccess;
  const modelHealth = resolveSelectedModelHealth(selectedModel, providerHealth);
  const hasAi = modelHealth === "available" || modelHealth === "degraded";
  const providerCount = hasAi ? 1 : 0;

  // "ready" already implies executionAvailable (workspace mounted AND
  // terminal server reachable) — the canonical hook derives them together,
  // so no second condition can disagree.
  const runtimeReady = runtime.phase === "ready";
  const statusLabel = runtimeLoading || runtime.phase === "resolving"
    ? "Runtime status checking"
    : runtime.phase === "idle" || !runtime.projectId
      ? "No project selected"
      : runtime.phase === "terminal_unreachable"
        // Canonical terminal wording — same label the operator bar and
        // Mission hints render (lib/studio/terminal-health.ts).
        ? terminalHealthOf(capabilities).label
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
    ? "var(--color-accent)"
    : runtimeLoading || modelHealth === undefined
      ? "#e3b341"
      : runtime.phase === "error" || runtime.phase === "unauthenticated" || modelHealth === "unavailable"
        ? "#ef4444"
        : runtime.phase === "terminal_unreachable"
          ? HEALTH_LEVEL_COLOR[terminalHealthOf(capabilities).level]
          : "#e3b341";

  // Status pill: approval gates and agent work take precedence over the
  // ambient runtime label — both are truthful, derived from live state.
  const pill = approvalPending
    ? { label: "Approval needed", short: "Approval", color: "#e3b341", pulse: true }
    : busy
      ? { label: "Agent working", short: "Working", color: "var(--color-accent)", pulse: true }
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
  // Ambient "everything is fine" is not a badge — but the status details
  // stay reachable, so the control collapses to a minimal dot rather than
  // disappearing entirely.
  const ambientReady = !approvalPending && !busy && pill.short === "Ready";

  const terminalHealth = terminalHealthOf(capabilities);
  const saveToneColor =
    saveTone === "error" ? "#ef4444"
    : saveTone === "saving" || saveTone === "dirty" ? "#e3b341"
    : "var(--text-muted)";

  // Honest action availability — computed from real capability state,
  // never optimistic. Export archives the live workspace through the
  // terminal file service server-side (no interactive PTY needed), so
  // its truthful gate is "runtime ready" — the same signal that already
  // proves the workspace is mounted and the terminal server reachable.
  // Publish needs a project, write access, mutations allowed, and a
  // verified-ready runtime.
  const exportAvailable = Boolean(capabilities.projectId && runtimeReady);
  const exportHint = !capabilities.projectId
    ? "Select a project first"
    : "Export needs the workspace ready — open Preview and let it start";
  const publishAvailable = Boolean(
    capabilities.projectId && writesAllowed && mutationActionsAllowed && runtimeReady,
  );
  const publishHint = !capabilities.projectId
    ? "Select a project first"
    : !writesAllowed
      ? "Publishing requires write access on this account"
      : !runtimeReady
        ? "The workspace isn't ready yet — open Preview and let it start"
        : "Publishing is unavailable for this account";

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
      {/* Project identity — the global nav above owns branding, so no
          repeated logo or app name lives here. */}
      <StudioProjectPicker
        projectId={capabilities.projectId}
        projectName={capabilities.projectName}
        onSelect={(projectId) => onProjectSelectAction?.(projectId)}
        onCreateProject={() => onCreateProjectAction?.()}
        onDeleteProject={(projectId) => onDeleteProjectAction?.(projectId)}
        onProjectRenamed={(projectId, name) => onProjectRenamedAction?.(projectId, name)}
      />

      {/* Truthful save state — rendered only while a real save signal
          exists (saving / unsaved / failed / confirmed save time). */}
      {saveLabel && (
        <span
          className="hidden shrink-0 items-center gap-1 text-[11px] font-medium md:flex"
          style={{ color: saveToneColor }}
          role="status"
          data-testid="project-save-state"
        >
          {saveTone === "saving" && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
          )}
          {saveLabel}
        </span>
      )}

      {/* Global LiTT — persistent operator, separate from ordinary projects */}
      <GlobalLittStudioEntry />

      {/* Surface switch — Preview / Code / Design per the approved shell.
          Secondary surfaces live in the Layout menu. */}
      {surface && onSurfaceChange && (
        <div
          className="ml-1 hidden shrink-0 items-center gap-0.5 rounded-lg border p-0.5 md:flex"
          style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(0,0,0,0.25)" }}
          role="group"
          aria-label="Workspace surface"
          data-testid="surface-switch"
        >
          {SEG_SURFACES.map((id) => {
            const meta = STAGE_SURFACE_META[id];
            const Icon = meta.icon;
            const active = surface === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSurfaceChange(id)}
                aria-pressed={active}
                title={meta.hint}
                className="flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-bold transition-colors"
                style={{
                  backgroundColor: active ? "var(--color-accent)" : "transparent",
                  color: active ? "var(--color-on-accent, #0b0f1c)" : "var(--text-secondary)",
                }}
                data-testid={`surface-seg-${id}`}
              >
                <Icon size={12} className="pointer-events-none" aria-hidden />
                {meta.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Agent-status — transient states render the pill; ambient
          "verified" collapses to a quiet dot that still opens the full
          workspace-status popover. No "Ready" badge. */}
      <button
        ref={statusTriggerRef}
        type="button"
        onClick={() => setStatusOpen((v) => !v)}
        className={
          ambientReady
            ? "grid min-h-9 min-w-9 shrink-0 place-items-center rounded-lg transition-all hover:bg-white/5"
            : "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-all hover:bg-white/5 active:scale-95"
        }
        style={
          ambientReady
            ? undefined
            : {
                borderColor: `${pill.color}45`,
                backgroundColor: `${pill.color}0f`,
                color: pill.color,
              }
        }
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
        {!ambientReady && <span className="hidden sm:inline">{pill.short}</span>}
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

      {/* Export — the real workspace ZIP endpoint. Disabled honestly when
          unavailable; never a fake action. */}
      <button
        type="button"
        onClick={onExportAction}
        disabled={!exportAvailable}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-all hover:bg-white/5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
        style={{ borderColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}
        title={exportAvailable ? "Download the project as a ZIP" : exportHint ?? "Export unavailable"}
        aria-label="Export project"
        data-testid="export-action"
      >
        <Download size={12} className="pointer-events-none" aria-hidden />
        <span className="hidden lg:inline">Export</span>
      </button>

      {/* Publish — availability is explicit; when unavailable the title
          states the single next step. */}
      <button
        type="button"
        onClick={publishAvailable ? onDeployAction : undefined}
        disabled={!publishAvailable}
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          backgroundColor: publishAvailable ? "var(--color-accent)" : "rgba(255,255,255,0.05)",
          color: publishAvailable ? "var(--color-on-accent, #0b0f1c)" : "var(--text-muted)",
          boxShadow: publishAvailable ? "var(--shadow-accent-glow, 0 0 12px rgba(114,242,56,0.25))" : "none",
        }}
        title={publishAvailable ? "Publish this project" : publishHint ?? "Publishing is unavailable"}
        aria-label="Publish project"
        data-testid="publish-action"
      >
        <Rocket size={12} className="pointer-events-none" aria-hidden />
        <span className="hidden lg:inline">Publish</span>
      </button>

      {/* Terminal — shows the real connection state with the canonical
          label; opens the terminal dock tab on click. */}
      <button
        type="button"
        onClick={() => onOpenDockTabAction?.("terminal")}
        className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-bold transition-all hover:bg-white/5 active:scale-95"
        style={{
          borderColor: terminalHealth.level === "red" ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.07)",
          color: terminalHealth.level === "green" ? "var(--text-secondary)"
            : terminalHealth.level === "yellow" ? "#e3b341" : "#ef4444",
        }}
        title={terminalHealth.detail ? `${terminalHealth.label} — ${terminalHealth.detail}` : terminalHealth.label}
        aria-label={`Terminal: ${terminalHealth.label}`}
        data-testid="terminal-chip"
      >
        <SquareTerminal size={13} className="pointer-events-none" aria-hidden />
        <span className="hidden xl:inline">{terminalHealth.label}</span>
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

      {/* Layout — the single menu for every layout control (focus modes,
          inspector, dock/terminal, float/popout, reset, surfaces). */}
      {onLayoutCommand && (
        <button
          ref={layoutTriggerRef}
          type="button"
          onClick={() => setLayoutOpen((v) => !v)}
          className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition-all hover:bg-white/5 active:scale-95"
          style={{
            borderColor: layoutOpen ? "color-mix(in srgb, var(--color-accent) 45%, transparent)" : "rgba(255,255,255,0.07)",
            color: layoutOpen ? "var(--color-accent)" : "var(--text-secondary)",
            backgroundColor: layoutOpen ? "color-mix(in srgb, var(--color-accent) 8%, transparent)" : "transparent",
          }}
          title="Layout controls"
          aria-label="Layout controls"
          aria-expanded={layoutOpen}
          aria-haspopup="menu"
          data-testid="layout-menu-trigger"
        >
          <LayoutGrid size={14} className="pointer-events-none" aria-hidden />
          <span className="hidden lg:inline">Layout</span>
          <ChevronDown size={11} className="pointer-events-none" aria-hidden />
        </button>
      )}
      {layoutOpen && layoutRect && onLayoutCommand &&
        createPortal(
          <LayoutMenu
            rect={layoutRect}
            onClose={() => setLayoutOpen(false)}
            onCommand={onLayoutCommand}
            onSurfaceChange={onSurfaceChange}
            surface={surface}
            inspectorOpen={inspectorOpen}
            dockOpen={dockOpen}
            shellControls={shellControls}
          />,
          document.body,
        )}

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
  const color = ok ? "var(--color-accent)" : warn ? "#e3b341" : "var(--text-muted)";
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
  /** Undefined while provider health is unverified — renders "Checking". */
  modelHealth: ProviderHealth | undefined;
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
            backgroundColor: providerCount ? "var(--color-accent)" : "var(--text-muted)",
            boxShadow: providerCount ? "0 0 4px var(--color-accent)" : "none",
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
          detail={fallbackNotice ?? (modelHealth ? HEALTH_DOT[modelHealth].label : "Checking")}
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
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[11px] font-bold text-accent transition hover:bg-accent/20"
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
        <Plus size={13} className="pointer-events-none text-accent" />
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
          <Rocket size={13} className="pointer-events-none text-accent" />
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

/* ── Layout menu — the single consolidated layout control ────────── */
function LayoutMenuItem({
  icon: Icon,
  label,
  checked,
  disabled,
  onClick,
  testId,
}: {
  icon: React.ComponentType<{ size?: number | string; className?: string; style?: React.CSSProperties }>;
  label: string;
  checked?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-bold transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
      style={{ color: "var(--text-primary)" }}
      data-testid={testId}
    >
      <Icon size={13} className="pointer-events-none" style={{ color: "var(--text-secondary)" }} />
      <span className="min-w-0 flex-1">{label}</span>
      {checked !== undefined && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          aria-hidden
          style={{ backgroundColor: checked ? "var(--color-accent)" : "rgba(255,255,255,0.18)" }}
        />
      )}
    </button>
  );
}

function LayoutMenu({
  rect,
  onClose,
  onCommand,
  onSurfaceChange,
  surface,
  inspectorOpen,
  dockOpen,
  shellControls,
}: {
  rect: DOMRect;
  onClose: () => void;
  onCommand: (command: StudioLayoutCommand) => void;
  onSurfaceChange?: (surface: StudioStageSurface) => void;
  surface?: StudioStageSurface;
  inspectorOpen: boolean;
  dockOpen: boolean;
  shellControls: StudioShellControls | null;
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

  const run = (fn: () => void) => () => { fn(); onClose(); };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Layout controls"
      className="fixed z-[300] w-56 rounded-xl border py-1 shadow-2xl"
      style={{
        top: rect.bottom + 6,
        left: Math.max(8, rect.right - 224),
        backgroundColor: "#120e1e",
        borderColor: "rgba(255,255,255,0.10)",
      }}
      data-testid="layout-menu"
    >
      <LayoutMenuItem icon={MessageSquare} label="Focus chat" onClick={run(() => onCommand("focus-chat"))} testId="layout-focus-chat" />
      <LayoutMenuItem icon={Maximize2} label="Focus canvas" onClick={run(() => onCommand("focus-canvas"))} testId="layout-focus-canvas" />
      <LayoutMenuItem icon={PanelRight} label="Inspector" checked={inspectorOpen} onClick={run(() => onCommand("toggle-inspector"))} testId="layout-toggle-inspector" />
      <LayoutMenuItem icon={SquareTerminal} label="Terminal drawer" checked={dockOpen} onClick={run(() => onCommand("toggle-dock"))} testId="layout-toggle-dock" />

      {shellControls && (
        <>
          <div className="mx-3 my-1 h-px" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
          <LayoutMenuItem
            icon={PanelRight}
            label={shellControls.inspectorFloating ? "Dock inspector" : "Float inspector"}
            checked={shellControls.inspectorFloating}
            onClick={run(shellControls.toggleInspectorFloat)}
            testId="layout-float-inspector"
          />
          <LayoutMenuItem icon={ExternalLink} label="Pop out inspector" onClick={run(shellControls.popoutInspector)} testId="layout-popout-inspector" />
          <LayoutMenuItem icon={RotateCcw} label="Reset layout" onClick={run(shellControls.resetLayout)} testId="layout-reset" />
        </>
      )}

      {onSurfaceChange && (
        <>
          <div className="mx-3 my-1 h-px" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
          <div className="px-3 py-1 text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
            Open
          </div>
          {SECONDARY_SURFACES.map((id) => {
            const meta = STAGE_SURFACE_META[id];
            return (
              <LayoutMenuItem
                key={id}
                icon={meta.icon}
                label={meta.label}
                checked={surface === id}
                onClick={run(() => onSurfaceChange(id))}
                testId={`layout-surface-${id}`}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
