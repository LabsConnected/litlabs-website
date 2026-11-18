"use client";

/**
 * WorkspaceRail — the shell's left workspace rail.
 *
 * Phase 2 (Master Build Directive §2): the MAIN navigation is exactly
 * the five Directive stages — Plan, Canvas & Design, Code, Preview,
 * Media — presented as labeled stage buttons. Surfaces that are not
 * stages keep a home in the rail's secondary cluster (Files, Assets,
 * Deploy, Activity, Browser) and the utility slot (Terminal): nothing
 * was removed, it is simply no longer main navigation.
 *
 * Pure view — the caller owns the active stage/surface and persistence.
 */
import { useTheme } from "@/context/ThemeContext";
import {
  DIRECTIVE_STAGE_META,
  DIRECTIVE_STAGE_ORDER,
  SECONDARY_SURFACES,
  STAGE_SURFACE_META,
  UTILITY_SURFACES,
  surfaceToDirectiveStage,
  type StudioStageSurface,
} from "./stage-surfaces";
import type { DirectiveStage } from "../../lib/studio-destinations";

export default function WorkspaceRail({
  activeStage,
  activeSurface,
  onSelectStage,
  onSelectSurface,
}: {
  /** The Directive stage the center currently presents (null when a
      secondary surface is active instead). */
  activeStage: DirectiveStage | null;
  /** The exact center surface currently active. */
  activeSurface: StudioStageSurface;
  onSelectStage: (stage: DirectiveStage) => void;
  onSelectSurface: (surface: StudioStageSurface) => void;
}) {
  const { tokens } = useTheme();

  const stageButton = (stage: DirectiveStage) => {
    const meta = DIRECTIVE_STAGE_META[stage];
    const Icon = meta.icon;
    const isActive = activeStage === stage;
    return (
      <button
        key={stage}
        type="button"
        onClick={() => onSelectStage(stage)}
        aria-label={`${meta.label} stage`}
        aria-pressed={isActive}
        title={meta.hint}
        data-testid={`workspace-stage-${stage}`}
        className={`relative flex min-h-11 w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
          isActive ? "" : "hover:bg-[rgba(127,127,127,0.12)]"
        }`}
        style={{
          color: isActive ? "var(--text-main)" : "var(--text-muted)",
          backgroundColor: isActive
            ? "color-mix(in srgb, var(--color-accent) 14%, transparent)"
            : undefined,
        }}
      >
        {isActive && (
          <span
            aria-hidden
            className="absolute -left-[7px] h-5 w-0.5 rounded-full"
            style={{ background: "var(--color-accent)", boxShadow: "0 0 6px rgba(168,255,47,0.5)" }}
          />
        )}
        <Icon size={16} className="pointer-events-none" />
        <span className="pointer-events-none text-center text-[8px] font-bold leading-[1.1]">
          {meta.labelLines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </span>
      </button>
    );
  };

  const surfaceItem = (id: StudioStageSurface) => {
    const meta = STAGE_SURFACE_META[id];
    const Icon = meta.icon;
    const isActive = activeSurface === id && surfaceToDirectiveStage(id) === null;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onSelectSurface(id)}
        aria-label={`${meta.label} workspace`}
        aria-pressed={isActive}
        title={meta.hint}
        data-testid={`workspace-rail-${id}`}
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] lg:h-8 lg:w-8 ${
          isActive ? "" : "hover:bg-[rgba(127,127,127,0.12)]"
        }`}
        style={{
          color: isActive ? "var(--text-main)" : "var(--text-muted)",
          backgroundColor: isActive
            ? "color-mix(in srgb, var(--color-accent) 14%, transparent)"
            : undefined,
        }}
      >
        {isActive && (
          <span
            aria-hidden
            className="absolute -left-[7px] h-5 w-0.5 rounded-full"
            style={{ background: "var(--color-accent)", boxShadow: "0 0 6px rgba(168,255,47,0.5)" }}
          />
        )}
        <Icon size={16} className="pointer-events-none" />
      </button>
    );
  };

  return (
    <nav
      aria-label="Workspace stages"
      className="glass-shell flex w-12 shrink-0 flex-col items-center gap-1 border-r px-1 py-1.5 lg:w-11"
      style={{ borderColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)", backgroundColor: tokens.surface }}
      data-testid="studio-workspace-rail"
    >
      {/* Plan is the FIRST stage (Master Build Directive §2 order).
          Its rail button was retired on 2026-11-13 and restored on
          2026-11-14 after Larry's production walkthrough found no Plan
          stage anywhere in the nav. The button changes presentation
          only: selection still runs the station contract — Plan homes
          the center on Preview and opens the inspector's Plan tab
          (Mission / Checkpoints / Next actions); it is not a center
          station (see station-url.ts). */}
      {DIRECTIVE_STAGE_ORDER.map(stageButton)}
      <div
        aria-hidden
        className="my-1 h-px w-7 shrink-0"
        style={{ backgroundColor: "color-mix(in srgb, var(--color-accent) 16%, transparent)" }}
      />
      {SECONDARY_SURFACES.map(surfaceItem)}
      <div className="min-h-0 flex-1" />
      {UTILITY_SURFACES.map(surfaceItem)}
    </nav>
  );
}
