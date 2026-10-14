import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { requireTerminalBaseUrl } from "@/lib/terminal-config";
import { prepareStaticPreviewDocument } from "@/lib/projects/static-preview-document";
import { createPreviewToken, verifyPreviewToken } from "@/lib/projects/preview-token";

/**
 * Static preview: serves HTML/CSS/JS/image files from a project's workspace
 * WITHOUT any terminal execution, dev server, or subprocess.
 *
 * Security model:
 * - Clerk auth required; project ownership enforced via getProject().
 * - Asset subrequests from the opaque-origin iframe cannot carry the
 *   session cookie, so the authenticated HTML response mints a short-lived
 *   capability token bound to (user, project, workspace) and embeds it in
 *   the asset URL path (`/t/<token>/...`). A request without a session is
 *   authorized only by such a token, and ownership + workspace binding are
 *   still enforced server-side on every request. Session-authenticated
 *   requests behave exactly as before; the token reading applies only when
 *   no session exists.
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
  //
  // NOTE: default-src uses EXPLICIT origins, never bare 'self'. The preview
  // iframe sandbox omits allow-same-origin, so the document gets an opaque
  // origin — and per the CSP spec, 'self' never matches any subresource URL
  // from an opaque origin, which would silently block relative assets
  // (style.css, app.js, images) and render multi-file sites unstyled/broken.
  // Scheme+host sources match on the subresource URL alone, so relative
  // assets load while third-party exfiltration stays blocked.
  // KEEP IN SYNC with next.config.ts /api/preview/:path* (config wins in prod).
  "Content-Security-Policy":
    "sandbox allow-scripts; " +
    "default-src https://www.litlabs.net https://litlabs.net https://*.up.railway.app http://localhost:* data: blob:; " +
    "style-src https://www.litlabs.net https://litlabs.net https://*.up.railway.app http://localhost:* 'unsafe-inline' data:; " +
    "script-src https://www.litlabs.net https://litlabs.net https://*.up.railway.app http://localhost:* 'unsafe-inline' data: blob:;",
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
  const { projectId, path: pathSegments } = await params;
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const segments = pathSegments ?? [];

  // Identity resolution. A session always wins and keeps its exact legacy
  // semantics (the segments are then a plain file path). Only a request
  // WITHOUT a session may present a capability token, in the path prefix
  // `t/<token>`; this is the shape subresource requests from the
  // opaque-origin preview iframe arrive in, because they cannot carry the
  // session cookie.
  let userId: string | null = null;
  let presentedToken: string | null = null;
  let tokenWorkspaceId: string | null = null;
  const { userId: sessionUserId } = await auth(_req);
  if (sessionUserId) {
    userId = sessionUserId;
  } else if (segments[0] === "t" && segments[1]) {
    try {
      const claims = verifyPreviewToken(segments[1]);
      if (claims.projectId !== projectId) {
        return NextResponse.json({ error: "Preview token is not scoped to this project" }, { status: 403 });
      }
      userId = claims.userId;
      presentedToken = segments[1];
      tokenWorkspaceId = claims.workspaceId;
    } catch {
      return NextResponse.json({ error: "Invalid or expired preview token" }, { status: 401 });
    }
  }
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ownership enforced here: getProject returns null unless this user owns it.
  const project = await getProject(projectId, userId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.workspaceId) {
    return NextResponse.json({ error: "Workspace not provisioned" }, { status: 409 });
  }
  if (tokenWorkspaceId !== null && tokenWorkspaceId !== project.workspaceId) {
    return NextResponse.json({ error: "Preview token is not scoped to this workspace" }, { status: 403 });
  }

  const fileSegments = presentedToken ? segments.slice(2) : segments;
  const pathError = validatePreviewPath(fileSegments);
  if (pathError) {
    return NextResponse.json({ error: pathError }, { status: 400 });
  }

  // Directory or empty path → index.html (static-site convention).
  const filePath = fileSegments.length === 0 ? "index.html" : fileSegments.join("/");

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
  let body = isBinary
    ? new Uint8Array(Buffer.from(data.content, "base64"))
    : data.content;

  if (typeof body === "string" && mimeFor(filePath).startsWith("text/html")) {
    // Scripts stay external (native execution semantics) and load through a
    // token-authorized URL prefix; stylesheets are embedded by the transform.
    // A document that itself arrived under a token re-uses that token; a
    // session-authenticated document gets a freshly minted one.
    const previewToken = presentedToken ?? createPreviewToken(userId, {
      projectId,
      workspaceId: project.workspaceId,
    }).token;
    const assetBase = `/api/preview/${encodeURIComponent(projectId)}/t/${previewToken}/`;
    body = await prepareStaticPreviewDocument(body, filePath, {
      assetBase,
      readStylesheet: async (path) => {
        const asset = await fetch(`${terminalBase}/ws-files/read`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}`, "X-Workspace-Id": project.workspaceId! },
          body: JSON.stringify({ path, encoding: "utf-8" }),
          signal: AbortSignal.timeout(15000),
        });
        if (!asset.ok) return null;
        const payload = await asset.json() as { content?: unknown };
        return typeof payload.content === "string" ? payload.content : null;
      },
    });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": mimeFor(filePath),
      ...PREVIEW_SECURITY_HEADERS,
      // Module scripts are fetched in CORS mode; from the opaque-origin
      // iframe the Origin is "null", so token-authorized asset responses
      // must opt into CORS explicitly. This is safe under the route's auth
      // model: authorization is the capability token (or the session),
      // never the origin, and no credential headers are ever echoed —
      // Access-Control-Allow-Credentials stays unset, so a cross-origin
      // page cannot read session-authenticated responses.
      ...(presentedToken ? { "Access-Control-Allow-Origin": "*" } : {}),
    },
  });
}
