/**
 * Station Control Bridge — client-safe type surface.
 *
 * This module MUST stay client-safe: no `server-only` imports, no server-only
 * modules. Server-only logic lives in registry.ts / executor.ts / advertise.ts.
 *
 * Contract: docs/LITT-OS-IMPLEMENTATION-CONTRACT.md §3.1.
 */
import { z } from "zod";

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

export type PermissionLevel = "allow" | "ask" | "deny";

export interface PermissionSet {
  files: PermissionLevel;
  terminal: PermissionLevel;
  browser: PermissionLevel;
  git: PermissionLevel;
  create: PermissionLevel;
  preview: PermissionLevel;
  deploy: PermissionLevel;
  production: PermissionLevel;
  payments: PermissionLevel;
  externalPost: PermissionLevel;
  secrets: PermissionLevel;
}

export type MissionMode = "plan" | "act" | "auto";

export interface ExecutionEvent {
  type: "action_started" | "action_completed" | "action_failed" | "approval_required" | "live_state";
  actionId: string;
  station: StationId;
  summary: string;
  error?: string;
  errorCode?: string;
  resultSummary?: string;
}

export interface StationExecutionContext {
  projectId: string | null;
  conversationId: string | null;
  userId: string;
  permissions: PermissionSet;
  missionMode?: MissionMode;
  emitEvent: (event: Omit<ExecutionEvent, "id" | "seq" | "ts">) => void;
  navigateToStation: (station: StationId) => void;
  reportLiveState: (state: unknown) => void;
  transport?: unknown;
  actionContext?: { userId?: string; projectId?: string; actionRunId?: string };
  hasApproval?: boolean;
  signal?: AbortSignal;
}

export interface StationAction<Args extends z.ZodType = z.ZodType, Result = unknown> {
  id: string;
  station: StationId;
  description: string;
  argsSchema: Args;
  resultType: z.ZodType<Result>;
  mutating: boolean;
  requiresApproval?: boolean;
  execute: (args: z.infer<Args>, ctx: StationExecutionContext) => Promise<Result>;
}

export type StationResult =
  | { success: true; [k: string]: unknown }
  | {
      success: false;
      error: string;
      errorCode?: "unknown_action" | "permission_denied" | "approval_required" | "invalid_args" | "not_implemented" | "not_configured" | "execution_failed";
    };

export type FollowMode = "on" | "off";

export const FOLLOW_MODE_STORAGE_KEY = "littree:studio:follow-litt";
