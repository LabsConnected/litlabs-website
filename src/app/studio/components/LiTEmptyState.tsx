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
import type { AgentId } from "../stores/useStudioAgentStore";

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

export default function LiTEmptyState({
  activeAgentId = "litt",
  hasProject,
  projectName,
  sourceType,
  githubInstalled,
  onPick,
  onConnectRepo,
  onStartBlank,
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
}) {
  const [hovered, setHovered] = useState<PrimaryAction | null>(null);

  return (
    <div
      className="flex min-h-full flex-col items-center justify-center px-4 py-4 sm:py-6"
      style={{ color: "var(--text-primary)" }}
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
              className="group flex items-center gap-2.5 rounded-xl border px-3 py-3 text-left transition-all"
              style={{
                borderColor: isHovered ? "rgba(114,242,56,0.4)" : "var(--studio-border-strong)",
                backgroundColor: isHovered ? "rgba(114,242,56,0.06)" : "var(--studio-card)",
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
            {PROJECT_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onPick(s)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium transition-colors hover:bg-white/5"
                style={{ color: "var(--text-secondary)" }}
              >
                <span
                  className="h-1 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: "var(--litt-primary)" }}
                  aria-hidden
                />
                {s}
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
              No project connected
            </div>
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
      className="flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 transition-all hover:bg-white/5"
      style={{
        borderColor: "var(--studio-border-strong)",
        backgroundColor: "var(--studio-card)",
        color: "var(--text-secondary)",
      }}
      aria-label={label}
    >
      <Icon size={16} className="pointer-events-none" style={{ color: "var(--litt-primary)" }} />
      <span className="text-[11px] font-bold">{label}</span>
    </button>
  );
}
