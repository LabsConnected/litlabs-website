import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { logFileOperation } from "@/lib/file-audit";

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
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  try {
    const { workspaceId } = await verifyProjectWorkspace(projectId, userId);
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
