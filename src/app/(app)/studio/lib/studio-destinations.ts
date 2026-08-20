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

import type { StudioTool } from "../components/StudioSidebar";

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
 * LiTT Mode — what LiTT is about to create. This is the canonical
 * "mode" query parameter that travels alongside `tool=chat&agent=litt`.
 *
 * Instead of navigating to separate tool pages (Image, Music, Video),
 * the user stays in the LiTT chat conversation and switches mode.
 * The composer adapts its placeholder and quick-actions to the mode,
 * and the workspace panel shows the relevant artifact surface.
 *
 *   auto     — default, LiTT decides based on the prompt
 *   image    — image generation
 *   video    — video generation
 *   music    — music generation
 *   code     — code editing (opens code workspace)
 *   website  — website/builder mode
 */
export type LiTTMode = "auto" | "image" | "video" | "music" | "code" | "website";

/** All valid LiTTMode values for validation. */
export const LITT_MODES: LiTTMode[] = ["auto", "image", "video", "music", "code", "website"];

/**
 * Map a legacy `?tool=` value to a LiTT mode. Returns null if the tool
 * doesn't map to a LiTT mode (e.g. "agents", "assets", "plugins").
 *
 * This is used to normalize old URLs like `?tool=image` into the
 * canonical `?tool=chat&mode=image` form.
 */
export function legacyToolToLiTTMode(tool: string | null): LiTTMode | null {
  switch (tool) {
    case "image":
    case "color":
      return "image";
    case "video":
      return "video";
    case "music":
    case "audio":
      return "music";
    case "code":
      return "code";
    // build/canvas/design are workspace stages, not LiTT creation modes.
    // They fall through to the switch in mapLegacyToolToDestination which
    // sets the correct legacyTool and mode (files/design/work) with
    // littMode: "website" explicitly.
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
  /**
   * LiTT mode — what LiTT is about to create. When the canonical URL
   * is `?tool=chat&mode=image`, this is "image". Normalized from old
   * `?tool=image` URLs via legacyToolToLiTTMode.
   */
  littMode?: LiTTMode;
}

/**
 * Map a legacy `?tool=` query value (or any StudioTool) to a Command
 * Studio destination. ALL old tool URLs now canonicalize to the LiTT
 * chat surface with a mode parameter. The user never leaves the
 * conversation — image/music/video/code/website are LiTT modes, not
 * separate Studio experiences.
 *
 * Canonical route: ?tool=chat&mode=<mode>
 * Old routes like ?tool=image become ?tool=chat&mode=image
 */
export function mapLegacyToolToDestination(
  tool: StudioTool | string | null,
  command?: string,
): DestinationState {
  // ── LiTT mode normalization ──
  // ALL creative tools (image/video/music/code/website) normalize to
  // the canonical LiTT chat surface. The conversation is permanent and
  // primary; modes change the composer + workspace, not the destination.
  const littMode = legacyToolToLiTTMode(tool);
  if (littMode && littMode !== "auto") {
    // Code and Website modes open their respective workspace stages
    // but the conversation remains the primary surface.
    if (littMode === "code") {
      return { destination: "studio", legacyTool: "chat", mode: "code", littMode };
    }
    if (littMode === "website") {
      return { destination: "studio", legacyTool: "chat", mode: "work", littMode, command };
    }
    // Image/Video/Music → stay in chat, mode drives the composer + workspace
    return { destination: "studio", legacyTool: "chat", mode: "work", littMode };
  }

  switch (tool) {
    // Studio / Work surface — the conversation (canonical)
    case "home":
    case "chat":
      return { destination: "studio", legacyTool: "chat", mode: "work", littMode: "auto" };
    // Studio / Files — the Canvas surface
    case "canvas":
      return { destination: "studio", legacyTool: "canvas", mode: "files", littMode: "website" };
    // Studio / Design — freeform design canvas
    case "design":
      return { destination: "studio", legacyTool: "design", mode: "design", littMode: "website" };
    // Studio / Code — the code surface
    case "code":
      return { destination: "studio", legacyTool: "code", mode: "code", littMode: "code" };
    // Studio / Preview — the app preview surface
    case "preview":
      return { destination: "studio", legacyTool: "preview", mode: "preview", littMode: "auto" };
    // Studio / Work but rendering the Builder adapter (not ChatTool)
    case "build":
      return { destination: "studio", legacyTool: "build", mode: "work", littMode: "website", command };
    // Studio / Work with the bottom drawer open on Terminal
    case "terminal":
      return { destination: "studio", legacyTool: "terminal", mode: "work", littMode: "auto", command, openDrawer: "terminal" };

    // ── Old creative tool URLs — ALL canonicalize to LiTT chat + mode ──
    // These are caught by legacyToolToLiTTMode above, but we keep them
    // here as a safety net so they NEVER reach the old Create destination.
    case "image":
    case "color":
      return { destination: "studio", legacyTool: "chat", mode: "work", littMode: "image" };
    case "video":
      return { destination: "studio", legacyTool: "chat", mode: "work", littMode: "video" };
    case "audio":
    case "music":
      return { destination: "studio", legacyTool: "chat", mode: "work", littMode: "music" };
    case "game":
      return { destination: "studio", legacyTool: "chat", mode: "work", littMode: "auto" };

    // Assets
    case "assets":
      return { destination: "assets", legacyTool: "assets" };

    // Agents — configuration & capabilities (no chat)
    case "agents":
      return { destination: "agents", legacyTool: "agents" };

    // Camera → Studio + camera action (capture, not a destination)
    case "camera":
      return { destination: "studio", legacyTool: "camera", mode: "work", littMode: "auto" };
    // Screen → Studio + screen action (capture, not a destination)
    case "screen":
      return { destination: "studio", legacyTool: "screen", mode: "work", littMode: "auto" };
    // Space → LiTT chat with auto mode (skybox is a LiTT capability)
    case "space":
      return { destination: "studio", legacyTool: "chat", mode: "work", littMode: "auto" };
    // Mission Forge → Missions destination
    case "workflows":
    case "pipeline":
      return { destination: "missions", legacyTool: "workflows", mode: "forge" as MissionMode };
    // More — secondary tools only
    case "plugins":
    case "clibridge":
      return { destination: "more", legacyTool: tool as StudioTool, mode: tool as MoreMode };

    // Unknown / default → Studio (LiTT chat)
    default:
      return { destination: "studio", legacyTool: "chat", mode: "work", littMode: "auto" };
  }
}

/**
 * Reverse mapping: given a destination + mode, produce the canonical
 * `?tool=` value to write back to the URL. The canonical route is
 * always `tool=chat` — modes travel as `?mode=<mode>`.
 *
 * The only exceptions are workspace stages that have their own URL
 * (code, canvas, preview) for deep-linking — but even those preserve
 * the LiTT mode in the URL.
 */
export function destinationToLegacyTool(
  destination: StudioDestination,
  mode?: string,
): StudioTool {
  switch (destination) {
    case "studio":
      // Workspace stages that have their own URL for deep-linking
      if (mode === "code") return "code";
      if (mode === "files") return "canvas";
      if (mode === "design") return "design";
      if (mode === "preview") return "preview";
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
