/**
 * Station Control — Core Types
 *
 * The Station Control API makes "LiTT can control everything" real.
 * Every station exposes a typed action interface. Both the UI and LiTT
 * call the same actions.
 */

import * as z from "zod";

export type StationId =
  | "plan"
  | "canvas"
  | "code"
  | "files"
  | "preview"
  | "browser"
  | "terminal"
  | "image"
  | "video"
  | "music"
  | "audio"
  | "design"
  | "game"
  | "environment"
  | "git"
  | "deploy"
  | "checks"
  | "assets"
  | "memory"
  | "voice"
  | "camera";

export interface StationAction<Args extends z.ZodType, Result> {
  /** Unique action id, e.g. "image.setPrompt" */
  id: string;
  /** Which station this belongs to */
  station: StationId;
  /** Human-readable description for LiTT */
  description: string;
  /** Zod schema for arguments */
  argsSchema: Args;
  /** Result type */
  resultType: z.ZodType<Result>;
  /** Whether this action mutates state (subject to permissions) */
  mutating: boolean;
  /** Whether this action requires approval (subject to permissions) */
  requiresApproval?: boolean;
  /** Execute the action */
  execute: (args: z.infer<Args>, ctx: StationExecutionContext) => Promise<Result>;
}

export type PermissionLevel = "allow" | "ask" | "deny";

export interface PermissionSet {
  files: PermissionLevel;
  terminal: PermissionLevel;
  browser: PermissionLevel;
  git: PermissionLevel;
  create: PermissionLevel; // image/video/music/audio/design
  preview: PermissionLevel;
  deploy: PermissionLevel;
  production: PermissionLevel;
  payments: PermissionLevel;
  externalPost: PermissionLevel;
  secrets: PermissionLevel; // Always "deny" — cannot be overridden
}

export type MissionMode = "plan" | "act" | "auto";

export type FollowMode = "on" | "off";

export type ExecutionPhase =
  | "idle"
  | "planning"
  | "researching"
  | "creating"
  | "browsing"
  | "running"
  | "inspecting"
  | "editing"
  | "testing"
  | "verifying"
  | "deploying"
  | "awaiting_approval"
  | "complete"
  | "failed"
  | "cancelled";

export interface ExecutionEvent {
  id: string;
  seq: number;
  type:
    | "phase"
    | "tool_start"
    | "tool_result"
    | "tool_error"
    | "checkpoint"
    | "build_start"
    | "build_result"
    | "approval_required"
    | "approval_resolved"
    | "finished"
    | "cancelled"
    | "reasoning"
    | "status"
    | "model_routing"
    | "model_failed"
    | "repair_attempt";
  summary: string;
  toolId?: string;
  success?: boolean;
  durationMs?: number;
  label?: string;
  gitSha?: string;
  check?: string;
  errorCount?: number;
  phase?: ExecutionPhase;
  step?: number;
  ts: number;
  collapsed?: boolean;
  lowLevel?: boolean;
  filePath?: string;
  diff?: string;
  model?: string;
  provider?: string;
  fallbackFrom?: string;
  category?: string;
  message?: string;
}

export interface StationExecutionContext {
  projectId: string | null;
  conversationId: string | null;
  userId: string;
  actorUserId: string;
  permissions: PermissionSet;
  mode: MissionMode;
  followMode: FollowMode;
  /** Emit an execution event for the activity feed */
  emitEvent: (event: Omit<ExecutionEvent, "id" | "seq" | "ts">) => void;
  /** Switch the visible station (respects Follow LiTT mode) */
  navigateToStation: (station: StationId) => void;
  /** Report current station state for Live View */
  reportLiveState: (state: LiveStateSnapshot) => void;
  /** Request approval if needed */
  requestApproval: (actionId: string, reason: string) => Promise<boolean>;
}

export interface LiveStateSnapshot {
  station: StationId;
  summary: string;
  phase?: ExecutionPhase;
}