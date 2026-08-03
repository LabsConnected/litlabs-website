"use client";

import { useState } from "react";
import {
  Hammer,
  Wrench,
  ScanSearch,
  Wand2,
  ArrowRight,
  Upload,
  FilePlus2,
} from "lucide-react";
import LiTTPresence from "./LiTTPresence";
import StudioActivityTimeline from "./StudioActivityTimeline";
import type { AgentId } from "../stores/useStudioAgentStore";
import type { ConnectionCapabilities } from "../hooks/useConnectionSummary";
import type { ProviderHealth } from "../stores/useStudioModelStore";

/* Inline GitHub mark — lucide-react is pinned to ^1.24.0 and lacks Github. */
function GithubMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
    </svg>
  );
}

/**
 * LiTEmptyState — premium centered empty state for the Studio composer.
 *
 * Replaces the old "LiTT creative engine" card. Restrained 96–120px LiTT
 * presence (no giant mascot), one headline, supporting copy, primary
 * actions, and project-aware suggestions. When no project is available,
 * offers Start blank / Connect repository / Upload project instead.
 */

type PrimaryAction = "build" | "fix" | "review" | "create";

const PRIMARY_ACTIONS: { id: PrimaryAction; label: string; icon: typeof Hammer; prompt: string }[] = [
  { id: "build", label: "Build something", icon: Hammer, prompt: "Help me build " },
  { id: "fix", label: "Fix an issue", icon: Wrench, prompt: "Help me fix an issue in " },
  { id: "review", label: "Review project", icon: ScanSearch, prompt: "Review my project and tell me what to improve" },
  { id: "create", label: "Create media", icon: Wand2, prompt: "Create " },
];

const PROJECT_SUGGESTIONS = [
  "Continue improving Studio",
  "Run a complete project health check",
  "Find mobile interaction issues",
  "Review recent changes",
  "Make this project more premium",
];

/**
 * WorkspaceBriefing — proactive, truthful report framed as LiTT's checks.
 * Derived only from real capabilities + model health. No fabricated metrics.
 * Renders only when a capabilities object is supplied, so the empty state
 * degrades gracefully to the legacy headline-only layout when no data is wired.
 *
 * Framed as a checklist ("Checked GitHub ✓ / Checked AI ✓ / ...") so the AI
 * feels proactive rather than waiting, per the UX audit's #1 ask.
 */
function WorkspaceBriefing({
  capabilities,
  modelHealth,
  modelLabel,
}: {
  capabilities: ConnectionCapabilities;
  modelHealth?: ProviderHealth;
  modelLabel?: string;
}) {
  const repoConnected =
    capabilities.repository === "connected" || !!capabilities.repositoryName;
  const aiReady = modelHealth === "available" || modelHealth === "degraded";
  const termReady = capabilities.terminalExecution === "available";
  const termConnecting = capabilities.terminalExecution === "connecting";
  const projectLoaded = !!capabilities.projectId;

  // Each "check" LiTT performs on load — state is real, not fabricated.
  type CheckState = "ok" | "warn" | "pending";
  const checks: { label: string; state: CheckState; detail?: string }[] = [
    {
      label: "Checked GitHub",
      state: repoConnected ? "ok" : capabilities.githubInstalled ? "warn" : "pending",
      detail: repoConnected
        ? capabilities.repositoryName ?? "repository synced"
        : capabilities.githubInstalled
          ? "app installed, no repo linked"
          : "not connected",
    },
    {
      label: "Checked AI provider",
      state: aiReady ? "ok" : "warn",
      detail: aiReady ? `${modelLabel || "AI"} ready` : "setup required",
    },
    {
      label: "Checked terminal",
      state: termReady ? "ok" : termConnecting ? "pending" : "pending",
      detail: termReady ? "ready" : termConnecting ? "connecting…" : "open Activity to connect",
    },
    {
      label: "Loaded project",
      state: projectLoaded ? "ok" : "pending",
      detail: projectLoaded ? (capabilities.projectName ?? "loaded") : "no project yet",
    },
  ];

  const okCount = checks.filter((c) => c.state === "ok").length;
  const warnCount = checks.filter((c) => c.state === "warn").length;
  const pendingCount = checks.filter((c) => c.state === "pending").length;

  // Findings — only real ones. Warnings come from connection gaps; no
  // fabricated "improvements" since there's no project-scan backend.
  const findings: string[] = [];
  if (warnCount > 0) findings.push(`${warnCount} need${warnCount === 1 ? "s" : ""} attention`);
  if (pendingCount > 0 && warnCount === 0) findings.push(`${pendingCount} pending`);

  const ready = warnCount === 0;
  const headline = ready
    ? "Workspace ready"
    : `${warnCount} need${warnCount === 1 ? "" : "s"} attention`;

  const stateColor: Record<CheckState, string> = {
    ok: "var(--litt-primary)",
    warn: "#e3b341",
    pending: "var(--text-muted)",
  };

  return (
    <div
      className="mt-4 w-full max-w-md rounded-xl border px-3.5 py-3"
      style={{
        borderColor: "rgba(114,242,56,0.18)",
        backgroundColor: "rgba(114,242,56,0.04)",
        boxShadow: "inset 0 1px 0 rgba(114,242,56,0.06)",
      }}
      data-testid="workspace-briefing"
    >
      <div
        className="mb-2.5 text-[10px] font-black uppercase tracking-[0.18em]"
        style={{
          color: "#9dff5e",
          textShadow: "0 0 12px rgba(157,255,94,0.35)",
        }}
      >
        LiTT checked your workspace
      </div>
      <ul className="space-y-1.5">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center gap-2 text-[11px]">
            <span
              className="grid h-4 w-4 shrink-0 place-items-center rounded-full"
              style={{
                backgroundColor: `${stateColor[c.state]}18`,
                border: `1px solid ${stateColor[c.state]}40`,
                color: stateColor[c.state],
              }}
              aria-hidden
            >
              {c.state === "ok" ? (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              ) : c.state === "warn" ? (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4 M12 17h.01 M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
              ) : (
                <span className="h-1 w-1 rounded-full" style={{ backgroundColor: stateColor[c.state] }} />
              )}
            </span>
            <span className="font-bold" style={{ color: "var(--text-primary)" }}>{c.label}</span>
            <span className="ml-auto truncate text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
              {c.detail}
            </span>
          </li>
        ))}
      </ul>
      <div
        className="mt-2.5 flex items-center gap-2 border-t pt-2 text-[11px] font-bold"
        style={{ borderColor: "rgba(114,242,56,0.12)", color: ready ? "var(--litt-primary)" : "#e3b341" }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          aria-hidden
          style={{ backgroundColor: ready ? "var(--litt-primary)" : "#e3b341" }}
        />
        {ready ? "Ready to continue?" : headline}
        {ready && (
          <span className="ml-auto text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
            {okCount}/{checks.length} checks passed
          </span>
        )}
      </div>
    </div>
  );
}

export default function LiTEmptyState({
  activeAgentId = "litt",
  hasProject,
  projectName,
  sourceType,
  githubInstalled,
  onPick,
  onConnectRepo,
  onStartBlank,
  capabilities,
  modelHealth,
  modelLabel,
}: {
  activeAgentId?: AgentId;
  hasProject: boolean;
  /** Accepted for backwards compatibility; readiness is derived from hasProject. */
  projectId?: string | null;
  projectName: string | null;
  sourceType: "github" | "blank" | "template" | null;
  githubInstalled: boolean;
  onPick: (prompt: string) => void;
  onConnectRepo?: () => void;
  onStartBlank?: () => void;
  /** Live workspace capabilities. When omitted, the briefing panel is skipped. */
  capabilities?: ConnectionCapabilities;
  modelHealth?: ProviderHealth;
  modelLabel?: string;
}) {
  const [hovered, setHovered] = useState<PrimaryAction | null>(null);

  return (
    <div
      className="flex min-h-full flex-col items-center justify-center px-4 py-4 sm:py-6"
      style={{ color: "var(--text-primary)" }}
      data-testid="empty-state"
    >
      {/* Active character — clean transparent art, no framed black bars. */}
      <div className="relative mb-2 grid min-h-[104px] place-items-center">
        {activeAgentId === "litt" ? (
          <LiTTPresence state="idle" variant="empty-state" size="sm" />
        ) : (
          <div
            className="relative grid h-24 w-24 place-items-center overflow-hidden rounded-full border"
            style={{
              borderColor: "rgba(244,114,182,.35)",
              background: "radial-gradient(circle, rgba(244,114,182,.14), transparent 70%)",
              boxShadow: "0 0 32px rgba(244,114,182,.14)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/spark-agent-portrait.png" alt="Spark" className="h-full w-full object-cover" />
          </div>
        )}
        <span
          className="absolute -bottom-1 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[.16em]"
          style={{
            borderColor: activeAgentId === "spark" ? "rgba(244,114,182,.35)" : "rgba(114,242,56,.35)",
            backgroundColor: "var(--studio-bg)",
            color: activeAgentId === "spark" ? "var(--spark-primary)" : "var(--litt-primary)",
          }}
        >
          {activeAgentId === "spark" ? "Spark · Creative" : "LiTT · Operating"}
        </span>
      </div>

      {/* Headline */}
      <h1
        className="text-center text-xl font-black tracking-tight sm:text-2xl"
        style={{ color: "var(--text-primary)" }}
      >
        {activeAgentId === "spark" ? "What should we create today?" : "What are we building today?"}
      </h1>

      {/* Supporting copy */}
      <p
        className="mt-2 max-w-md text-center text-[13px] leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        {hasProject
          ? "I can inspect your project, edit code, run checks, create media, repair issues, and prepare a preview."
          : "Chat with me now. Add a project only when you want files, code edits, preview, terminal, or deployment."}
      </p>

      {/* Proactive workspace briefing — only when live capabilities are wired in */}
      {capabilities && (
        <WorkspaceBriefing
          capabilities={capabilities}
          modelHealth={modelHealth}
          modelLabel={modelLabel}
        />
      )}

      {/* Primary actions */}
      <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-2">
        {PRIMARY_ACTIONS.map((action) => {
          const Icon = action.icon;
          const isHovered = hovered === action.id;
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => onPick(action.prompt)}
              onMouseEnter={() => setHovered(action.id)}
              onMouseLeave={() => setHovered(null)}
              className="group flex items-center gap-2.5 rounded-xl border px-3 py-3 text-left transition-all hover:-translate-y-0.5 active:scale-95"
              style={{
                borderColor: isHovered ? "rgba(114,242,56,0.4)" : "var(--studio-border-strong)",
                backgroundColor: isHovered ? "rgba(114,242,56,0.06)" : "var(--studio-card)",
                boxShadow: isHovered ? "0 0 0 1px rgba(114,242,56,0.15), 0 8px 24px rgba(114,242,56,0.08)" : "none",
              }}
              aria-label={action.label}
            >
              <Icon
                size={16}
                className="pointer-events-none shrink-0"
                style={{ color: isHovered ? "var(--litt-primary)" : "var(--text-secondary)" }}
              />
              <span
                className="text-[12px] font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                {action.label}
              </span>
              <ArrowRight
                size={12}
                className="ml-auto pointer-events-none shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: "var(--litt-primary)" }}
              />
            </button>
          );
        })}
      </div>

      {/* Project-aware suggestions OR no-project actions */}
      <div className="mt-6 w-full max-w-md">
        {hasProject ? (
          <div className="flex flex-col gap-1.5">
            {sourceType === "blank" && (
              <div
                className="mb-1 rounded-lg border px-3 py-2 text-[11px] font-bold"
                style={{
                  borderColor: "rgba(114,242,56,0.25)",
                  backgroundColor: "rgba(114,242,56,0.06)",
                  color: "var(--litt-primary)",
                }}
                data-testid="active-project-name"
              >
                Blank project ready — {projectName ?? "Untitled"}
              </div>
            )}
            {sourceType === "github" && projectName && (
              <div
                className="mb-1 rounded-lg border px-3 py-2 text-[11px] font-bold"
                style={{
                  borderColor: "rgba(114,242,56,0.25)",
                  backgroundColor: "rgba(114,242,56,0.06)",
                  color: "var(--litt-primary)",
                }}
                data-testid="active-project-name"
              >
                {projectName}
              </div>
            )}
            <div
              className="px-1 text-[10px] font-black uppercase tracking-[0.18em]"
              style={{ color: "var(--text-muted)" }}
            >
              Suggestions
            </div>
            {PROJECT_SUGGESTIONS.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => onPick(s)}
                className="group flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-[12px] font-bold transition-all hover:translate-x-0.5 hover:border-[rgba(114,242,56,0.3)] active:scale-[0.98]"
                style={{
                  color: "var(--text-primary)",
                  borderColor: "var(--studio-border-strong)",
                  backgroundColor: "var(--studio-card)",
                }}
                aria-label={s}
              >
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-black"
                  style={{
                    backgroundColor: "rgba(114,242,56,0.10)",
                    color: "var(--litt-primary)",
                    border: "1px solid rgba(114,242,56,0.22)",
                  }}
                  aria-hidden
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1">{s}</span>
                <ArrowRight
                  size={12}
                  className="pointer-events-none shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: "var(--litt-primary)" }}
                />
              </button>
            ))}
          </div>
        ) : githubInstalled ? (
          /* GitHub installed but no project selected */
          <div className="flex flex-col gap-2">
            <div
              className="px-1 text-[10px] font-black uppercase tracking-[0.18em]"
              style={{ color: "var(--text-muted)" }}
            >
              GitHub connected — select a repository
            </div>
            <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
              Your GitHub app is installed, but no repository has been linked to a project yet.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <NoProjectAction
                icon={GithubMark}
                label="Connect repo"
                onClick={onConnectRepo}
              />
              <NoProjectAction
                icon={FilePlus2}
                label="Start blank"
                onClick={onStartBlank}
              />
            </div>
          </div>
        ) : (
          /* No GitHub installation at all */
          <div className="flex flex-col gap-2">
            <div
              className="px-1 text-[10px] font-black uppercase tracking-[0.18em]"
              style={{ color: "var(--text-muted)" }}
            >
              Chat ready · workspace optional
            </div>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Add one only when you want LiTT to edit files, run terminal commands, preview, or deploy.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <NoProjectAction
                icon={FilePlus2}
                label="Start blank"
                onClick={onStartBlank}
              />
              <NoProjectAction
                icon={GithubMark}
                label="Connect repo"
                onClick={onConnectRepo}
              />
              <NoProjectAction
                icon={Upload}
                label="Upload project"
                onClick={onStartBlank}
              />
            </div>
          </div>
        )}
      </div>

      {/* Live activity timeline — fills dead space with real recent chats
          and deploys. Only when a project is loaded so the no-project state
          stays focused on connect actions. Renders nothing if both sources
          are empty. */}
      {hasProject && <StudioActivityTimeline />}
    </div>
  );
}

function NoProjectAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 transition-all hover:-translate-y-0.5 hover:bg-white/5 active:scale-95"
      style={{
        borderColor: "var(--studio-border-strong)",
        backgroundColor: "var(--studio-card)",
        color: "var(--text-secondary)",
      }}
      aria-label={label}
      data-testid={label === "Start blank" ? "new-project-button" : undefined}
    >
      <Icon size={16} className="pointer-events-none" style={{ color: "var(--litt-primary)" }} />
      <span className="text-[11px] font-bold">{label}</span>
    </button>
  );
}
