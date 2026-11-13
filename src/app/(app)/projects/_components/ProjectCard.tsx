/**
 * ProjectCard — one project in the /projects grid.
 *
 * Data: renders the fields GET /api/studio-projects already returns
 * (the Phase 1 audit found the old page dropped several: createdAt,
 * workspaceBranch, framework, workspaceType, templateId, accessMode,
 * previewUrl, latestCommitSha). No backend change is involved.
 *
 * Art: there is NO project thumbnail/screenshot data source anywhere
 * in the product, so the card art is a branded placeholder (gradient
 * panel in the pack palette + the LiTTree sprout mark) — never a fake
 * screenshot and never a per-card live-preview iframe.
 *
 * Behavior is preserved from the pre-redesign inline card: the whole
 * card is the Open/Resume navigation (a select-mode tap toggles
 * selection instead), Retry setup renders ONLY when
 * describeProjectState says canRetry (so the "Repo workspace
 * unavailable" state shows its honest badge with NO retry —
 * Decision B), and the per-card Delete button keeps its exact
 * affordance and aria-label (test-pinned).
 */

import Link from "next/link";
import { ArrowRight, Loader2, RefreshCw, Sprout, Trash2 } from "lucide-react";
import type { AppShellColors } from "@/components/app-shell/LiTTAppShell";
import {
  describeProjectState,
  type ProjectStateDescription,
} from "@/lib/projects/project-state";
import ProjectStatusBadge from "./ProjectStatusBadge";

export type ProjectCardData = {
  id: string;
  name: string;
  sourceType: "github" | "blank" | "template";
  githubFullName: string | null;
  githubBranch: string | null;
  workspaceBranch?: string | null;
  workspaceStatus: string;
  runtimeStatus: string;
  updatedAt: string;
  createdAt?: string | null;
  workspaceError?: string | null;
  runtimeError?: string | null;
  framework?: string | null;
  workspaceType?: string | null;
  templateId?: string | null;
  accessMode?: string | null;
  previewUrl?: string | null;
  latestCommitSha?: string | null;
};

interface ProjectCardProps {
  project: ProjectCardData;
  colors: AppShellColors;
  selectMode: boolean;
  isSelected: boolean;
  isResumable: boolean;
  retrying: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete: (project: ProjectCardData) => void;
}

function typeLine(project: ProjectCardData): string {
  if (project.githubFullName) return project.githubFullName;
  return project.sourceType === "blank" ? "LiTT project" : "Template project";
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toLocaleDateString();
}

export default function ProjectCard({
  project,
  colors: T,
  selectMode,
  isSelected,
  isResumable,
  retrying,
  onToggleSelect,
  onOpen,
  onRetry,
  onDelete,
}: ProjectCardProps) {
  const state: ProjectStateDescription = describeProjectState(project);
  // workspaceBranch is authoritative over the GitHub branch fields
  // (types.ts) — prefer it, as the audit directs.
  const branch = project.workspaceBranch ?? project.githubBranch;
  const updated = formatDate(project.updatedAt);
  const created = formatDate(project.createdAt);
  const name = project.name || "Untitled project";

  return (
    <Link
      href={selectMode ? "#" : `/studio?project=${encodeURIComponent(project.id)}`}
      onClick={
        selectMode
          ? (e) => {
              e.preventDefault();
              onToggleSelect(project.id);
            }
          : () => onOpen(project.id)
      }
      aria-pressed={selectMode ? isSelected : undefined}
      className={`group relative flex flex-col gap-3 rounded-2xl border p-4 transition-transform hover:-translate-y-0.5 ${
        selectMode && isSelected ? "ring-2 ring-accent/60" : ""
      }`}
      style={{ backgroundColor: `${T.boxBg}b8`, borderColor: `${T.borderColor}45` }}
    >
      {selectMode && (
        <span
          aria-hidden="true"
          className="absolute left-3 top-3 z-10 inline-flex h-6 w-6 items-center justify-center rounded-lg border text-transparent"
          style={{
            borderColor: `${T.borderColor}88`,
            backgroundColor: isSelected ? T.accentColor : "transparent",
            color: isSelected ? T.bgColor : "transparent",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
      )}

      {/* Branded placeholder art — no thumbnail data source exists. */}
      <div
        aria-hidden="true"
        className="relative flex h-28 items-center justify-center overflow-hidden rounded-xl border"
        style={{
          background: `linear-gradient(135deg, ${T.accentColor}18, ${T.elevatedBg ?? T.boxBg} 55%, ${T.bgColor})`,
          borderColor: `${T.borderColor}35`,
        }}
      >
        <Sprout size={40} style={{ color: T.accentColor }} />
        <span
          className="absolute bottom-2 left-3 text-[9px] font-black uppercase tracking-[0.18em]"
          style={{ color: T.textMuted }}
        >
          {project.workspaceType || project.framework || typeLine(project)}
        </span>
        {project.previewUrl && (
          <span
            className="absolute right-3 top-2 rounded-full px-2 py-0.5 text-[9px] font-black uppercase"
            style={{
              backgroundColor: `${T.accentColor}18`,
              color: T.accentColor,
              border: `1px solid ${T.accentColor}35`,
            }}
          >
            Preview live
          </span>
        )}
      </div>

      <div className={`flex items-start justify-between gap-3 ${selectMode ? "pl-8" : ""}`}>
        <div className="min-w-0">
          <div className="truncate text-sm font-black" style={{ color: T.headerColor }}>
            {name}
          </div>
          <div className="mt-1 truncate text-[11px]" style={{ color: T.textMuted }}>
            {typeLine(project)}
          </div>
        </div>
        <ProjectStatusBadge state={state} resumable={isResumable} accentColor={T.accentColor} />
      </div>

      {state.detail && (
        <p className="text-[11px] leading-relaxed" style={{ color: state.color }}>
          {state.detail}
        </p>
      )}

      <div className="mt-auto flex items-end justify-between gap-3 text-[11px]" style={{ color: T.textMuted }}>
        <span className="min-w-0 truncate">
          {branch ? `Branch: ${branch}` : updated ? `Updated ${updated}` : ""}
          {branch && updated ? ` · Updated ${updated}` : ""}
          {created && created !== updated ? ` · Created ${created}` : ""}
        </span>
        {selectMode ? (
          <span className="inline-flex shrink-0 items-center gap-1 font-bold" style={{ color: T.accentColor }}>
            {isSelected ? "Selected" : "Tap to select"}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-2">
            {state.canRetry && (
              <button
                type="button"
                aria-label={`Retry setup for ${name}`}
                title="Retry setup"
                disabled={retrying}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRetry(project.id);
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[11px] font-black disabled:opacity-50"
                style={{ borderColor: `${T.accentColor}55`, color: T.accentColor }}
              >
                {retrying ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {retrying ? "Retrying…" : "Retry setup"}
              </button>
            )}
            <button
              type="button"
              aria-label={`Delete ${name}`}
              title="Delete project"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(project);
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-400/30 text-red-500/80 opacity-70 transition-opacity hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
            <span className="inline-flex items-center gap-1 font-bold" style={{ color: T.accentColor }}>
              {isResumable ? "Resume" : "Open"} <ArrowRight size={12} />
            </span>
          </span>
        )}
      </div>
    </Link>
  );
}
