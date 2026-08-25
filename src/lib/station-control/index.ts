/**
 * Station Control — Public API (Client-compatible)
 *
 * The Station Control API makes "LiTT can control everything" real.
 * This module exports types and registries for client-side inspection.
 */

export type {
  StationId,
  StationAction,
  PermissionSet,
  PermissionLevel,
  MissionMode,
  FollowMode,
  ExecutionPhase,
  ExecutionEvent,
  StationExecutionContext,
  LiveStateSnapshot,
  PendingApproval,
} from "./types";

export type { ProjectSession, ProjectSessionStore } from "./project-session";

export { DEFAULT_PERMISSIONS, stationToPermissionKey, canMutate, requiresApproval } from "./permissions";

// Note: Actions are registered server-side via litt-runtime.
// The registry is populated when the server module is imported.
