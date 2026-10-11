/**
 * Station ⟷ URL — one canonical mapping for the Studio shell.
 *
 * Acceptance run 2026-09-28: the URL said `tool=preview` while the center
 * rendered the Mission/Checkpoints dashboard. Two sources of truth were
 * disagreeing: the URL was written from `studioMode`, while the center
 * rendered `stageSurface` (restored from the task's lastOpenedSurface,
 * which was "plan"). In the shell the URL `tool` param is now written
 * FROM the stage surface and read back INTO it, so the URL, the state and
 * the visible station can never disagree.
 *
 * "plan" is no longer a center station: Mission / Checkpoints / Next
 * actions live in the inspector's Plan tab. Any stored or linked "plan"
 * resolves to the Preview station.
 */
import type { StudioStageSurface } from "./stage-surfaces";

/** Stations the center may render (plan intentionally excluded). */
export const CENTER_STATIONS: readonly StudioStageSurface[] = [
  "design",
  "preview",
  "browser",
  "code",
  "files",
  "images",
  "assets",
  "deploy",
  "activity",
  "terminal",
];

/**
 * `?tool=` values that collide with a NON-studio destination in the
 * legacy router (e.g. tool=assets opens the Assets page) get a
 * studio-scoped spelling so a round-trip never leaves the Studio.
 */
const STATION_TO_TOOL: Partial<Record<StudioStageSurface, string>> = {
  assets: "project-assets",
  images: "images",
};

const TOOL_TO_STATION: Record<string, StudioStageSurface> = {
  // Canonical station ids
  design: "design",
  preview: "preview",
  browser: "browser",
  code: "code",
  files: "files",
  images: "images",
  "project-assets": "assets",
  deploy: "deploy",
  activity: "activity",
  terminal: "terminal",
  // Legacy spellings
  canvas: "design",
  chat: "preview",
  home: "preview",
  plan: "preview",
  work: "preview",
  build: "design",
};

export function stationToToolParam(station: StudioStageSurface): string {
  if (station === "plan") return "preview";
  return STATION_TO_TOOL[station] ?? station;
}

/** null = the param makes no station claim (absent/unknown). */
export function toolParamToStation(tool: string | null | undefined): StudioStageSurface | null {
  if (!tool) return null;
  return TOOL_TO_STATION[tool] ?? null;
}

/**
 * The station the center renders. Never "plan": a stale persisted or
 * linked plan surface resolves to Preview.
 */
export function centerStation(surface: StudioStageSurface): StudioStageSurface {
  return surface === "plan" ? "preview" : surface;
}

/**
 * Initial-load precedence: an explicit, valid `?tool=` deep link wins over
 * the task's remembered surface; otherwise the remembered surface; else
 * Preview.
 */
export function resolveInitialStation(
  urlTool: string | null | undefined,
  remembered: StudioStageSurface | null | undefined,
): StudioStageSurface {
  const fromUrl = toolParamToStation(urlTool);
  if (fromUrl) return fromUrl;
  if (remembered) return centerStation(remembered);
  return "preview";
}
