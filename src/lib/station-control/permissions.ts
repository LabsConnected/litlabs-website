/**
 * Station Control Bridge — permissions (client-safe).
 *
 * Contract: docs/LITT-OS-IMPLEMENTATION-CONTRACT.md §§6.3, 7.
 */
import type { PermissionSet, StationAction, StationId } from "./types";

export const DEFAULT_PERMISSIONS: PermissionSet = {
  files: "allow",
  terminal: "allow",
  browser: "allow",
  git: "allow",
  create: "allow",
  preview: "allow",
  deploy: "ask",
  production: "ask",
  payments: "ask",
  externalPost: "ask",
  secrets: "deny",
};

/**
 * Map a station to the permission capability that gates its mutations.
 *
 * Stations with no cataloged actions (plan, memory, design, game,
 * environment, voice, camera) have no permission key — mapping one throws a
 * clear error instead of silently defaulting, so a caller cannot smuggle a
 * mutation through an unrelated permission.
 */
export function stationToPermissionKey(station: StationId): keyof PermissionSet {
  switch (station) {
    case "code":
    case "files":
    case "assets":
      return "files";
    case "canvas":
    case "image":
    case "video":
    case "music":
    case "audio":
      return "create";
    case "preview":
      return "preview";
    case "browser":
      return "browser";
    case "terminal":
    case "checks":
      return "terminal";
    case "git":
      return "git";
    case "deploy":
      return "deploy";
    case "plan":
    case "memory":
    case "design":
    case "game":
    case "environment":
    case "voice":
    case "camera":
    default:
      throw new Error(
        `stationToPermissionKey: station "${station}" has no permission key — it has no registered actions and cannot authorize mutations`,
      );
  }
}

/**
 * True when the action may execute without an explicit approval: read-only
 * actions always may; mutating actions require the governing permission to
 * be "allow" (not "ask" — ask must go through the approval flow first).
 */
export function canMutateAction(action: StationAction, permissions: PermissionSet): boolean {
  if (!action.mutating) return true;
  try {
    return permissions[stationToPermissionKey(action.station)] === "allow";
  } catch {
    // Station with no permission key (no actions) — nothing mutating is allowed.
    return false;
  }
}
