import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { logFileOperation } from "@/lib/file-audit";
import { ensureWorkspaceAlive, normalizeFileError } from "@/lib/studio/workspace-recovery";

/**
 * POST /api/studio-projects/[projectId]/assets/insert
 *
 * Downloads an asset from its durable URL and writes it into the project
 * workspace as a binary file. This closes the "generate → save → use" loop:
 * after generating an image/audio/video/music asset, the user can insert it
 * directly into their project without manually copying URLs.
 *
 * Body: {
 *   url: string,         // durable asset URL (https://...)
 *   path: string,        // target workspace path (e.g. "public/assets/images/bg.png")
 *   kind?: string,       // asset kind for logging (image, audio, video, music)
 *   name?: string,       // asset name for logging
 * }
 *
 * Security:
 *   - Authenticated users only.
 *   - Project ownership verified server-side via verifyProjectWorkspace.
 *   - URL must be https:// (no file://, no data: — those can't be downloaded
 *     server-side safely and would fail anyway).
 *   - Path must be a safe relative path (no .. traversal, no absolute paths).
 *   - File operations are audit-logged.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL_BASE = () =>
  process.env.TERMINAL_SERVER_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_TERMINAL_WS_URL ??
  "https://terminal-server-production-68ac.up.railway.app";

const MAX_ASSET_SIZE = 50 * 1024 * 1024; // 50 MB

function isSafeRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return normalized !== "." &&
    !normalized.startsWith("/") &&
    !normalized.split("/").some(
      (segment) => segment === ".." || segment.includes("\u0000"),
    );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  let body: { url?: string; path?: string; kind?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url, path, kind, name } = body;

  if (!url || !path) {
    return NextResponse.json({ error: "Missing url or path" }, { status: 400 });
  }

  // URL must be https:// — no file://, data:, or other schemes
  if (!url.startsWith("https://")) {
    return NextResponse.json(
      { error: "Asset URL must be a public HTTPS URL" },
      { status: 400 },
    );
  }

  if (!isSafeRelativePath(path)) {
    return NextResponse.json({ error: "Invalid workspace path" }, { status: 400 });
  }

  try {
    // 1. Download the asset binary
    const assetResp = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!assetResp.ok) {
      return NextResponse.json(
        { error: `Failed to download asset: HTTP ${assetResp.status}` },
        { status: 502 },
      );
    }

    const contentType = assetResp.headers.get("content-type") || "application/octet-stream";
    const arrayBuf = await assetResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    if (buffer.length > MAX_ASSET_SIZE) {
      return NextResponse.json(
        { error: `Asset exceeds max size (${MAX_ASSET_SIZE} bytes)` },
        { status: 413 },
      );
    }

    // 2. Convert to base64 for the terminal server's binary write
    const base64Content = buffer.toString("base64");

    // 3. Write to the project workspace
    let { workspaceId } = await verifyProjectWorkspace(projectId, userId);
    let token = createTerminalToken(userId);

    let resp = await fetch(`${TERMINAL_BASE()}/ws-files/write`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.token}`,
        "X-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({
        path,
        content: base64Content,
        encoding: "base64",
      }),
    });

    // Stale workspace recovery
    if (resp.status === 404) {
      try {
        const recovered = await ensureWorkspaceAlive(projectId, userId, workspaceId);
        if (recovered.reprepared) {
          workspaceId = recovered.workspaceId;
          token = createTerminalToken(userId);
          resp = await fetch(`${TERMINAL_BASE()}/ws-files/write`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token.token}`,
              "X-Workspace-Id": workspaceId,
            },
            body: JSON.stringify({
              path,
              content: base64Content,
              encoding: "base64",
            }),
          });
        }
      } catch (recoveryErr) {
        const msg = recoveryErr instanceof Error ? recoveryErr.message : "Workspace recovery failed";
        return NextResponse.json({ error: msg }, { status: 503 });
      }
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "Unknown error");
      return NextResponse.json(
        { error: normalizeFileError(text) },
        { status: resp.status },
      );
    }

    // 4. Audit log
    await logFileOperation({
      userId,
      projectId,
      workspaceId,
      action: "write",
      path,
      contentLength: buffer.length,
      source: "user",
      ok: true,
    });

    return NextResponse.json({
      saved: true,
      path,
      contentType,
      sizeBytes: buffer.length,
      assetKind: kind,
      assetName: name,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to insert asset";
    const status = msg.includes("not found") ? 404 : msg.includes("Forbidden") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
