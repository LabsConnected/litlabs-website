/**
 * StudioContext — creator derivation helpers.
 *
 * Bridges the legacy CreateMode / StudioMode routing state into the
 * canonical CreatorKind taxonomy. This keeps the derivation logic in
 * one place so CommandStudio doesn't scatter conditionals.
 */

import type {
  CreateMode,
  CreatorKind,
  StudioMode,
  WorkspaceStage,
} from "@/app/(app)/studio/lib/studio-destinations";
import { modeToWorkspaceStage } from "@/app/(app)/studio/lib/studio-destinations";

/**
 * Derive the canonical CreatorKind from the current destination + mode.
 *
 * - When destination is "create", the CreateMode maps directly to a
 *   CreatorKind (except "design" which is not in CreateMode — it
 *   routes through Studio/design mode).
 * - When destination is "studio" and mode is "design", the creator is
 *   "design".
 * - Otherwise, no creator is active (we're in Plan/Canvas/Code/Preview).
 */
export function deriveCreator(
  destination: "studio" | "create" | "assets" | "agents" | "missions" | "more",
  studioMode: StudioMode | null,
  createMode: CreateMode | null,
): CreatorKind | null {
  if (destination === "create" && createMode) {
    // CreateMode has: image, video, audio, music, environment, game
    // All of these are valid CreatorKind values.
    return createMode as CreatorKind;
  }

  if (destination === "studio" && studioMode === "design") {
    return "design";
  }

  return null;
}

/**
 * Derive the canonical WorkspaceStage from the current destination +
 * studio mode.
 *
 * Returns null when the destination is not "studio" (e.g. we're in
 * Create/Assets/Agents/Missions/More — there's no workspace stage).
 */
export function deriveWorkspaceStage(
  destination: "studio" | "create" | "assets" | "agents" | "missions" | "more",
  studioMode: StudioMode | null,
): WorkspaceStage | null {
  if (destination !== "studio" || !studioMode) return null;
  return modeToWorkspaceStage(studioMode);
}
