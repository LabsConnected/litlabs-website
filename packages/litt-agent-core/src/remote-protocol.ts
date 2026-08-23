/**
 * Canonical remote command protocol — the ONE contract shared between
 * the LiTT CLI (`litt --remote`), Termux HTTP clients, Desktop observers,
 * and terminal-server's `/internal/command` endpoint.
 *
 * Both sides import these types from `@litt/agent-core`. No duplicate
 * interface definitions in `packages/litt-cli` or `terminal-server`.
 *
 * Flow:
 *
 *   client (CLI / Termux / Desktop)
 *        ↓  RemoteCommandRequest  (structured argv — never shell-string)
 *   POST /internal/command
 *        ↓
 *   terminal-server CommandBridge
 *        ↓
 *   canonical command dispatcher (registry / ExecutionGateway)
 *        ↓
 *   RemoteCommandResponse  (same runId as the runtime execution)
 *        ↓
 *   client decodes the SAME schema
 *
 * Design rules:
 *   - `args` is a structured `string[]`. Never encode arbitrary args
 *     into a shell string. The server preserves argv end-to-end.
 *   - `runId` in the response is the ACTUAL runtime execution runId,
 *     not a second identity minted by the bridge. If a client-supplied
 *     `requestId` is present it is echoed back unchanged for
 *     client-side correlation; `requestId` and `runId` are explicitly
 *     different concepts.
 *   - Unsupported commands fail with a typed `RemoteCommandError`
 *     (`code: "unknown_command"`) — never a crash, never undefined
 *     dereferencing.
 *   - `result` is the canonical `ToolResult` from `types.ts`. One level
 *     of nesting, not three.
 */

import type { ToolResult, ToolStatus } from "./types.js";
import type { MissionMode } from "./execution.js";

// ─── Request ──────────────────────────────────────────────────────

/**
 * Request sent by a remote client (CLI / Termux / Desktop) to
 * terminal-server's `/internal/command` endpoint.
 */
export interface RemoteCommandRequest {
  /** Bare command (e.g. "status") or slash command (e.g. "/status"). */
  command: string;
  /**
   * Structured argv. Preserved end-to-end — never encoded into a shell
   * string. The server dispatches these to the registry handler or to
   * ExecutionGateway's `project.run` inputs.args.
   */
  args: string[];
  /** Working directory. Defaults to server cwd / workspace root. */
  cwd?: string;
  /**
   * Optional client-generated correlation ID. Echoed back unchanged in
   * the response. Distinct from `runId` — this is a request identity,
   * not an execution identity.
   */
  requestId?: string;
  /** Mission mode (PLAN/ACT/AUTO). Defaults to "act". */
  mode?: MissionMode;
  /** Optional workspace ID (resolves cwd from the workspace registry). */
  workspaceId?: string;
  /** Optional authenticated user ID (set by the server from auth). */
  userId?: string | null;
  /** Optional authenticated user's email (set by the server from JWT). */
  authEmail?: string | null;
}

// ─── Response ─────────────────────────────────────────────────────

/**
 * Response returned by terminal-server. Both the server and every
 * client decode this exact schema.
 */
export interface RemoteCommandResponse {
  /** True iff the command executed and succeeded. */
  ok: boolean;
  /**
   * The ACTUAL runtime execution runId — the same runId emitted to the
   * RuntimeStore and Socket.IO. Not a second identity minted by the
   * bridge.
   */
  runId: string;
  /** Echoed back from the request if the client supplied one. */
  requestId?: string;
  /**
   * The canonical ToolResult. Present on success AND on controlled
   * command-level failures (e.g. build exited non-zero). Absent only
   * on protocol-level errors (`error` is present instead).
   */
  result?: ToolResult;
  /**
   * Protocol-level error. Present when the request could not be
   * dispatched at all (unknown command, malformed request, gateway
   * denial before execution). Absent for command-level failures.
   */
  error?: RemoteCommandError;
  /** Response kind from the command registry (e.g. "status", "build"). */
  kind: string;
  /** Server timestamp (epoch ms). */
  timestamp: number;
  /** Execution duration in milliseconds. */
  durationMs: number;
}

/**
 * Typed protocol-level error. Allows clients to branch on `code`
 * instead of string-matching messages.
 */
export interface RemoteCommandError {
  /** Machine-readable error code. */
  code: RemoteCommandErrorCode;
  /** Human-readable message (redacted). */
  message: string;
  /** For `unknown_command`: the list of supported command names. */
  availableCommands?: string[];
}

export type RemoteCommandErrorCode =
  | "unknown_command"
  | "malformed_request"
  | "gateway_denied"
  | "plan_mode_rejected"
  | "approval_required"
  | "internal_error";

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Build a success response from a registry CommandResponse-like shape.
 * Centralizes the ToolResult construction so the bridge never hand-rolls it.
 */
export function successResponse(params: {
  runId: string;
  requestId?: string;
  ok: boolean;
  kind: string;
  message: string;
  data: Record<string, unknown>;
  durationMs: number;
  timestamp?: number;
}): RemoteCommandResponse {
  const status: ToolStatus = params.ok ? "success" : "failed";
  const result: ToolResult = {
    status,
    success: params.ok,
    message: params.message,
    data: params.data,
  };
  return {
    ok: params.ok,
    runId: params.runId,
    requestId: params.requestId,
    result,
    kind: params.kind,
    timestamp: params.timestamp ?? Date.now(),
    durationMs: params.durationMs,
  };
}

/**
 * Build a typed error response for protocol-level failures.
 */
export function errorResponse(params: {
  runId: string;
  requestId?: string;
  code: RemoteCommandErrorCode;
  message: string;
  availableCommands?: string[];
  kind?: string;
  durationMs?: number;
  timestamp?: number;
}): RemoteCommandResponse {
  return {
    ok: false,
    runId: params.runId,
    requestId: params.requestId,
    error: {
      code: params.code,
      message: params.message,
      availableCommands: params.availableCommands,
    },
    kind: params.kind ?? "error",
    timestamp: params.timestamp ?? Date.now(),
    durationMs: params.durationMs ?? 0,
  };
}

/**
 * Type guard: does the response carry a protocol-level error?
 */
export function isRemoteError(
  response: RemoteCommandResponse,
): response is RemoteCommandResponse & { error: RemoteCommandError } {
  return response.error !== undefined;
}

/**
 * Type guard: does the response carry a result?
 */
export function hasRemoteResult(
  response: RemoteCommandResponse,
): response is RemoteCommandResponse & { result: ToolResult } {
  return response.result !== undefined;
}
