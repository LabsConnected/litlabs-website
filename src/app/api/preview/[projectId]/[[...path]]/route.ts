import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { requireTerminalBaseUrl } from "@/lib/terminal-config";

/**
 * Static preview: serves HTML/CSS/JS/image files from a project's workspace
 * WITHOUT any terminal execution, dev server, or subprocess.
 *
 * Security model:
 * - Clerk auth required; project ownership enforced via getProject().
 * - Path traversal rejected (no `..`, no absolute paths, no empty segments
 *   except the implicit directory → index.html mapping).
 * - Content-Security-Policy `sandbox` puts user content in an opaque origin:
 *   no access to LiTT cookies, localStorage, or the parent page's DOM.
 * - `X-Content-Type-Options: nosniff` prevents MIME confusion attacks.
 * - Files are fetched from the terminal server's /ws-files/read, which
 *   applies its own workspace-path resolution and ownership checks.
 *
 * Gate 1: this route spawns zero subprocesses. It performs pure HTTP
 * fetch + response streaming. Host execution remains disabled.
 */

const MIME_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  webmanifest: "application/manifest+json",
};

const PREVIEW_SECURITY_HEADERS: Record<string, string> = {
  // Opaque origin: user content cannot read LiTT cookies, localStorage,
  // sessionStorage, or reach the parent frame. allow-scripts permits the
  // site's own JS to run (needed for interactive previews) without granting
  // same-origin privileges. unsafe-inline allows Canvas-generated inline
  // styles/scripts; the sandbox still blocks same-origin access.
  "Content-Security-Policy": "sandbox allow-scripts; default-src 'self' data: blob:; style-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-inline' data: blob:;",
  "X-Content-Type-Options": "nosniff",
  // No referrer leakage to third parties embedded in user content.
  "Referrer-Policy": "no-referrer",
  // Never cache preview content aggressively; the user edits frequently.
  "Cache-Control": "no-cache",
};

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/** Returns an error string when the path is unsafe, null when OK. */
function validatePreviewPath(segments: string[]): string | null {
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      return `Invalid path segment: "${seg}"`;
    }
    if (seg.includes("/") || seg.includes("\\")) {
      return `Invalid path segment: "${seg}"`;
    }
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; path?: string[] }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, path: pathSegments } = await params;
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  // Ownership enforced here: getProject returns null unless this user owns it.
  const project = await getProject(projectId, userId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.workspaceId) {
    return NextResponse.json({ error: "Workspace not provisioned" }, { status: 409 });
  }

  const segments = pathSegments ?? [];
  const pathError = validatePreviewPath(segments);
  if (pathError) {
    return NextResponse.json({ error: pathError }, { status: 400 });
  }

  // Directory or empty path → index.html (static-site convention).
  const filePath = segments.length === 0 ? "index.html" : segments.join("/");

  let terminalBase: string;
  try {
    terminalBase = requireTerminalBaseUrl();
  } catch {
    return NextResponse.json({ error: "Preview service unavailable" }, { status: 503 });
  }

  const { token } = createTerminalToken(userId, {
    workspaceId: project.workspaceId,
    projectId,
  });

  // Binary files (images, fonts) need base64 encoding to avoid corruption.
  // Text files use utf-8.
  const isBinary = !mimeFor(filePath).includes("charset=utf-8") && 
                   !mimeFor(filePath).startsWith("text/") &&
                   mimeFor(filePath) !== "application/json; charset=utf-8" &&
                   mimeFor(filePath) !== "image/svg+xml";

  let resp: Response;
  try {
    resp = await fetch(`${terminalBase}/ws-files/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,        "X-Workspace-Id": project.workspaceId,
      },
      body: JSON.stringify({ path: filePath, encoding: isBinary ? "base64" : "utf-8" }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return NextResponse.json({ error: "Preview service unavailable" }, { status: 503 });
  }

  if (!resp.ok) {
    const status = resp.status === 404 ? 404 : 502;
    const detail = await resp.text().catch(() => "");
    return NextResponse.json(
      { error: status === 404 ? "File not found" : "Preview service error", detail: detail.slice(0, 200) },
      { status },
    );
  }

  const data = (await resp.json().catch(() => null)) as { content?: string } | null;
  if (!data || typeof data.content !== "string") {
    return NextResponse.json({ error: "Invalid preview response" }, { status: 502 });
  }

  // Decode base64 for binary files, serve text directly for text files.
  const body = isBinary 
    ? new Uint8Array(Buffer.from(data.content, "base64"))
    : data.content;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": mimeFor(filePath),
      ...PREVIEW_SECURITY_HEADERS,
    },
  });
}
