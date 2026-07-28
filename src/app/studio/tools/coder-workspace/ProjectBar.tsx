/**
 * ProjectBar — top status bar showing project selector + workspace status.
 */

import type { StudioProject } from "./types";

interface ThemeColors {
  borderColor: string;
}

export function ProjectBar({
  projects,
  projectId,
  onSelect,
  onRefresh,
  loading,
  T,
}: {
  projects: StudioProject[];
  projectId: string;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  loading: boolean;
  T: ThemeColors;
}) {
  const selected = projects.find((p) => p.id === projectId) ?? null;
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
      style={{ borderColor: `${T.borderColor}30` }}
    >
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/50">
        Project
      </span>
      {loading ? (
        <span className="text-[11px] text-white/40">Loading…</span>
      ) : projects.length === 0 ? (
        <span className="text-[11px] text-white/40">No projects yet</span>
      ) : (
        <select
          value={projectId}
          onChange={(e) => onSelect(e.target.value)}
          className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white outline-none"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.sourceType})
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={onRefresh}
        className="text-[10px] text-white/40 hover:text-white/70"
        aria-label="Refresh projects"
      >
        ↻
      </button>
      {selected && (
        <span className="ml-auto text-[10px] text-white/40">
          {selected.framework ?? "static"} · ws:{selected.workspaceStatus}
        </span>
      )}
    </div>
  );
}
