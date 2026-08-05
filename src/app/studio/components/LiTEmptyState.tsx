"use client";

import { useState } from "react";
import {
  Hammer,
  Wrench,
  ScanSearch,
  Wand2,
  ArrowRight,
  Sparkles,
  Upload,
  FilePlus2,
  Bot,
  BarChart3,
  Code2,
  FileText,
  Globe,
  Image as ImageIcon,
  Music2,
  Video,
} from "lucide-react";
import LiTTPresence from "./LiTTPresence";
import StudioActivityTimeline from "./StudioActivityTimeline";
import { STUDIO_AGENTS } from "../stores/useStudioAgentStore";
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
  { id: "build", label: "Deploy my website", icon: Hammer, prompt: "Deploy my website and show me what needs attention" },
  { id: "fix", label: "Fix all TypeScript errors", icon: Wrench, prompt: "Find and fix all TypeScript errors in this project" },
  { id: "review", label: "Scan project health", icon: ScanSearch, prompt: "Run a complete project health check and summarize what matters" },
  { id: "create", label: "Create artwork", icon: Wand2, prompt: "Generate artwork for this project" },
];

const PROJECT_SUGGESTIONS = [
  "🚀 Deploy my website",
  "🎵 Make a new song",
  "🖼 Generate artwork",
  "🧠 Scan project health",
  "⚡ Fix all TypeScript errors",
  "📱 Optimize mobile",
  "🔍 Improve SEO",
  "💰 Monetize my project",
];

const QUICK_ACTIONS = [
  { label: "Images", icon: ImageIcon, prompt: "Create a polished image for this project" },
  { label: "Music", icon: Music2, prompt: "Make a new song for this project" },
  { label: "Video", icon: Video, prompt: "Plan a short video for this project" },
  { label: "Code", icon: Code2, prompt: "Fix all TypeScript errors in this project" },
  { label: "Website", icon: Globe, prompt: "Deploy my website and improve the experience" },
  { label: "Docs", icon: FileText, prompt: "Improve the documentation and onboarding" },
  { label: "Analytics", icon: BarChart3, prompt: "Scan project health and summarize the numbers" },
  { label: "Agents", icon: Bot, prompt: "Show me the running agents and what they are doing" },
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
        {checks.map((c, i) => (
          <li
            key={c.label}
            className="flex items-center gap-2 text-[11px] animate-fadeInUp"
            style={{ animationDelay: `${i * 60}ms` }}
          >
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
  displayName,
  onPickAction,
  onConnectRepoAction,
  onStartBlankAction,
  capabilities,
  modelHealth,
  modelLabel,
}: {
  activeAgentId?: AgentId;
  hasProject: boolean;
  /** Accepted for backwards compatibility; readiness is derived from hasProject. */
  projectId?: string | null;
  projectName: string | null;
  sourceType: "github" | "blank" | "template" | "upload" | null;
  githubInstalled: boolean;
  displayName?: string | null;
  onPickAction?: (prompt: string) => void;
  onConnectRepoAction?: () => void;
  onStartBlankAction?: () => void;
  /** Live workspace capabilities. When omitted, the briefing panel is skipped. */
  capabilities?: ConnectionCapabilities;
  modelHealth?: ProviderHealth;
  modelLabel?: string;
}) {
  const [hovered, setHovered] = useState<PrimaryAction | null>(null);
  const onPick = onPickAction ?? (() => {});
  const greetingName = displayName?.trim() || "there";
  const connectedProviderCount = capabilities?.connectedProviders?.length ?? 0;
  const voiceReady = capabilities?.voiceHealth.available ?? false;

  return (
    <div
      className="relative flex min-h-full flex-col items-center justify-center overflow-hidden px-4 py-4 sm:py-6 animate-fadeInUp"
      style={{ color: "var(--text-primary)" }}
      data-testid="empty-state"
      aria-live="polite"
      aria-label="Workspace briefing"
    >


      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-5">
      {/* Active character — clean transparent art, no framed black bars. */}
      <div className="relative mb-3 grid min-h-[160px] place-items-center">
        {activeAgentId === "litt" ? (
          <LiTTPresence state="idle" variant="empty-state" size="xl" />
        ) : (
          <div
            className="relative grid h-36 w-36 place-items-center overflow-hidden rounded-full border"
            style={{
              borderColor: "rgba(244,114,182,.45)",
              background: "radial-gradient(circle, rgba(244,114,182,.2), transparent 70%)",
              boxShadow: "0 0 36px rgba(244,114,182,.25)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/spark-agent-portrait.png" alt="Spark" className="h-full w-full object-contain p-1" />
          </div>
        )}
        <span
          className="absolute -bottom-2 rounded-full border px-3 py-0.5 text-[9.5px] font-black uppercase tracking-[.18em]"
          style={{
            borderColor: activeAgentId === "spark" ? "rgba(244,114,182,.45)" : "rgba(114,242,56,.45)",
            backgroundColor: "#0D0916",
            color: activeAgentId === "spark" ? "var(--spark-primary)" : "var(--litt-primary)",
            boxShadow: activeAgentId === "spark" ? "0 0 12px rgba(244,114,182,.2)" : "0 0 12px rgba(114,242,56,.2)",
          }}
        >
          {activeAgentId === "spark" ? "Spark · Creative" : "LiTT · Operating"}
        </span>
      </div>

      <div className="text-center">
        <div
          className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em]"
          style={{
            borderColor: "rgba(114,242,56,0.22)",
            backgroundColor: "rgba(114,242,56,0.06)",
            color: "var(--litt-primary)",
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#72f238]" />
          {hasProject ? "Workspace online" : "Workspace ready"}
        </div>
        <h1
          className="mt-3 text-center text-xl font-black tracking-tight sm:text-2xl lg:text-3xl"
          style={{ color: "var(--text-primary)" }}
        >
          👋 Welcome back, {greetingName}.
        </h1>
        <p
          className="mx-auto mt-2 max-w-2xl text-center text-[13px] leading-relaxed sm:text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          {hasProject
            ? `Your ${projectName ?? "workspace"} is connected. LiTT can inspect files, edit code, run checks, and prepare deployment.`
            : "LiTT is ready to start from zero, or pick up a connected workspace the moment you attach one."}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em]">
          {[
            `${STUDIO_AGENTS.length} agents ready`,
            `${connectedProviderCount} AI providers`,
            voiceReady ? "Voice live" : "Voice offline",
            hasProject ? "Project linked" : "No project linked",
          ].map((item) => (
            <span
              key={item}
              className="rounded-full border px-3 py-1"
              style={{ borderColor: "var(--studio-border-strong)", color: "var(--text-secondary)" }}
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className="w-full">
        <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
          Quick actions
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                onClick={() => onPickAction?.(action.prompt)}
                className="flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-bold transition hover:-translate-y-0.5 hover:border-[rgba(114,242,56,0.3)]"
                style={{
                  borderColor: "var(--studio-border-strong)",
                  backgroundColor: "var(--studio-card)",
                  color: "var(--text-primary)",
                }}
              >
                <Icon size={13} style={{ color: "var(--litt-primary)" }} />
                {action.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid w-full gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <section
          className="rounded-[24px] border p-4 sm:p-5"
          style={{ borderColor: "var(--studio-border)", backgroundColor: "rgba(13,16,24,0.9)" }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
                Recent projects
              </div>
              <h2 className="mt-1 text-lg font-black" style={{ color: "var(--text-primary)" }}>
                Continue where you left off
              </h2>
            </div>
            <span className="rounded-full border px-2.5 py-1 text-[10px] font-bold" style={{ borderColor: "rgba(114,242,56,0.18)", color: "var(--litt-primary)" }}>
              OS mode
            </span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              { label: "Continue website", prompt: "Continue building my website and improve the user experience" },
              { label: "Continue music", prompt: "Make a new song and refine the arrangement" },
              { label: "Continue images", prompt: "Generate artwork and polish the visual direction" },
              { label: "Run health scan", prompt: "Scan project health and summarize what needs attention" },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onPickAction?.(item.prompt)}
                className="group flex min-h-11 items-center gap-2 rounded-xl border px-3 py-3 text-left transition hover:-translate-y-0.5"
                style={{ borderColor: "var(--studio-border-strong)", backgroundColor: "var(--studio-card)" }}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: "rgba(114,242,56,0.08)", color: "var(--litt-primary)" }}>
                  <Sparkles size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>{item.label}</span>
                  <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>One tap to restart momentum</span>
                </span>
                <ArrowRight size={12} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--litt-primary)" }} />
              </button>
            ))}
          </div>
        </section>

        <section
          className="rounded-[24px] border p-4 sm:p-5"
          style={{ borderColor: "var(--studio-border)", backgroundColor: "rgba(13,16,24,0.9)" }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
                Live workspace
              </div>
              <h2 className="mt-1 text-lg font-black" style={{ color: "var(--text-primary)" }}>
                LiTT is awake
              </h2>
            </div>
            <span className="rounded-full border px-2.5 py-1 text-[10px] font-bold" style={{ borderColor: "rgba(34,211,238,0.18)", color: "#65f4ff" }}>
              {hasProject ? "Connected" : "Standby"}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              { label: "Agents ready", value: STUDIO_AGENTS.length },
              { label: "AI providers", value: connectedProviderCount || 0 },
              { label: "Voice", value: voiceReady ? "On" : "Off" },
              { label: "Project", value: hasProject ? "Linked" : "None" },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--studio-border-strong)", backgroundColor: "rgba(255,255,255,0.02)" }}>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>{item.label}</div>
                <div className="mt-2 text-lg font-black" style={{ color: "var(--text-primary)" }}>{item.value}</div>
              </div>
            ))}
          </div>

          {capabilities && (
            <div className="mt-4">
              <WorkspaceBriefing
                capabilities={capabilities}
                modelHealth={modelHealth}
                modelLabel={modelLabel}
              />
            </div>
          )}
        </section>
      </div>

      <div className="grid w-full gap-4 xl:grid-cols-[1.25fr_.85fr]">
        <section
          className="rounded-[24px] border p-4 sm:p-5"
          style={{ borderColor: "var(--studio-border)", backgroundColor: "rgba(13,16,24,0.9)" }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
                Recent chats
              </div>
              <h2 className="mt-1 text-lg font-black" style={{ color: "var(--text-primary)" }}>
                Keep the conversation moving
              </h2>
            </div>
          </div>
          <StudioActivityTimeline />
        </section>

        <section
          className="rounded-[24px] border p-4 sm:p-5"
          style={{ borderColor: "var(--studio-border)", backgroundColor: "rgba(13,16,24,0.9)" }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
                Recent files
              </div>
              <h2 className="mt-1 text-lg font-black" style={{ color: "var(--text-primary)" }}>
                Start from the right place
              </h2>
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            {[
              { label: "Scan latest changes", prompt: "Review the latest changes in my project and tell me what matters" },
              { label: "Open file tree", prompt: "Open the project file tree and help me navigate the codebase" },
              { label: "Review build output", prompt: "Review the latest build output and fix anything broken" },
              { label: "Check SEO", prompt: "Improve the SEO metadata and page structure" },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onPick(item.prompt)}
                className="group flex items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition hover:-translate-y-0.5"
                style={{ borderColor: "var(--studio-border-strong)", backgroundColor: "var(--studio-card)" }}
              >
                <span className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>{item.label}</span>
                <ArrowRight size={12} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--litt-primary)" }} />
              </button>
            ))}
          </div>
        </section>
      </div>

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
                onClick={onConnectRepoAction}
              />
              <NoProjectAction
                icon={FilePlus2}
                label="Start blank"
                onClick={onStartBlankAction}
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
                onClick={onStartBlankAction}
              />
              <NoProjectAction
                icon={GithubMark}
                label="Connect repo"
                onClick={onConnectRepoAction}
              />
              <NoProjectAction
                icon={Upload}
                label="Upload project"
                onClick={onStartBlankAction}
              />
            </div>
          </div>
        )}
      </div>

      </div>
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
