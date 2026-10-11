/**
 * StudioShell — stage surface registry.
 *
 * The central Stage owns exactly one active workspace surface at a time.
 * Surfaces are real, existing tool surfaces (preview, code workspace,
 * visual builder, …) mounted stay-alive per task so switching preserves
 * scroll, open files, iframes, and terminal state.
 *
 * LiTT is NOT a surface — it is the shell's bottom command layer and is
 * aware of whichever surface/selection is active.
 */
import {
  Activity,
  ClipboardList,
  Code2,
  Eye,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Package,
  PenTool,
  Rocket,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";

export type StudioStageSurface =
  | "plan"
  | "design"
  | "preview"
  | "browser"
  | "code"
  | "files"
  | "images"
  | "assets"
  | "deploy"
  | "activity"
  | "terminal";

export const STAGE_SURFACE_META: Record<
  StudioStageSurface,
  { label: string; icon: LucideIcon; hint: string }
> = {
  plan:     { label: "Plan",     icon: ClipboardList,  hint: "Mission plan & overview" },
  design:   { label: "Design",   icon: PenTool,        hint: "Editable structured canvas" },
  preview:  { label: "Preview",  icon: Eye,            hint: "Live dev-server preview" },
  browser:  { label: "Browser",  icon: Globe,          hint: "Remote browser session" },
  code:     { label: "Code",     icon: Code2,          hint: "Code workspace" },
  files:    { label: "Files",    icon: FolderOpen,     hint: "Project file tree" },
  images:   { label: "Images",   icon: ImageIcon,      hint: "Image workspace" },
  assets:   { label: "Assets",   icon: Package,        hint: "Project assets" },
  deploy:   { label: "Deploy",   icon: Rocket,         hint: "Deployments & hosting" },
  activity: { label: "Activity", icon: Activity,       hint: "Runs, checks & telemetry" },
  terminal: { label: "Terminal", icon: SquareTerminal, hint: "Workspace PTY" },
};

/** Primary workspace rail order (top → bottom). */
// "plan" is not a center station: Mission / Checkpoints / Next actions live
// in the inspector's Plan tab (see station-url.ts).
export const PRIMARY_SURFACES: StudioStageSurface[] = [
  "design",
  "preview",
  "browser",
  "code",
  "files",
  "images",
  "assets",
  "deploy",
  "activity",
];

/** Utility rail items pinned to the bottom of the rail. */
export const UTILITY_SURFACES: StudioStageSurface[] = ["terminal"];

/** Persisted `lastOpenedSurface` may hold a legacy studio value
    ("studio"/"chat"/"work"/"canvas"/"media") or a rail id written by the
    shell. Unknown → preview (the default stage). */
const PERSISTED_SURFACE_MAP: Record<string, StudioStageSurface> = {
  design: "design",
  preview: "preview",
  code: "code",
  files: "files",
  media: "images",
  work: "preview",
  canvas: "design",
  plan: "preview",
  browser: "browser",
  images: "images",
  assets: "assets",
  deploy: "deploy",
  activity: "activity",
  terminal: "terminal",
  studio: "preview",
  chat: "preview",
};

export function resolveStageSurface(stored: string | null | undefined): StudioStageSurface {
  if (!stored) return "preview";
  return PERSISTED_SURFACE_MAP[stored] ?? "preview";
}

/**
 * Phase 3 — single-writer surface persistence decision.
 *
 * `lastOpenedSurface` has exactly one authoritative write path
 * (`useStudioTasks.persistSurface`). This pure helper decides WHAT that
 * path should write, or returns null when the stored value is already in
 * sync (no PATCH). Centralizing the guard here — instead of spreading
 * competing guards across UI effects — is what makes PATCH oscillation
 * impossible by construction.
 *
 * Canonical value: the shell's center stage surface when the shell owns
 * the workspace; the encoded workspace surface (`destination/mode`) in
 * legacy (non-shell) mode.
 */
export function canonicalSurfaceToPersist(args: {
  shellActive: boolean;
  stageSurface: StudioStageSurface;
  currentSurface: string;
  storedSurface: string | null | undefined;
}): string | null {
  const canonical = args.shellActive ? args.stageSurface : args.currentSurface;
  if (args.storedSurface === canonical) return null;
  // Shell mode: a stored legacy/encoded value that already resolves to the
  // visible stage is in sync — rewriting it would only churn the server.
  if (args.shellActive && resolveStageSurface(args.storedSurface) === args.stageSurface) return null;
  return canonical;
}

/** Legacy studioMode → rail surface. NOTE: mode "files" is the visual
    builder canvas (design), not the file tree. */
export function modeToStageSurface(mode: string | null | undefined): StudioStageSurface | null {
  switch (mode) {
    case "work": return "preview";
    case "files": return "design";
    case "code": return "code";
    case "preview": return "preview";
    case "media": return "images";
    case "design": return "design";
    default: return null;
  }
}
