import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace, getProject } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { logFileOperation } from "@/lib/file-audit";
import { ensureWorkspaceAlive, normalizeFileError, reprepareWorkspace } from "@/lib/studio/workspace-recovery";
import { requireTerminalBaseUrl, terminalNotConfiguredResponse } from "@/lib/terminal-config";

/**
 * Project-bound file operations.
 * Every request requires userId + projectId + workspaceId verification.
 * The browser calls Next.js; Next.js verifies ownership and forwards
 * to the terminal-server's workspace-scoped endpoints.
 *
 * GET  /api/studio-projects/[projectId]/files?path=...
 * POST /api/studio-projects/[projectId]/files  { action: "read"|"write"|"delete"|"mkdir"|"rename", path, newPath?, content? }
 */

const TERMINAL_BASE = () => requireTerminalBaseUrl();

/**
 * True when the terminal-server 404 means the WORKSPACE itself is gone —
 * only that justifies re-provisioning. A file-level miss ("File not found",
 * "Path not found") is a routine not-found and must pass through untouched.
 */
async function isWorkspaceMissingResponse(resp: Response): Promise<boolean> {
  const body = (await resp
    .clone()
    .json()
    .catch(() => null)) as { error?: string } | null;
  return body?.error === "Workspace not found";
}

/**
 * Bounded upstream call: one attempt + one retry, only for transport-level
 * failures (socket reset / terminal hang). Timeout-bounded so a hung terminal
 * connection cannot stack unbounded in-flight requests on the dev/prod
 * server — the demonstrated source of cascading 500s under polling.
 * HTTP error statuses are NOT retried: they are meaningful responses.
 * The Authorization header is never deserialized into error text or logs.
 */
const UPSTREAM_TIMEOUT_MS = 30_000;
async function upstreamTerminalFetch(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    } catch (err) {
      lastErr = err;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastErr;
}

/** Sanitize an upstream/transport error for client + audit trail (no tokens). */
function sanitizedUpstreamError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/bearer\s+[A-Za-z0-9._-]+/gi, "bearer [redacted]");
}

/**
 * Transport-level failure response with correlation ID + sanitized trace.
 * Logs { correlationId, op, workspaceId, upstream URL, status "transport-failed",
 * sanitized error } — never the Authorization header or token.
 */
function terminalUnavailableResponse(
  correlationId: string,
  op: string,
  workspaceId: string,
  upstreamUrl: string,
  upstreamErr: unknown,
): NextResponse {
  console.error(
    JSON.stringify({
      correlationId,
      op,
      workspaceId,
      upstream: upstreamUrl,
      upstreamStatus: "transport-failed",
      error: sanitizedUpstreamError(upstreamErr),
    }),
  );
  return NextResponse.json(
    {
      error: "File service is temporarily unavailable (terminal connection failed)",
      code: "TERMINAL_UNAVAILABLE",
      correlationId,
    },
    { status: 503, headers: { "x-correlation-id": correlationId } },
  );
}

/**
 * GET /api/studio-projects/[projectId]/files?path=...
 * List directory contents in the project workspace.
 * Auto-recovers if the terminal server lost the workspace.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const correlationId = randomUUID();
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const terminalUnavailable = terminalNotConfiguredResponse();
  if (terminalUnavailable) return terminalUnavailable;

  const { projectId } = await params;

  try {
    let verified;
    try {
      verified = await verifyProjectWorkspace(projectId, userId);
    } catch (verifyErr) {
      const code = (verifyErr as { code?: string }).code;
      if (code === "WORKSPACE_NOT_PROVISIONED" || code === "WORKSPACE_NOT_READY") {
        // Auto-recovery: if the workspace was never provisioned (no
        // workspaceId), provision it now. If it was provisioned but
        // lost on the terminal server, re-prepare it.
        try {
          const project = await getProject(projectId, userId);
          if (project?.workspaceId) {
            // Workspace was provisioned but may be stale — verify and recover
            await ensureWorkspaceAlive(projectId, userId, project.workspaceId);
            verified = await verifyProjectWorkspace(projectId, userId);
          } else {
            // Workspace was never provisioned — provision it now.
            // This is the fix for the repeated /files?path=. 500s:
            // instead of returning 500, we auto-provision and retry.
            await reprepareWorkspace(projectId, userId);
            verified = await verifyProjectWorkspace(projectId, userId);
          }
        } catch {
          throw verifyErr;
        }
      } else {
        throw verifyErr;
      }
    }

    const { workspaceId } = verified;
    const path = request.nextUrl.searchParams.get("path") || ".";
    const { token } = createTerminalToken(userId);
    const upstreamPath = `/ws-files?path=${encodeURIComponent(path)}`;
    const upstreamUrl = new URL(upstreamPath, TERMINAL_BASE()).href;

    let resp: Response;
    try {
      resp = await upstreamTerminalFetch(upstreamUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Workspace-Id": workspaceId,
        },
      });
    } catch (upstreamErr) {
      return terminalUnavailableResponse(correlationId, "files.list", workspaceId, upstreamUrl, upstreamErr);
    }

    // Stale workspace recovery: if the terminal server says the workspace
    // doesn't exist (even though DB says ready), re-provision and retry once.
    // A file-level 404 is not a workspace failure — skip recovery for it.
    if (resp.status === 404 && (await isWorkspaceMissingResponse(resp))) {
      try {
        const recovered = await ensureWorkspaceAlive(projectId, userId, workspaceId);
        if (recovered.reprepared) {
          const newToken = createTerminalToken(userId);
          resp = await upstreamTerminalFetch(upstreamUrl, {
            headers: {
              Authorization: `Bearer ${newToken.token}`,
              "X-Workspace-Id": recovered.workspaceId,
            },
          });
        }
      } catch (recoveryErr) {
        const msg = recoveryErr instanceof Error ? recoveryErr.message : "Workspace recovery failed";
        console.error(JSON.stringify({
          correlationId,
          op: "files.list",
          workspaceId,
          upstream: upstreamUrl,
          upstreamStatus: "recovery-failed",
          error: sanitizedUpstreamError(recoveryErr),
        }));
        return NextResponse.json({ error: msg, code: "WORKSPACE_RECOVERY_FAILED", correlationId }, { status: 503, headers: { "x-correlation-id": correlationId } });
      }
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "Unknown error");
      console.error(JSON.stringify({
        correlationId,
        op: "files.list",
        workspaceId,
        upstream: upstreamUrl,
        upstreamStatus: resp.status,
        error: normalizeFileError(text),
      }));
      return NextResponse.json(
        { error: normalizeFileError(text), correlationId },
        { status: resp.status, headers: { "x-correlation-id": correlationId } },
      );
    }

    return NextResponse.json(await resp.json(), { headers: { "x-correlation-id": correlationId } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list files";
    const code = (err as { code?: string }).code ?? null;
    // Map known workspace errors to proper status codes instead of 500
    const status =
      code === "PROJECT_NOT_FOUND" ? 404 :
      code === "FORBIDDEN" ? 403 :
      code === "WORKSPACE_NOT_PROVISIONED" || code === "WORKSPACE_NOT_READY" ? 409 :
      msg.includes("not found") ? 404 :
      msg.includes("Forbidden") ? 403 :
      500;
    console.error(JSON.stringify({
      correlationId,
      op: "files.list",
      upstreamStatus: "handler-error",
      error: sanitizedUpstreamError(err),
    }));
    return NextResponse.json({ error: msg, code, correlationId }, { status, headers: { "x-correlation-id": correlationId } });
  }
}

/**
 * POST /api/studio-projects/[projectId]/files
 * Body: { action: "read" | "write" | "delete", path: string, content?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const correlationId = randomUUID();
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const terminalUnavailable = terminalNotConfiguredResponse();
  if (terminalUnavailable) return terminalUnavailable;

  const { projectId } = await params;

  let body: { action?: string; path?: string; newPath?: string; content?: string; encoding?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  const path = body.path ?? "";
  const newPath = body.newPath ?? "";

  if (!action || !path) {
    return NextResponse.json({ error: "Missing action or path" }, { status: 400 });
  }

  if (!["read", "write", "delete", "mkdir", "rename"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const isSafeRelativePath = (value: string) => {
    const normalized = value.replace(/\\/g, "/");
    return normalized !== "." &&
      !normalized.startsWith("/") &&
      !normalized.split("/").some((segment) => segment === ".." || segment.includes("\u0000"));
  };

  if (!isSafeRelativePath(path) || (action === "rename" && !isSafeRelativePath(newPath))) {
    return NextResponse.json({ error: "Invalid workspace path" }, { status: 400 });
  }

  let workspaceId = "unknown";
  try {
    // Auto-provision if workspace is not ready (same recovery as GET)
    try {
      workspaceId = (await verifyProjectWorkspace(projectId, userId)).workspaceId;
    } catch (verifyErr) {
      const code = (verifyErr as { code?: string }).code;
      if (code === "WORKSPACE_NOT_PROVISIONED" || code === "WORKSPACE_NOT_READY") {
        const project = await getProject(projectId, userId);
        if (project?.workspaceId) {
          await ensureWorkspaceAlive(projectId, userId, project.workspaceId);
        } else {
          await reprepareWorkspace(projectId, userId);
        }
        workspaceId = (await verifyProjectWorkspace(projectId, userId)).workspaceId;
      } else {
        throw verifyErr;
      }
    }
    let token = createTerminalToken(userId);
    const upstreamPath = `/ws-files/${action}`;
    const upstreamUrl = new URL(upstreamPath, TERMINAL_BASE()).href;

    const forwardBody = JSON.stringify({
      path,
      newPath: action === "rename" ? newPath : undefined,
      content: body.content,
      encoding: body.encoding,
    });

    let resp: Response;
    try {
      resp = await upstreamTerminalFetch(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.token}`,
          "X-Workspace-Id": workspaceId,
        },
        body: forwardBody,
      });
    } catch (upstreamErr) {
      return terminalUnavailableResponse(correlationId, `files.${action}`, workspaceId, upstreamUrl, upstreamErr);
    }

    // Stale workspace recovery for POST operations — workspace-level 404
    // only; a missing file is a normal not-found result, not a lost workspace.
    if (resp.status === 404 && (await isWorkspaceMissingResponse(resp))) {
      try {
        const recovered = await ensureWorkspaceAlive(projectId, userId, workspaceId);
        if (recovered.reprepared) {
          workspaceId = recovered.workspaceId;
          token = createTerminalToken(userId);
          resp = await upstreamTerminalFetch(upstreamUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token.token}`,
              "X-Workspace-Id": workspaceId,
            },
            body: forwardBody,
          });
        }
      } catch (recoveryErr) {
        const msg = recoveryErr instanceof Error ? recoveryErr.message : "Workspace recovery failed";
        console.error(JSON.stringify({
          correlationId,
          op: `files.${action}`,
          workspaceId,
          upstream: upstreamUrl,
          upstreamStatus: "recovery-failed",
          error: sanitizedUpstreamError(recoveryErr),
        }));
        return NextResponse.json({ error: msg, code: "WORKSPACE_RECOVERY_FAILED", correlationId }, { status: 503, headers: { "x-correlation-id": correlationId } });
      }
    }

    const ok = resp.ok;

    // Audit log mutating operations (reads are non-mutating, skip)
    if (action === "write" || action === "delete" || action === "mkdir" || action === "rename") {
      await logFileOperation({
        userId,
        projectId,
        workspaceId,
        action: action as "write" | "delete" | "mkdir" | "rename",
        path: action === "rename" ? `${path} -> ${newPath}` : path,
        contentLength: action === "write" ? (body.content?.length ?? 0) : undefined,
        source: "user",
        ok,
        error: ok ? undefined : `HTTP ${resp.status}`,
      });
    }

    if (!ok) {
      const text = await resp.text().catch(() => "Unknown error");
      console.error(JSON.stringify({
        correlationId,
        op: `files.${action}`,
        workspaceId,
        upstream: upstreamUrl,
        upstreamStatus: resp.status,
        error: normalizeFileError(text),
      }));
      return NextResponse.json(
        { error: normalizeFileError(text), correlationId },
        { status: resp.status, headers: { "x-correlation-id": correlationId } },
      );
    }

    return NextResponse.json(await resp.json(), { headers: { "x-correlation-id": correlationId } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "File operation failed";

    // Audit log failed operations
    if (action === "write" || action === "delete" || action === "mkdir" || action === "rename") {
      await logFileOperation({
        userId,
        projectId,
        workspaceId: workspaceId === "unknown" ? "unknown" : workspaceId,
        action: action as "write" | "delete" | "mkdir" | "rename",
        path: action === "rename" ? `${path} -> ${newPath}` : path,
        contentLength: action === "write" ? (body.content?.length ?? 0) : undefined,
        source: "user",
        ok: false,
        error: msg,
      }).catch(() => {});
    }

    const code = (err as { code?: string }).code ?? null;
    const status =
      code === "PROJECT_NOT_FOUND" ? 404 :
      code === "FORBIDDEN" ? 403 :
      code === "WORKSPACE_NOT_PROVISIONED" || code === "WORKSPACE_NOT_READY" ? 409 :
      msg.includes("not found") ? 404 :
      msg.includes("Forbidden") ? 403 :
      500;
    console.error(JSON.stringify({
      correlationId,
      op: `files.${action}`,
      upstreamStatus: "handler-error",
      error: sanitizedUpstreamError(err),
    }));
    return NextResponse.json({ error: msg, code, correlationId }, { status, headers: { "x-correlation-id": correlationId } });
  }
}
