import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace, getProject } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { logFileOperation } from "@/lib/file-audit";
import { ensureWorkspaceAlive, normalizeFileError, reprepareWorkspace } from "@/lib/studio/workspace-recovery";

/**
 * Project-bound file operations.
 * Every request requires userId + projectId + workspaceId verification.
 * The browser calls Next.js; Next.js verifies ownership and forwards
 * to the terminal-server's workspace-scoped endpoints.
 *
 * GET  /api/studio-projects/[projectId]/files?path=...
 * POST /api/studio-projects/[projectId]/files  { action: "read"|"write"|"delete"|"mkdir"|"rename", path, newPath?, content? }
 */

const TERMINAL_BASE = () =>
  process.env.TERMINAL_SERVER_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_TERMINAL_WS_URL ??
  "https://terminal-server-production-68ac.up.railway.app";

/**
 * GET /api/studio-projects/[projectId]/files?path=...
 * List directory contents in the project workspace.
 * Auto-recovers if the terminal server lost the workspace.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

    let resp = await fetch(
      `${TERMINAL_BASE()}/ws-files?path=${encodeURIComponent(path)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Workspace-Id": workspaceId,
        },
      },
    );

    // Stale workspace recovery: if the terminal server says the workspace
    // doesn't exist (even though DB says ready), re-provision and retry once.
    if (resp.status === 404) {
      try {
        const recovered = await ensureWorkspaceAlive(projectId, userId, workspaceId);
        if (recovered.reprepared) {
          const newToken = createTerminalToken(userId);
          resp = await fetch(
            `${TERMINAL_BASE()}/ws-files?path=${encodeURIComponent(path)}`,
            {
              headers: {
                Authorization: `Bearer ${newToken.token}`,
                "X-Workspace-Id": recovered.workspaceId,
              },
            },
          );
        }
      } catch (recoveryErr) {
        const msg = recoveryErr instanceof Error ? recoveryErr.message : "Workspace recovery failed";
        return NextResponse.json({ error: msg }, { status: 503 });
      }
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "Unknown error");
      return NextResponse.json({ error: normalizeFileError(text) }, { status: resp.status });
    }

    return NextResponse.json(await resp.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list files";
    const code = (err as { code?: string }).code;
    // Map known workspace errors to proper status codes instead of 500
    const status =
      code === "PROJECT_NOT_FOUND" ? 404 :
      code === "FORBIDDEN" ? 403 :
      code === "WORKSPACE_NOT_PROVISIONED" || code === "WORKSPACE_NOT_READY" ? 409 :
      msg.includes("not found") ? 404 :
      msg.includes("Forbidden") ? 403 :
      500;
    return NextResponse.json({ error: msg, code: code ?? null }, { status });
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
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  try {
    // Auto-provision if workspace is not ready (same recovery as GET)
    let workspaceId: string;
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

    let resp = await fetch(`${TERMINAL_BASE()}/ws-files/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.token}`,
        "X-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({ path, newPath: action === "rename" ? newPath : undefined, content: body.content }),
    });

    // Stale workspace recovery for POST operations
    if (resp.status === 404) {
      try {
        const recovered = await ensureWorkspaceAlive(projectId, userId, workspaceId);
        if (recovered.reprepared) {
          workspaceId = recovered.workspaceId;
          token = createTerminalToken(userId);
          resp = await fetch(`${TERMINAL_BASE()}/ws-files/${action}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token.token}`,
              "X-Workspace-Id": workspaceId,
            },
            body: JSON.stringify({ path, newPath: action === "rename" ? newPath : undefined, content: body.content }),
          });
        }
      } catch (recoveryErr) {
        const msg = recoveryErr instanceof Error ? recoveryErr.message : "Workspace recovery failed";
        return NextResponse.json({ error: msg }, { status: 503 });
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
      return NextResponse.json({ error: normalizeFileError(text) }, { status: resp.status });
    }

    return NextResponse.json(await resp.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "File operation failed";

    // Audit log failed operations
    if (action === "write" || action === "delete" || action === "mkdir" || action === "rename") {
      await logFileOperation({
        userId,
        projectId,
        workspaceId: "unknown",
        action: action as "write" | "delete" | "mkdir" | "rename",
        path: action === "rename" ? `${path} -> ${newPath}` : path,
        contentLength: action === "write" ? (body.content?.length ?? 0) : undefined,
        source: "user",
        ok: false,
        error: msg,
      }).catch(() => {});
    }

    const code = (err as { code?: string }).code;
    const status =
      code === "PROJECT_NOT_FOUND" ? 404 :
      code === "FORBIDDEN" ? 403 :
      code === "WORKSPACE_NOT_PROVISIONED" || code === "WORKSPACE_NOT_READY" ? 409 :
      msg.includes("not found") ? 404 :
      msg.includes("Forbidden") ? 403 :
      500;
    return NextResponse.json({ error: msg, code: code ?? null }, { status });
  }
}
