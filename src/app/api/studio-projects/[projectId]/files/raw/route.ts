import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";

/**
 * GET /api/studio-projects/[projectId]/files/raw?path=...
 *
 * Streams a binary/media file from the workspace with auth and path traversal protection.
 * Returns the file with appropriate Content-Type and Content-Disposition headers.
 */
const TERMINAL_BASE = () =>
  process.env.TERMINAL_SERVER_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_TERMINAL_WS_URL ??
  "https://terminal-server-production-68ac.up.railway.app";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ico: "image/x-icon",
  bmp: "image/bmp",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

function getMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_MAP[ext] ?? "application/octet-stream";
}

function isSafeRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return normalized !== "." &&
    !normalized.startsWith("/") &&
    !normalized.split("/").some((segment) => segment === ".." || segment.includes("\u0000"));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const filePath = request.nextUrl.searchParams.get("path");

  if (!filePath || !isSafeRelativePath(filePath)) {
    return NextResponse.json({ error: "Invalid or missing path" }, { status: 400 });
  }

  try {
    const { workspaceId } = await verifyProjectWorkspace(projectId, userId);
    const { token } = createTerminalToken(userId);

    // Fetch the raw file from the terminal server's ws-files endpoint
    const resp = await fetch(
      `${TERMINAL_BASE()}/ws-files/read`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Workspace-Id": workspaceId,
        },
        body: JSON.stringify({ path: filePath }),
      },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "Unknown error");
      return NextResponse.json({ error: text }, { status: resp.status });
    }

    // The terminal server returns JSON with content for text files.
    // For binary files, we need to check if the response contains binary data.
    const contentType = resp.headers.get("content-type") ?? "";

    // If the terminal server returned JSON, it's a text file read
    if (contentType.includes("application/json")) {
      const data = await resp.json().catch(() => null) as { content?: string; error?: string; size?: number } | null;
      if (!data || data.error) {
        return NextResponse.json({ error: data?.error ?? "Failed to read file" }, { status: 500 });
      }

      // For SVG and HTML, return the content directly with proper content type
      const mime = getMimeType(filePath);
      if (mime === "image/svg+xml" || mime === "text/html") {
        return new NextResponse(data.content ?? "", {
          status: 200,
          headers: {
            "Content-Type": mime,
            "Cache-Control": "no-store",
            "X-File-Size": String(data.size ?? (data.content?.length ?? 0)),
          },
        });
      }

      // For other text files, return as JSON with metadata
      return NextResponse.json({
        path: filePath,
        content: data.content ?? "",
        size: data.size ?? (data.content?.length ?? 0),
        mimeType: mime,
      });
    }

    // Binary response — stream it through with proper headers
    const contentLength = resp.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File exceeds 50MB limit" }, { status: 413 });
    }

    const mime = getMimeType(filePath);
    const fileName = filePath.split("/").pop() ?? filePath;
    const headers = new Headers({
      "Content-Type": mime,
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${fileName}"`,
    });
    if (contentLength) headers.set("Content-Length", contentLength);

    return new NextResponse(resp.body, { status: 200, headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read file";
    const status = msg.includes("not found") ? 404 : msg.includes("Forbidden") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
