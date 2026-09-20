/**
 * Command Studio — destination routing adapter.
 *
 * Phase 1 collapses 17 legacy `?tool=` values into 5 navigation
 * destinations (Studio / Create / Assets / Agents / More). Old tool
 * components are preserved and routed through adapters during migration,
 * so legacy URLs keep working.
 *
 * This module is the single source of truth for the mapping. It is pure
 * (no React, no side effects) so it can be unit-tested in isolation.
 */


/** The six top-level navigation destinations. */
export type StudioDestination =
  | "studio"
  | "create"
  | "assets"
  | "agents"
  | "missions"
  | "more";

/**
 * Canonical Ultra Vision workspace stages — the permanent top-level
 * workspace modes presented in the product. These map onto the existing
 * legacy `StudioMode` internals without breaking persisted URLs or
 * localStorage keys.
 *
 *   plan    -> work   (LiTT conversation / planning surface)
 *   canvas  -> files  (visual canvas builder)
 *   code    -> code   (Monaco code editor)
 *   preview -> preview (app preview iframe)
 *   media   -> media   (generated images, video, music, audio)
 */
export type WorkspaceStage = "plan" | "canvas" | "code" | "preview" | "media";

/**
 * Canonical Ultra Vision creator taxonomy — the seven creator surfaces.
 * These map onto the existing legacy destination/mode system.
 *
 * "environment" is the internal identifier; the UI label is "360°".
 * "design" currently routes through the Studio destination but is
 * canonically a creator kind. "game" has routing capability but no
 * visible tab until GameCreatorTool is functional.
 */
export type CreatorKind =
  | "image"
  | "video"
  | "music"
  | "audio"
  | "design"
  | "game"
  | "environment";

/** Map a canonical WorkspaceStage to the legacy StudioMode internal. */
export function workspaceStageToMode(stage: WorkspaceStage): StudioMode {
  switch (stage) {
    case "plan":
      return "work";
    case "canvas":
      return "files";
    case "code":
      return "code";
    case "preview":
      return "preview";
    case "media":
      return "media" as StudioMode;
  }
}

/** Reverse: map a legacy StudioMode back to a canonical WorkspaceStage. */
export function modeToWorkspaceStage(mode: StudioMode): WorkspaceStage | null {
  switch (mode) {
    case "work":
      return "plan";
    case "files":
      return "canvas";
    case "code":
      return "code";
    case "preview":
      return "preview";
    case "media":
      return "media";
    // "design" has no WorkspaceStage mapping — it's a creator, not a stage.
    default:
      return null;
  }
}

/** UI labels for canonical creator kinds. */
export const CREATOR_KIND_LABELS: Record<CreatorKind, string> = {
  image: "Image",
  video: "Video",
  music: "Music",
  audio: "Audio",
  design: "Design",
  game: "Game",
  environment: "360°",
};

/** Internal workspace modes inside the Studio destination. */
export type StudioMode = "work" | "preview" | "code" | "files" | "design" | "media";

/** Internal tabs inside the Create destination. */
export type CreateMode = "image" | "video" | "audio" | "music" | "environment" | "game";

/** Internal tabs inside the More destination. */
export type MoreMode =
  | "plugins"
  | "clibridge";

/** Internal modes inside the Missions destination. */
export type MissionMode =
  | "overview"
  | "forge"
  | "runs"
  | "schedules"
  | "templates";

/** Internal tabs inside the right inspector. */
export type InspectorTab = "plan" | "changes" | "files" | "preview" | "checks" | "approvals" | "browser";

/** Internal tabs inside the bottom drawer. */
export type DrawerTab = "activity" | "terminal" | "media";

/**
 * Creative-tool surface mapping (private).
 *
 * Legacy creative `?tool=` values (image, video, music, code) normalize to
 * the canonical LiTT chat surface. There is no user-facing mode choice —
 * the router always behaves as auto — so this mapping only selects the
 * workspace surface, never a mode.
 *
 * Returns the StudioMode surface to open, or null when the tool has its
 * own dedicated mapping in mapLegacyToolToDestination below.
 */
function creativeToolWorkspaceSurface(
  tool: string | null,
): "code" | "work" | null {
  switch (tool) {
    case "image":
    case "color":
    case "video":
    case "music":
    case "audio":
      return "work";
    case "code":
      return "code";
    default:
      return null;
  }
}

export interface DestinationState {
  destination: StudioDestination;
  /** Legacy tool id that maps into this destination, if any. */
  legacyTool?: StudioTool;
  /** Internal mode for the active destination. */
  mode?: StudioMode | CreateMode | MoreMode | MissionMode;
  /** Optional command carried over from a legacy route (e.g. `/build ...`). */
  command?: string;
  /** Open the bottom drawer on this tab (e.g. terminal legacy URL). */
  openDrawer?: DrawerTab;
  /** Open the right inspector on this tab (e.g. workflows legacy URL). */
  openInspector?: InspectorTab;
}

/** Route an explicit media-generation request into its real creator surface. */
export function mapMediaIntentToDestination(
  tool: Extract<StudioTool, "image" | "video" | "audio" | "music">,
): DestinationState {
  return { destination: "create", legacyTool: tool, mode: tool };
}

/**
 * Resolve an explicit `?creator=` deep-link (e.g. /studio?creator=image
 * from the Create hub) to the Create destination. This is the ONLY URL
 * route into the creator surfaces: legacy `?tool=image`-style URLs
 * deliberately normalize to the chat surface and must keep doing so.
 *
 * Returns null for missing/invalid values so callers fall through to
 * the normal ?tool= handling. Pure — unit-tested in isolation.
 */
const CREATE_MODES = ["image", "video", "audio", "music", "environment", "game"] as const;

export function resolveCreatorDestination(creator: string | null): DestinationState | null {
  if (creator && (CREATE_MODES as readonly string[]).includes(creator)) {
    return { destination: "create", mode: creator as CreateMode };
  }
  return null;
}

/**
 * Map a legacy `?tool=` query value (or any StudioTool) to a Command
 * Studio destination. ALL old tool URLs now canonicalize to the LiTT
 * chat surface. The user never leaves the conversation.
 *
 * Canonical route: ?tool=chat (auto — LiTT routes the work itself)
 * Old creative routes like ?tool=image become ?tool=chat (work surface)
 */
export function mapLegacyToolToDestination(
  tool: StudioTool | string | null,
  command?: string,
): DestinationState {
  // ── Creative-tool normalization ──
  // ALL creative tools (image/video/music/code) normalize to
  // the canonical LiTT chat surface. The conversation is permanent and
  // primary; the mapping only selects the workspace surface — there is
  // no mode choice, the router always behaves as auto.
  const creativeSurface = creativeToolWorkspaceSurface(tool);
  if (creativeSurface) {
    return { destination: "studio", legacyTool: "chat", mode: creativeSurface };
  }

  switch (tool) {
    // Studio / Work surface — the conversation (canonical).
    // Preview is the default workspace surface; chat lives in the LiTT panel.
    case "home":
    case "chat":
      return { destination: "studio", legacyTool: "chat", mode: "preview" };
    // Studio / Files — the Canvas surface
    case "canvas":
      return { destination: "studio", legacyTool: "canvas", mode: "files" };
    // Studio / Design — freeform design canvas
    case "design":
      return { destination: "studio", legacyTool: "design", mode: "design" };
    // Studio / Preview — the app preview surface
    case "preview":
      return { destination: "studio", legacyTool: "preview", mode: "preview" };
    // Studio / Work but rendering the Builder adapter (not ChatTool).
    // Builder is a workspace surface, not a creation mode.
    case "build":
      return { destination: "studio", legacyTool: "build", mode: "work", command };
    // Studio / Work with the bottom drawer open on Terminal
    case "terminal":
      return { destination: "studio", legacyTool: "terminal", mode: "work", command, openDrawer: "terminal" };

    // ── Old creative tool URLs — handled by the normalization block ──
    // above (they NEVER reach the old Create destination). "game" is
    // not a creative tool; it canonicalizes to the chat surface here.
    case "game":
      return { destination: "studio", legacyTool: "chat", mode: "work" };

    // Assets
    case "assets":
      return { destination: "assets", legacyTool: "assets" };

    // Agents — configuration & capabilities (no chat)
    case "agents":
      return { destination: "agents", legacyTool: "agents" };

    // Camera → Studio + camera action (capture, not a destination)
    case "camera":
      return { destination: "studio", legacyTool: "camera", mode: "work" };
    // Screen → Studio + screen action (capture, not a destination)
    case "screen":
      return { destination: "studio", legacyTool: "screen", mode: "work" };
    // Space → LiTT chat with auto mode (skybox is a LiTT capability)
    case "space":
      return { destination: "studio", legacyTool: "chat", mode: "work" };
    // Mission Forge → Missions destination
    case "workflows":
    case "pipeline":
      return { destination: "missions", legacyTool: "workflows", mode: "forge" as MissionMode };
    // More — secondary tools only
    case "plugins":
    case "clibridge":
      return { destination: "more", legacyTool: tool as StudioTool, mode: tool as MoreMode };

    // Unknown / default → Studio with Preview as the primary surface.
    // Chat lives in the LiTT panel (left); Preview gets the main workspace.
    default:
      return { destination: "studio", legacyTool: "chat", mode: "preview" };
  }
}

/**
 * Which surface renders inside Studio/Work — the LiTT conversation, or
 * the Builder adapter. Part of Builder's canonical routing identity:
 * (studio, work, builder) ⟷ ?tool=build.
 */
export type WorkSurface = "conversation" | "builder";

/**
 * Reverse mapping: given a destination + mode (+ work surface), produce
 * the canonical `?tool=` value to write back to the URL. The canonical
 * route is always `tool=chat` — LiTT routes the work itself (auto).
 *
 * The only exceptions are workspace stages that have their own URL
 * (code, canvas, preview, build) for deep-linking.
 */
export function destinationToLegacyTool(
  destination: StudioDestination,
  mode?: string,
  workSurface?: WorkSurface,
): StudioTool {
  switch (destination) {
    case "studio":
      // Workspace stages that have their own URL for deep-linking
      if (mode === "code") return "code";
      if (mode === "files") return "canvas";
      if (mode === "design") return "design";
      if (mode === "preview") return "preview";
      // Builder is a canonical Studio destination — ?tool=build, not
      // the generic chat URL (which remaps to Preview on load).
      if (mode === "work" && workSurface === "builder") return "build";
      // Everything else is the canonical LiTT chat surface
      return "chat";
    case "create":
      // Create destination is legacy — but if we ever land here,
      // write the old tool name so the URL normalizes on next load.
      if (mode === "video") return "video";
      if (mode === "audio") return "audio";
      if (mode === "music") return "music";
      if (mode === "environment") return "space";
      if (mode === "game") return "game";
      return "image";
    case "assets":
      return "assets";
    case "agents":
      return "agents";
    case "missions":
      return "workflows";
    case "more":
      if (mode === "clibridge") return "clibridge";
      return "plugins";
  }
}

export const DESTINATION_LABELS: Record<StudioDestination, string> = {
  studio: "Studio",
  create: "Create",
  assets: "Assets",
  agents: "Agents",
  missions: "Missions",
  more: "More",
};

/**
 * StudioTool — legacy tool identifiers (moved from StudioSidebar.tsx,
 * deleted in the P3 dock consolidation). Still referenced by inspector,
 * transcript, destinations, and intent mapping.
 */
export type StudioTool =
  | "home"
  | "chat"
  | "canvas"
  | "design"
  | "image"
  | "video"
  | "audio"
  | "music"
  | "build"
  | "code"
  | "agents"
  | "assets"
  | "plugins"
  | "camera"
  | "screen"
  | "terminal"
  | "workflows"
  | "space"
  | "clibridge"
  | "loops"
  | "preview"
  | "game";
