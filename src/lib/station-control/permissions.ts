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

export type MutationAuthorization =
  | { allowed: true }
  | { allowed: false; reason: "denied" | "approval_required" };

/**
 * Full authorization decision for a mutating action (Repair R5-A).
 *
 * The three permission levels are distinct decisions, and the executor
 * used to collapse two of them: `canMutateAction` answers "may this run
 * WITHOUT an approval" — false for both "ask" and "deny" — and the
 * executor treated every false as a hard permission denial, checked
 * BEFORE the approval gate. For the deploy station (default "ask") that
 * made an explicitly approved publish impossible: the user's granted
 * decision was never even consulted, and the run died with
 * "permission is not allow" (live staging failure, 2026-10-20).
 *
 * The levels mean:
 *   "allow" — may execute; the approval gate still applies on its own
 *             terms for gated actions.
 *   "ask"   — may execute ONLY behind a genuine granted approval. With
 *             one, the permission is satisfied; without one, the caller
 *             must go through the approval flow (approval_required) —
 *             "ask" is a deferral to that flow, never a denial and never
 *             a waiver.
 *   "deny"  — may NOT execute. A granted approval does NOT override a
 *             deny: approval answers "may I do this now", permission
 *             answers "may this be done at all".
 *
 * A station with no permission key can authorize nothing (fail closed).
 */
export function evaluateMutationAuthorization(
  action: StationAction,
  permissions: PermissionSet,
  hasApproval: boolean,
): MutationAuthorization {
  if (!action.mutating) return { allowed: true };
  let level: string;
  try {
    level = permissions[stationToPermissionKey(action.station)];
  } catch {
    return { allowed: false, reason: "denied" };
  }
  if (level === "allow") return { allowed: true };
  if (level === "ask") {
    return hasApproval
      ? { allowed: true }
      : { allowed: false, reason: "approval_required" };
  }
  // "deny" — and any unrecognized level — fails closed.
  return { allowed: false, reason: "denied" };
}
