/**
 * ActionPanel registry — "What LiTT can do".
 *
 * Maps the actions a user can trigger from the Studio canvas to the
 * ArtifactAction payloads the client executes. The entries surface
 * capabilities that already exist (inspector, terminal drawer, deploy,
 * file tree); later entries will add new block-backed actions.
 *
 * Availability is resolved when the panel opens: an action can be shown
 * disabled with a reason (e.g. "Publish site" when the publish-readiness
 * check reports blockers) — never a silent dead end.
 */
import type { LucideIcon } from "lucide-react";
import { FolderOpen, MousePointerClick, TerminalSquare, Rocket } from "lucide-react";
import type { ArtifactAction } from "./types";

/* ── DOM events ─────────────────────────────────────────────── */
/* The studio.* actions are executed client-side. executeAction dispatches
   these events; the owning components listen for them. This keeps the
   canvas store decoupled from the preview panel / dock / chat. */

export const STUDIO_EVENT_ACTIVATE_INSPECTOR = "studio:activate-inspector";
export const STUDIO_EVENT_OPEN_DOCK = "studio:open-dock";
export const STUDIO_EVENT_REQUEST_DEPLOY = "studio:request-deploy";
/** Fired when a studio.open_file action executes; the files surface selects the file. */
export const STUDIO_EVENT_OPEN_FILE = "studio:open-file";

/* ── Types ──────────────────────────────────────────────────── */

export type PanelActionCategory = "build" | "files" | "inspect" | "deploy" | "media" | "data";

export const PANEL_ACTION_CATEGORIES: { id: PanelActionCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "build", label: "Build" },
  { id: "files", label: "Files" },
  { id: "inspect", label: "Inspect" },
  { id: "deploy", label: "Deploy" },
  { id: "media", label: "Media" },
  { id: "data", label: "Data" },
];

export interface PanelActionContext {
  /** The active canvas's project, if the canvas is attached to one. */
  projectId: string | null;
}

export interface PanelActionAvailability {
  available: boolean;
  /** Shown on the card when unavailable — never a silent dead end. */
  reason?: string;
}

export interface PanelActionDefinition {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  category: PanelActionCategory;
  /** Label rendered on the chat chip (StudioTranscript → ActionChips). */
  chipLabel: string;
  buildAction: (ctx: PanelActionContext) => ArtifactAction;
  isAvailable: (
    ctx: PanelActionContext,
  ) => boolean | Promise<boolean> | PanelActionAvailability | Promise<PanelActionAvailability>;
}

/* ── Availability helpers ───────────────────────────────────── */

interface ReadinessResponse {
  checkable: boolean;
  warnings?: { code: string; message: string }[];
  reason?: string;
}

async function checkDeployAvailability(projectId: string | null): Promise<PanelActionAvailability> {
  if (!projectId) {
    return { available: false, reason: "Attach this canvas to a project first" };
  }
  try {
    const res = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/publish-readiness`);
    if (!res.ok) {
      return { available: false, reason: "Couldn't check publish readiness" };
    }
    const data = (await res.json()) as ReadinessResponse;
    if (!data.checkable) {
      return { available: false, reason: data.reason ?? "Workspace isn't ready to publish" };
    }
    const warnings = data.warnings ?? [];
    if (warnings.length > 0) {
      const first = warnings[0].message;
      const extra = warnings.length > 1 ? ` (+${warnings.length - 1} more)` : "";
      return { available: false, reason: `Not ready: ${first}${extra}` };
    }
    return { available: true };
  } catch {
    return { available: false, reason: "Couldn't check publish readiness" };
  }
}

function normalizeAvailability(
  value: boolean | PanelActionAvailability,
): PanelActionAvailability {
  return typeof value === "boolean" ? { available: value } : value;
}

/** Resolve every definition's availability for the current context. */
export async function resolvePanelActionAvailability(
  ctx: PanelActionContext,
): Promise<{ def: PanelActionDefinition; availability: PanelActionAvailability }[]> {
  const defs = getPanelActionDefinitions();
  return Promise.all(
    defs.map(async (def) => ({
      def,
      availability: normalizeAvailability(await def.isAvailable(ctx)),
    })),
  );
}

/* ── Registry ───────────────────────────────────────────────── */

export function getPanelActionDefinitions(): PanelActionDefinition[] {
  return [
    {
      id: "inspect_element",
      label: "Inspect element",
      description: "Click any element in the preview to inspect it",
      icon: MousePointerClick,
      category: "inspect",
      chipLabel: "Inspect element",
      buildAction: () => ({ type: "studio.inspect_element" }),
      isAvailable: () => ({ available: true }),
    },
    {
      id: "open_terminal",
      label: "Open terminal",
      description: "Run commands in the project's terminal",
      icon: TerminalSquare,
      category: "build",
      chipLabel: "Open terminal",
      buildAction: () => ({ type: "studio.open_terminal" }),
      isAvailable: (ctx) =>
        ctx.projectId
          ? { available: true }
          : { available: false, reason: "Attach this canvas to a project first" },
    },
    {
      id: "browse_files",
      label: "Browse files",
      description: "Browse the project file tree and open a file",
      icon: FolderOpen,
      category: "files",
      chipLabel: "Browse files",
      buildAction: (ctx) => {
        if (!ctx.projectId) throw new Error("browse_files needs a projectId");
        return { type: "studio.browse_files", projectId: ctx.projectId };
      },
      isAvailable: (ctx) =>
        ctx.projectId
          ? { available: true }
          : { available: false, reason: "Attach this canvas to a project first" },
    },
    {
      id: "deploy_site",
      label: "Publish site",
      description: "Deploy this project to its live URL",
      icon: Rocket,
      category: "deploy",
      chipLabel: "Publish site",
      buildAction: (ctx) => {
        if (!ctx.projectId) throw new Error("deploy_site needs a projectId");
        return { type: "studio.deploy_site", projectId: ctx.projectId };
      },
      isAvailable: (ctx) => checkDeployAvailability(ctx.projectId),
    },
  ];
}
