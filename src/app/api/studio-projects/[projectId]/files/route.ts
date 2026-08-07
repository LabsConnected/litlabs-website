import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace, getProject, updateProjectWorkspace } from "@/lib/projects/project-repository";
import { getWorkspaceInternal, prepareWorkspaceInternal } from "@/lib/terminal-internal-client";
import { createTerminalToken } from "@/lib/terminal-auth";
import { logFileOperation } from "@/lib/file-audit";
import { getInstallationToken } from "@/lib/github-app";

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
  "https://litlabs-terminal-server-production-0be1.up.railway.app";

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
      // Workspace might be stale (terminal server restarted).
      // Try to auto-re-prepare before giving up.
      const code = (verifyErr as { code?: string }).code;
      if (code === "WORKSPACE_NOT_PROVISIONED" || code === "WORKSPACE_NOT_READY") {
        // Check if the workspace still exists on the terminal server
        const project = await getProject(projectId, userId);
        if (project && project.workspaceId) {
          const ws = await getWorkspaceInternal(project.workspaceId, userId).catch(() => null);
          if (!ws) {
            // Workspace was lost — reset and re-prepare
            await updateProjectWorkspace(projectId, userId, {
              workspaceId: null,
              workspaceStatus: "not_prepared",
              workspaceRoot: null,
              workspaceError: null,
            });

            // Re-prepare
            if (project.sourceType === "github" && project.githubInstallationId && project.githubOwner && project.githubRepo) {
              const githubToken = await getInstallationToken(project.githubInstallationId);
              const result = await prepareWorkspaceInternal({
                sourceType: "github",
                userId,
                projectId,
                installationId: project.githubInstallationId,
                owner: project.githubOwner,
                repo: project.githubRepo,
                branch: project.githubBranch ?? "main",
                commitSha: project.latestCommitSha,
                githubToken,
              });
              await updateProjectWorkspace(projectId, userId, {
                workspaceId: result.workspaceId,
                workspaceStatus: "ready",
                workspaceRoot: result.root,
                workspaceError: null,
              });
              // Retry verification
              verified = await verifyProjectWorkspace(projectId, userId);
            } else {
              throw verifyErr;
            }
          } else {
            // Workspace exists but isn't marked ready — update status
            await updateProjectWorkspace(projectId, userId, {
              workspaceStatus: ws.ready ? "ready" : "preparing",
            });
            if (ws.ready) {
              verified = await verifyProjectWorkspace(projectId, userId);
            } else {
              throw verifyErr;
            }
          }
        } else {
          throw verifyErr;
        }
      } else {
        throw verifyErr;
      }
    }

    const { workspaceId } = verified;
    const path = request.nextUrl.searchParams.get("path") || ".";
    const { token } = createTerminalToken(userId);

    const resp = await fetch(
      `${TERMINAL_BASE()}/ws-files?path=${encodeURIComponent(path)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Workspace-Id": workspaceId,
        },
      },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "Unknown error");
      return NextResponse.json({ error: text }, { status: resp.status });
    }

    return NextResponse.json(await resp.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list files";
    const status = msg.includes("not found") ? 404 : msg.includes("Forbidden") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
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

  let body: { action?: string; path?: string; newPath?: string; content?: string };
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
    const { workspaceId } = await verifyProjectWorkspace(projectId, userId);
    const { token } = createTerminalToken(userId);

    const resp = await fetch(`${TERMINAL_BASE()}/ws-files/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({ path, newPath: action === "rename" ? newPath : undefined, content: body.content }),
    });

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
      return NextResponse.json({ error: text }, { status: resp.status });
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

    const status = msg.includes("not found") ? 404 : msg.includes("Forbidden") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
