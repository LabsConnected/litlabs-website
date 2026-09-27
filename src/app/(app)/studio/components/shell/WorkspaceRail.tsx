"use client";

/**
 * WorkspaceRail — the shell's left tool rail (Figma-style).
 *
 * Compact icon rail that switches the central Stage surface. Pure view —
 * the caller owns the active surface and persistence.
 */
import {
  PRIMARY_SURFACES,
  STAGE_SURFACE_META,
  UTILITY_SURFACES,
  type StudioStageSurface,
} from "./stage-surfaces";

export default function WorkspaceRail({
  active,
  onSelect,
  onCreateWorkspace,
}: {
  active: StudioStageSurface;
  onSelect: (surface: StudioStageSurface) => void;
  onCreateWorkspace?: (kind: "chat" | "task" | "note") => void;
}) {
  const item = (id: StudioStageSurface) => {
    const meta = STAGE_SURFACE_META[id];
    const Icon = meta.icon;
    const isActive = active === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onSelect(id)}
        aria-label={`${meta.label} workspace`}
        aria-pressed={isActive}
        title={meta.hint}
        data-testid={`workspace-rail-${id}`}
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
          isActive ? "" : "hover:bg-white/5"
        }`}
        style={{
          color: isActive ? "var(--text-main)" : "var(--text-muted)",
          backgroundColor: isActive ? "var(--purple-soft)" : undefined,
        }}
      >
        {isActive && (
          <span
            aria-hidden
            className="absolute -left-[7px] h-5 w-0.5 rounded-full"
            style={{ background: "var(--purple)", boxShadow: "0 0 6px rgba(139,92,246,0.5)" }}
          />
        )}
        <Icon size={16} className="pointer-events-none" />
      </button>
    );
  };

  return (
    <nav
      aria-label="Workspace surfaces"
      className="glass-shell flex w-12 shrink-0 flex-col items-center gap-1 border-r px-1 py-2"
      style={{ borderColor: "rgba(155,77,255,0.1)", backgroundColor: "rgba(13,9,22,0.85)" }}
      data-testid="studio-workspace-rail"
    >
      {PRIMARY_SURFACES.map(item)}
      {onCreateWorkspace ? (
        <div className="mt-2 flex flex-col gap-1" data-testid="workspace-rail-create">
          {(["chat", "task", "note"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              data-testid={`workspace-rail-new-${kind}`}
              aria-label={`New workspace ${kind}`}
              title={`New ${kind}`}
              className="flex h-7 w-9 items-center justify-center rounded text-[9px] uppercase text-white/70 hover:bg-white/5"
              onClick={() => onCreateWorkspace(kind)}
            >
              {kind.slice(0, 1)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1" />
      {UTILITY_SURFACES.map(item)}
    </nav>
  );
}
