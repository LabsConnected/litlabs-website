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

/** Internal workspace modes inside the Studio destination. */
export type StudioMode = "work" | "preview" | "code" | "files" | "design";

/** Internal tabs inside the Create destination. */
export type CreateMode = "image" | "video" | "audio" | "music" | "environment";

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
export type InspectorTab = "plan" | "changes" | "files" | "preview" | "checks" | "approvals";

/** Internal tabs inside the bottom drawer. */
export type DrawerTab = "activity" | "terminal" | "media";

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

/**
 * Map a legacy `?tool=` query value (or any StudioTool) to a Command
 * Studio destination. Legacy URLs are preserved through this mapping —
 * we never 404 an old tool link during the migration.
 */
export function mapLegacyToolToDestination(
  tool: StudioTool | string | null,
  command?: string,
): DestinationState {
  switch (tool) {
    // Studio / Work surface — the conversation
    case "home":
    case "chat":
      return { destination: "studio", legacyTool: "chat", mode: "work" };
    // Studio / Files — the Canvas surface
    case "canvas":
      return { destination: "studio", legacyTool: "canvas", mode: "files" };
    // Studio / Design — freeform design canvas
    case "design":
      return { destination: "studio", legacyTool: "design", mode: "design" };
    // Studio / Code — the code surface
    case "code":
      return { destination: "studio", legacyTool: "code", mode: "code" };
    // Studio / Preview — the app preview surface
    case "preview":
      return { destination: "studio", legacyTool: "preview", mode: "preview" };
    // Studio / Work but rendering the Builder adapter (not ChatTool)
    case "build":
      return { destination: "studio", legacyTool: "build", mode: "work", command };
    // Studio / Work with the bottom drawer open on Terminal
    case "terminal":
      return { destination: "studio", legacyTool: "terminal", mode: "work", command, openDrawer: "terminal" };

    // Create — media workspace
    case "image":
      return { destination: "create", legacyTool: "image", mode: "image" };
    case "video":
      return { destination: "create", legacyTool: "video", mode: "video" };
    case "audio":
      return { destination: "create", legacyTool: "audio", mode: "audio" };
    case "music":
      return { destination: "create", legacyTool: "music", mode: "music" };
    // Legacy "color" tool (Color by Number) has been removed —
    // redirect to Create / Image so old bookmarks don't 404.
    case "color":
      return { destination: "create", legacyTool: "image", mode: "image" };

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
    // Space → Create / Environment (skybox generator)
    case "space":
      return { destination: "create", legacyTool: "space", mode: "environment" as CreateMode };
    // Mission Forge → Missions destination
    case "workflows":
    case "pipeline":
      return { destination: "missions", legacyTool: "workflows", mode: "forge" as MissionMode };
    // More — secondary tools only
    case "plugins":
    case "clibridge":
      return { destination: "more", legacyTool: tool as StudioTool, mode: tool as MoreMode };

    // Unknown / default → Studio
    default:
      return { destination: "studio", legacyTool: "chat", mode: "work" };
  }
}

/**
 * Reverse mapping: given a destination + mode, produce the legacy
 * `?tool=` value to write back to the URL so bookmarks and reloads
 * land in the right place.
 */
export function destinationToLegacyTool(
  destination: StudioDestination,
  mode?: string,
): StudioTool {
  switch (destination) {
    case "studio":
      if (mode === "code") return "code";
      if (mode === "files") return "canvas";
      if (mode === "design") return "design";
      if (mode === "preview") return "preview";
      return "chat";
    case "create":
      if (mode === "video") return "video";
      if (mode === "audio") return "audio";
      if (mode === "music") return "music";
      if (mode === "environment") return "space";
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
