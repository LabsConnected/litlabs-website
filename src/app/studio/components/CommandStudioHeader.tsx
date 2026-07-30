"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { useWallet } from "@/context/WalletContext";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import {
  useStudioModelStore,
  type ProviderHealth,
} from "../stores/useStudioModelStore";
import {
  ChevronDown,
  Eye,
  Rocket,
  Sparkles,
  Home,
  CircleAlert,
  CircleCheck,
  CircleDot,
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
  onPreview,
  onOpenActivity,
  projectReady,
  capabilities,
}: {
  branch?: string;
  onPreview?: () => void;
  onOpenActivity?: () => void;
  projectReady?: boolean;
  capabilities: import("../hooks/useConnectionSummary").ConnectionCapabilities;
}) {
  const { balance, isLoading: walletLoading } = useWallet();
  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const fallbackNotice = useStudioModelStore((s) => s.fallbackNotice);
  const providerHealth = useStudioModelStore((s) => s.providerHealth);

  const [statusOpen, setStatusOpen] = useState(false);
  const statusTriggerRef = useRef<HTMLButtonElement>(null);
  const [statusRect, setStatusRect] = useState<DOMRect | null>(null);

  const updateRect = useCallback(() => {
    if (statusTriggerRef.current) {
      setStatusRect(statusTriggerRef.current.getBoundingClientRect());
    }
  }, []);

  useEffect(() => {
    if (!statusOpen) return;
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [statusOpen, updateRect]);

  const providerCount = capabilities.connectedProviders.length;
  const repoConnected = capabilities.repository === "connected";
  const ptyAvailable = capabilities.terminalExecution === "available";
  const writesAllowed = capabilities.writeAccess;
  const modelHealth = providerHealth[selectedModel.provider] ?? "available";

  // Truthful aggregate status — calculated from actual capabilities,
  // never from provider count alone. "Workspace ready" requires a
  // project (repo OR terminal) AND an AI provider.
  const hasProject = repoConnected || ptyAvailable;
  const hasAi = providerCount > 0;
  const statusColor = hasProject && hasAi
    ? "var(--litt-primary)"
    : hasProject
      ? "#e3b341"
      : "var(--text-muted)";
  const statusLabel = hasProject && hasAi
    ? "Workspace available"
    : hasProject
      ? "AI setup required"
      : hasAi
        ? "Project setup required"
        : "Workspace setup required";

  return (
    <header
      className="flex shrink-0 items-center gap-2 border-b px-2 sm:px-3"
      style={{
        height: "var(--studio-header-h)",
        backgroundColor: "var(--studio-bg)",
        borderColor: "var(--studio-border)",
      }}
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

      {/* Branch */}
      {branch && (
        <span
          className="hidden md:inline shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold"
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
        className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold transition-all hover:bg-white/5"
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
            providerCount={providerCount}
            repoConnected={repoConnected}
            repoName={capabilities.repositoryName}
            ptyState={capabilities.terminalExecution}
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

      {/* Preview — switches Studio to the Preview surface */}
      <button
        type="button"
        disabled={!projectReady}
        onClick={onPreview}
        className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold transition-all hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          borderColor: "var(--studio-border)",
          color: "var(--text-secondary)",
          backgroundColor: "var(--studio-surface)",
        }}
        title={projectReady ? "Preview" : "Connect a project to preview"}
        aria-label="Preview"
      >
        <Eye size={11} className="pointer-events-none" />
        <span className="hidden sm:inline pointer-events-none">Preview</span>
      </button>

      {/* Activity — opens the Activity drawer */}
      <button
        type="button"
        onClick={onOpenActivity}
        className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold transition-all hover:bg-white/5"
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

      {/* Deploy — truthful. No deploy handler is wired in Phase 1, so
          the button is disabled with a truthful explanation rather than
          claiming success or opening the Activity drawer. */}
      <button
        type="button"
        disabled
        className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-black transition-all disabled:cursor-not-allowed"
        style={{
          backgroundColor: "var(--studio-card)",
          color: "var(--text-muted)",
        }}
        title="Deploy unavailable — not wired in this phase"
        aria-label="Deploy unavailable"
      >
        <Rocket size={11} className="pointer-events-none" />
        <span className="hidden sm:inline pointer-events-none">Deploy</span>
      </button>

      {/* Overflow menu — settings + account */}
      <Link
        href={`/settings?returnTo=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/studio")}`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md transition-all hover:bg-white/10"
        style={{ color: "var(--text-muted)" }}
        aria-label="Settings"
        title="Settings"
      >
        <span className="text-[14px] leading-none">⋯</span>
      </Link>

      {/* User avatar */}
      <div className="shrink-0">
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
          detail={ptyState === "available" ? "Ready for command execution" : "Open the Activity drawer to connect"}
        />
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
