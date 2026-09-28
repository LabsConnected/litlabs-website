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
  PanelsTopLeft,
  PenTool,
  Rocket,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";

export type StudioStageSurface =
  | "workspace"
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
  workspace:{ label: "Workspace", icon: PanelsTopLeft, hint: "Chats, tasks, and notes on one canvas" },
  plan:     { label: "Plan",     icon: ClipboardList,  hint: "Mission plan & overview" },
  design:   { label: "Design",   icon: PenTool,        hint: "Structured page canvas" },
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
export const PRIMARY_SURFACES: StudioStageSurface[] = [
  "workspace",
  "plan",
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
    shell. Unknown → workspace (the default stage). */
const PERSISTED_SURFACE_MAP: Record<string, StudioStageSurface> = {
  design: "design",
  preview: "preview",
  code: "code",
  files: "files",
  media: "images",
  work: "plan",
  canvas: "design",
  plan: "plan",
  browser: "browser",
  images: "images",
  assets: "assets",
  deploy: "deploy",
  activity: "activity",
  terminal: "terminal",
  studio: "workspace",
  chat: "workspace",
  workspace: "workspace",
};

export function resolveStageSurface(stored: string | null | undefined): StudioStageSurface {
  if (!stored) return "workspace";
  return PERSISTED_SURFACE_MAP[stored] ?? "workspace";
}

/** Legacy studioMode → rail surface. NOTE: mode "files" is the visual
    builder canvas (design), not the file tree. */
export function modeToStageSurface(mode: string | null | undefined): StudioStageSurface | null {
  switch (mode) {
    case "work": return "plan";
    case "files": return "design";
    case "code": return "code";
    case "workspace": return "workspace";
    case "preview": return "preview";
    case "media": return "images";
    case "design": return "design";
    default: return null;
  }
}

/** Opening Studio, or the canonical chat URL, lands on the workspace.
    An explicit tool such as preview, design, or code still selects that surface. */
export function shellStageForTool(tool: string | null, mode: string | null | undefined): StudioStageSurface | null {
  if (tool === null || tool === "chat" || tool === "home" || tool === "workspace") return "workspace";
  return modeToStageSurface(mode);
}

const EXPLICIT_TOOL_STAGE: Record<string, StudioStageSurface> = {
  preview: "preview",
  design: "design",
  canvas: "design",
  code: "code",
  build: "plan",
  terminal: "terminal",
  files: "files",
};

/** Stage to show before the URL→state effect runs. Bare /studio, chat, and home
    are the workspace. Explicit preview and design stay on those surfaces. */
export function initialStageFromTool(tool: string | null): StudioStageSurface {
  if (tool === null || tool === "chat" || tool === "home" || tool === "workspace") return "workspace";
  return EXPLICIT_TOOL_STAGE[tool] ?? "workspace";
}

/** Tool param the operating shell should write. The legacy studio mode for
    chat/home is "preview", and publishing that as ?tool=preview makes the
    next URL read treat Preview as an explicit deep link. Workspace stays on
    chat/home. An explicit tool that already names the active stage is kept. */
export function canonicalShellTool(legacyTool: string, stage: StudioStageSurface, currentTool: string | null): string {
  if (stage === "workspace") {
    if (currentTool === "home" || currentTool === "chat" || currentTool === "workspace") return currentTool;
    return "chat";
  }
  if (currentTool && initialStageFromTool(currentTool) === stage) return currentTool;
  if (stage === "preview") return "preview";
  if (stage === "design") return "design";
  if (stage === "code") return "code";
  if (legacyTool === "preview") return "chat";
  return legacyTool;
}
