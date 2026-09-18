import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { logFileOperation } from "@/lib/file-audit";
import { ensureWorkspaceAlive, normalizeFileError } from "@/lib/studio/workspace-recovery";
import { getTerminalServerUrl } from "@/lib/terminal-url";

/**
 * POST /api/studio-projects/[projectId]/assets/insert
 *
 * Downloads an asset from its durable URL and writes it into the project
 * workspace as a binary file. This closes the "generate → save → use" loop:
 * after generating an image/audio/video/music asset, the user can insert it
 * directly into their project without manually copying URLs.
 *
 * Body: {
 *   url: string,         // durable asset URL (https://... or data:image/* — the
 *                        // free providers return generated images inline)
 *   path: string,        // target workspace path (e.g. "public/assets/images/bg.png")
 *   kind?: string,       // asset kind for logging (image, audio, video, music)
 *   name?: string,       // asset name for logging
 * }
 *
 * Security:
 *   - Authenticated users only.
 *   - Project ownership verified server-side via verifyProjectWorkspace.
 *   - URL must be https:// or data:image/* (no file:// or other schemes;
 *     data: URLs carry their bytes inline and are decoded server-side).
 *   - Path must be a safe relative path (no .. traversal, no absolute paths).
 *   - File operations are audit-logged.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL_BASE = () =>
  process.env.TERMINAL_SERVER_INTERNAL_URL ??
  getTerminalServerUrl();

const MAX_ASSET_SIZE = 50 * 1024 * 1024; // 50 MB

function isSafeRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return normalized !== "." &&
    !normalized.startsWith("/") &&
    !normalized.split("/").some(
      (segment) => segment === ".." || segment.includes("\u0000"),
    );
}

/**
 * Structural completeness check for image payloads — mirrors
 * insertAssetFromUrl in tool-handlers-v2. A truncated data: URL decodes
 * into a corrupt file that ships as a broken site asset; verify head and
 * tail markers for the formats we accept and let unknown types through.
 */
function imagePayloadLooksComplete(buffer: Buffer, contentType: string): boolean {
  const mime = contentType.toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") {
    return (
      buffer.length > 4 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 &&
      buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9
    );
  }
  if (mime === "image/png") {
    return (
      buffer.length > 16 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 &&
      buffer.subarray(-8).equals(
        Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
      )
    );
  }
  if (mime === "image/gif") {
    return (
      buffer.length > 7 &&
      buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 &&
      buffer[buffer.length - 1] === 0x3b
    );
  }
  if (mime === "image/webp") {
    return (
      buffer.length > 20 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP" &&
      buffer.readUInt32LE(4) + 8 <= buffer.length
    );
  }
  return true;
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

  // URL must be https:// or data:image/* — no file:// or other schemes.
  // data: URLs carry their bytes inline (free providers return generated
  // images this way), so they decode server-side without a fetch.
  const isDataImage = /^data:image\//i.test(url);
  if (!url.startsWith("https://") && !isDataImage) {
    return NextResponse.json(
      { error: "Asset URL must be a public HTTPS URL or a data:image/* URL" },
      { status: 400 },
    );
  }

  if (!isSafeRelativePath(path)) {
    return NextResponse.json({ error: "Invalid workspace path" }, { status: 400 });
  }

  try {
    // 1. Obtain the asset binary — inline decode for data:, HTTP fetch for https://
    let buffer: Buffer;
    let contentType: string;
    if (isDataImage) {
      const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/i.exec(url);
      if (!match) {
        return NextResponse.json({ error: "Malformed data: URL" }, { status: 400 });
      }
      contentType = match[1];
      try {
        buffer = match[2]
          ? Buffer.from(match[3], "base64")
          : Buffer.from(decodeURIComponent(match[3]), "utf8");
      } catch {
        return NextResponse.json({ error: "Malformed data: URL" }, { status: 400 });
      }
    } else {
      const assetResp = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!assetResp.ok) {
        return NextResponse.json(
          { error: `Failed to download asset: HTTP ${assetResp.status}` },
          { status: 502 },
        );
      }

      contentType = assetResp.headers.get("content-type") || "application/octet-stream";
      const arrayBuf = await assetResp.arrayBuffer();
      buffer = Buffer.from(arrayBuf);
    }

    if (contentType.startsWith("image/") && !imagePayloadLooksComplete(buffer, contentType)) {
      return NextResponse.json(
        { error: "Image data is truncated or corrupt" },
        { status: 422 },
      );
    }

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
