/**
 * Station Control — Server Entry Point
 *
 * Server-side module that registers station actions and provides execution.
 * Import this in litt-runtime or API routes to enable station control.
 */

import "./actions/code";
import "./actions/browser";
import "./actions/git";
import "./actions/checks";

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
} from "./types";

export type { ProjectSession, ProjectSessionStore, PendingApproval } from "./project-session";

export { DEFAULT_PERMISSIONS, stationToPermissionKey, canMutate, requiresApproval } from "./permissions";

export {
  getStationAction,
  registerStationAction,
  getActionsForStation,
  STATION_ACTIONS,
} from "./registry";

export { executeStationAction, checkPermission, checkMode, getAllActions } from "./executor";