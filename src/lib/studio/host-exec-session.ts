"use client";

/**
 * Session guard for the HOST_EXECUTION_DISABLED prepare verdict.
 *
 * POST /api/studio-projects/[id]/workspace/prepare answers repo-backed
 * projects on the hosted service with 503 + code HOST_EXECUTION_DISABLED:
 * a deploy-time policy state (no verified sandbox), not a transient
 * failure. Retrying can never change it within a session — the honest
 * end state is the "repo workspace unavailable" surface, reached once.
 *
 * Mirrors the TERMINAL_DISABLED cache in src/lib/terminal-client.ts:
 * once a project returns the coded refusal, the verdict is cached for
 * the page session and every prepare caller settles WITHOUT issuing
 * another request (each attempt was a console 503 + a retry affordance
 * that could never succeed). Non-coded failures are never cached — a
 * later attempt retries them for real.
 */

import { HOST_EXECUTION_DISABLED_CODE } from "@/lib/host-execution-guard";

/**
 * Stored-refusal fix (2026-11-14): the verdict is no longer immutable
 * within a session — a sandbox can come up (canary refresh, deploy)
 * after the refusal was recorded. Settles now expire after this TTL,
 * so a later prepare attempt re-probes the server for real instead of
 * resolving "unavailable" from a stale session cache forever.
 */
export const HOST_EXEC_SETTLED_TTL_MS = 60_000;

const settledProjects = new Map<string, number>();

export function isHostExecSettled(projectId: string): boolean {
  const settledAt = settledProjects.get(projectId);
  if (settledAt === undefined) return false;
  if (Date.now() - settledAt > HOST_EXEC_SETTLED_TTL_MS) {
    settledProjects.delete(projectId);
    return false;
  }
  return true;
}

export function markHostExecSettled(projectId: string): void {
  settledProjects.set(projectId, Date.now());
}

/** Test/reset hook — parity with clearTerminalTokenCache. */
export function clearHostExecSettled(projectId?: string): void {
  if (projectId) settledProjects.delete(projectId);
  else settledProjects.clear();
}

/** True when a prepare response is the coded host-execution refusal. */
export function isHostExecDisabledResponse(
  status: number,
  body: { code?: unknown } | null | undefined,
): boolean {
  return status === 503 && body?.code === HOST_EXECUTION_DISABLED_CODE;
}

export type WorkspacePrepareOutcome =
  | { kind: "ready"; payload: Record<string, unknown> }
  | { kind: "unavailable" }
  | { kind: "failed"; message: string; status?: number };

/**
 * Single prepare attempt through the caller's own fetch stack (each
 * surface authenticates differently). When the project already settled
 * this session, resolves "unavailable" WITHOUT calling doFetch.
 * Callers map outcomes to their own state machines; "ready" requires
 * both an OK response and the route's workspaceStatus: "ready".
 */
export async function attemptWorkspacePrepare(
  projectId: string,
  doFetch: () => Promise<Response>,
): Promise<WorkspacePrepareOutcome> {
  if (isHostExecSettled(projectId)) return { kind: "unavailable" };
  let response: Response;
  try {
    response = await doFetch();
  } catch (err) {
    return {
      kind: "failed",
      message: err instanceof Error ? err.message : "Workspace preparation failed.",
    };
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (isHostExecDisabledResponse(response.status, payload)) {
    markHostExecSettled(projectId);
    return { kind: "unavailable" };
  }
  if (response.ok && payload?.workspaceStatus === "ready") {
    return { kind: "ready", payload };
  }
  const message =
    typeof payload?.error === "string"
      ? payload.error
      : `Workspace preparation failed (${response.status})`;
  return { kind: "failed", message, status: response.status };
}
