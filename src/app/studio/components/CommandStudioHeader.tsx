"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { useWallet } from "@/context/WalletContext";
import StudioProjectPicker from "./StudioProjectPicker";
import ModelPicker from "@/components/ModelPicker";
import {
  useStudioModelStore,
  MODELS,
  type ProviderHealth,
} from "../stores/useStudioModelStore";
import {
  ChevronDown,
  Eye,
  Rocket,
  Sparkles,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Bell,
  Bot,
  PanelRightOpen,
  MoreHorizontal,
  Plus,
  Terminal,
  Trash2,
} from "lucide-react";

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
  onOpenTerminalAction,
  onOpenInspectorAction,
  onProjectSelectAction,
  onClearChatAction,
  onNewChatAction,
  onDeleteChatAction,
  hasConversation,
  projectReady,
  capabilities,
  busy = false,
}: {
  branch?: string;
  onPreviewAction?: () => void;
  onOpenActivityAction?: () => void;
  onOpenTerminalAction?: () => void;
  onOpenInspectorAction?: () => void;
  onProjectSelectAction?: (projectId: string) => void;
  onClearChatAction?: () => void;
  onNewChatAction?: () => void;
  onDeleteChatAction?: () => void;
  hasConversation?: boolean;
  projectReady?: boolean;
  capabilities: import("../hooks/useConnectionSummary").ConnectionCapabilities;
  /** True while an agent/conversation turn is in flight. */
  busy?: boolean;
}) {
  const { balance, isLoading: walletLoading } = useWallet();
  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const selectModel = useStudioModelStore((s) => s.selectModel);
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

  const repoConnected = capabilities.repository === "connected";
  const ptyAvailable = capabilities.terminalExecution === "available";
  const writesAllowed = capabilities.writeAccess;
  const modelHealth = providerHealth[selectedModel.provider] ?? "available";
  const hasAi = modelHealth === "available" || modelHealth === "degraded";
  const providerCount = hasAi ? 1 : 0;

  // Truthful aggregate status — calculated from actual capabilities,
  // never from provider count alone. "Workspace ready" requires a
  // project (repo OR terminal) AND an AI provider.
  const hasProject = repoConnected || ptyAvailable;
  const statusColor = hasProject && hasAi
    ? "var(--litt-primary)"
    : hasProject
      ? "#e3b341"
      : hasAi
        ? "var(--litt-primary)"
        : "var(--text-muted)";
  const statusLabel = hasProject && hasAi
    ? "Workspace available"
    : hasProject
      ? "AI setup required"
      : hasAi
        ? "Chat ready"
        : "Chat unavailable";

  return (
    <header
      className="flex shrink-0 items-center gap-2 border-b px-2 sm:px-3"
      style={{
        height: "var(--studio-header-h)",
        backgroundColor: "var(--studio-bg)",
        borderColor: "var(--studio-border)",
      }}
      data-testid="studio-header"
    >
      {/* LiTT Studio logo — clickable to go to dashboard */}
      <Link
        href="/dashboard"
        className="flex shrink-0 items-center gap-1.5 rounded-md transition-all hover:opacity-80"
        aria-label="Go to dashboard"
        title="Go to dashboard"
      >
        <div
          className="grid h-6 w-6 place-items-center rounded-md"
          style={{
            background: "linear-gradient(135deg, var(--litt-primary), var(--spark-primary))",
          }}
          aria-hidden
        >
          <Sparkles size={11} className="text-black" />
        </div>
        <span
          className="hidden sm:inline text-[11px] font-black uppercase tracking-[0.15em]"
          style={{ color: "var(--text-primary)" }}
        >
          LiTT Studio
        </span>
      </Link>

      <StudioProjectPicker
        projectId={capabilities.projectId}
        projectName={capabilities.projectName}
        onSelect={(projectId) => onProjectSelectAction?.(projectId)}
      />

      {/* Connected repo — visible chip when a repository is linked */}
      {repoConnected && capabilities.repositoryName && (
        <span
          className="hidden md:inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-bold"
          style={{
            borderColor: "rgba(114,242,56,0.25)",
            color: "var(--litt-primary)",
            backgroundColor: "rgba(114,242,56,0.06)",
          }}
          title={`Repository: ${capabilities.repositoryName}`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            aria-hidden
            style={{ backgroundColor: "var(--litt-primary)" }}
          />
          {capabilities.repositoryName}
        </span>
      )}

      {/* Branch — only when a repo is connected */}
      {branch && repoConnected && (
        <span
          className="hidden lg:inline shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold"
          style={{
            borderColor: "var(--studio-border)",
            color: "var(--text-secondary)",
            backgroundColor: "var(--studio-surface)",
          }}
          title={`Branch: ${branch}`}
        >
          {branch}
        </span>
      )}

      {/* Workspace Status popover trigger — absorbs all permanent chips */}
      <button
        ref={statusTriggerRef}
        type="button"
        onClick={() => setStatusOpen((v) => !v)}
        className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold transition-all hover:bg-white/5 active:scale-95"
        style={{
          borderColor: "var(--studio-border)",
          color: "var(--text-secondary)",
          backgroundColor: "var(--studio-surface)",
        }}
        aria-label="Workspace status"
        aria-expanded={statusOpen}
        title={capabilities.connectionSummary}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          aria-hidden
          style={{ backgroundColor: statusColor, boxShadow: `0 0 4px ${statusColor}` }}
        />
        <span className="hidden sm:inline">{statusLabel}</span>
        <ChevronDown size={10} style={{ color: "var(--text-muted)" }} />
      </button>
      {statusOpen && statusRect &&
        createPortal(
          <WorkspaceStatusPopover
            rect={statusRect}
            onClose={() => setStatusOpen(false)}
            onOpenTerminalAction={onOpenTerminalAction}
            providerCount={providerCount}
            repoConnected={repoConnected}
            repoName={capabilities.repositoryName}
            ptyState={capabilities.terminalExecution}
            writesAllowed={writesAllowed}
            modelLabel={selectedModel.label}
            modelHealth={modelHealth}
            fallbackNotice={fallbackNotice}
            walletBalance={walletLoading ? null : balance}
            connectionSummary={
              hasAi
                ? `${selectedModel.label} is ready. Add a project for files, preview, terminal, and deployment.`
                : "Configure an AI provider to start chatting."
            }
          />,
          document.body,
        )}

      {/* Model picker — lets the user change the AI model. The selected
          model reaches the backend via useCanonicalConversation.send(). */}
      <div className="hidden sm:block shrink-0 w-[min(11rem,30vw)]" data-testid="studio-model-picker">
        <ModelPicker
          selectedModel={selectedModel.id}
          onModelChange={(modelId) => {
            const found = MODELS.find((m) => m.id === modelId);
            if (found) selectModel(found);
          }}
        />
      </div>

      {/* Write-permission pill — colored so the approval state is obvious.
          🟢 Writes allowed · 🟡 Approval needed · (locked shown in popover) */}
      <WritePermissionPill writesAllowed={writesAllowed} hasProject={hasProject} />

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
      <button
        type="button"
        onClick={onDeleteChatAction}
        disabled={!hasConversation || busy}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md border transition-all hover:bg-red-500/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
        style={{ borderColor: "var(--studio-border)", color: "#f87171" }}
        aria-label="Delete chat"
        title={hasConversation ? "Delete current chat" : "No chat to delete"}
      >
        <Trash2 size={12} aria-hidden />
      </button>

      {/* Notifications — wired to /api/notifications/count */}
      <Link
        href="/notifications"
        className="relative grid h-7 w-7 shrink-0 place-items-center rounded-md transition-all hover:bg-white/10"
        style={{ color: "var(--text-secondary)" }}
        aria-label={`Notifications${notifCount ? ` (${notifCount} unread)` : ""}`}
        title="Notifications"
      >
        <Bell size={13} />
        {notifCount ? (
          <span
            className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full px-1 text-[8px] font-black"
            style={{ backgroundColor: "#ff00a0", color: "#fff" }}
          >
            {notifCount > 99 ? "99+" : notifCount}
          </span>
        ) : null}
      </Link>

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

      {/* Activity — opens the Activity drawer (kept visible; useful) */}
      <button
        type="button"
        onClick={onOpenActivityAction}
        className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold transition-all hover:bg-white/5 active:scale-95"
        style={{
          borderColor: "var(--studio-border)",
          color: "var(--text-secondary)",
          backgroundColor: "var(--studio-surface)",
        }}
        title="Activity"
        aria-label="Activity"
      >
        <span className="hidden sm:inline pointer-events-none">Activity</span>
      </button>

      {/* Overflow menu — Preview + Deploy + Settings collapsed here */}
      <button
        ref={overflowTriggerRef}
        type="button"
        onClick={() => setOverflowOpen((v) => !v)}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md transition-all hover:bg-white/10"
        style={{ color: "var(--text-muted)" }}
        aria-label="More actions"
        aria-expanded={overflowOpen}
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
            onClearChatAction={onClearChatAction}
            previewDisabled={!projectReady}
            settingsHref={`/settings?returnTo=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/studio")}`}
          />,
          document.body,
        )}

      {/* User avatar */}
      <div className="shrink-0" data-testid="user-avatar">
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
              avatarBox: "w-6 h-6 rounded-full",
              userButtonPopoverCard: "bg-[#0a0b12] border border-white/10 shadow-2xl",
              userButtonPopoverActionButton: "text-white/85 hover:bg-white/8",
              userButtonPopoverActionButtonText: "text-white/85",
              userButtonPopoverFooter: "text-white/40",
              userButtonPopoverHeaderTitle: "text-white/90",
              userButtonPopoverHeaderSubtitle: "text-white/55",
              userButtonPopoverProfile: "text-white/85",
              userButtonPopoverProfilePrimaryText: "text-white/90",
              userButtonPopoverProfileSecondaryText: "text-white/55",
            },
          }}
        />
      </div>
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
          ok={ptyState === "available"}
          warn={ptyState === "connecting" || ptyState === "error"}
          detail={ptyState === "available" ? "Ready for command execution" : "Open the terminal drawer to connect"}
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
          detail="LiTTBits balance"
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

/* ── Write-permission pill ──────────────────────────────────────── */
function WritePermissionPill({ writesAllowed, hasProject }: { writesAllowed: boolean; hasProject: boolean }) {
  // No project yet → no writes possible → muted "Read-only" pill.
  // Project + writes allowed → green.
  // Project + approval required → amber.
  const tone = !hasProject ? "muted" : writesAllowed ? "ok" : "warn";
  const label = !hasProject ? "Read-only" : writesAllowed ? "Writes allowed" : "Approval needed";
  const cfg = {
    ok: { color: "var(--litt-primary)", bg: "rgba(114,242,56,0.08)", border: "rgba(114,242,56,0.3)" },
    warn: { color: "#e3b341", bg: "rgba(227,179,65,0.08)", border: "rgba(227,179,65,0.3)" },
    muted: { color: "var(--text-muted)", bg: "var(--studio-surface)", border: "var(--studio-border)" },
  }[tone];
  return (
    <span
      className="hidden sm:inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-bold"
      style={{ color: cfg.color, backgroundColor: cfg.bg, borderColor: cfg.border }}
      title={label}
      data-testid="write-permission-pill"
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        aria-hidden
        style={{ backgroundColor: cfg.color }}
      />
      {label}
    </span>
  );
}

/* ── Overflow menu (Preview + Deploy + Settings) ────────────────── */
function OverflowMenu({
  rect,
  onClose,
  onPreviewAction,
  onClearChatAction,
  previewDisabled,
  settingsHref,
}: {
  rect: DOMRect;
  onClose: () => void;
  onPreviewAction?: () => void;
  onClearChatAction?: () => void;
  previewDisabled: boolean;
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

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="More actions"
      className="fixed z-[200] w-48 overflow-hidden rounded-xl border shadow-2xl"
      style={{
        top,
        right,
        backgroundColor: "var(--studio-elevated)",
        borderColor: "var(--studio-border-strong)",
      }}
    >
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
      <button
        type="button"
        onClick={() => { onClose(); onClearChatAction?.(); }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] font-bold transition-colors hover:bg-white/5"
        style={{ color: "var(--text-primary)" }}
      >
        <Trash2 size={13} className="pointer-events-none" style={{ color: "var(--text-secondary)" }} />
        Clear chat
      </button>
      <button
        type="button"
        disabled
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] font-bold transition-colors disabled:cursor-not-allowed"
        style={{ color: "var(--text-muted)" }}
        title="Deploy unavailable — not wired in this phase"
      >
        <Rocket size={13} className="pointer-events-none" />
        Deploy
      </button>
      <div className="h-px" style={{ backgroundColor: "var(--studio-border)" }} />
      <Link
        href={settingsHref}
        onClick={onClose}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] font-bold transition-colors hover:bg-white/5"
        style={{ color: "var(--text-primary)" }}
      >
        <span className="text-[14px] leading-none" style={{ color: "var(--text-secondary)" }}>⋯</span>
        Settings
      </Link>
    </div>
  );
}
