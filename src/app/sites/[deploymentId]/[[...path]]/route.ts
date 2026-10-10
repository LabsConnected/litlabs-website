import { NextRequest, NextResponse } from "next/server";

import { readPublishedFile } from "@/lib/deployments/deployment-store";
import {
  deploymentPublicPath,
  isBinaryContentType,
} from "@/lib/deployments/user-deployment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /sites/[deploymentId]/[...path] — serve a deployed user project.
 *
 * This route is deliberately PUBLIC: it never calls auth(). That is what
 * makes a deployment a deployment. The preview proxy
 * (/api/studio-projects/[id]/preview/proxy) is the opposite — authenticated,
 * and pointed at a live dev process. A URL here is independently reachable
 * by anyone, which is why it can be HTTP-verified before a deployment is
 * reported live.
 *
 * Only `ready` deployments serve (enforced in readPublishedFile).
 *
 * Security — this serves USER-AUTHORED HTML from LiTT's own origin, so the
 * response is sandboxed:
 *
 *   Content-Security-Policy: sandbox allow-scripts
 *     Puts the document in an opaque origin. Without `allow-same-origin` it
 *     cannot read document.cookie, localStorage, or make credentialed
 *     same-origin requests to the app — so a deployed site cannot reach the
 *     session of whoever visits it.
 *   X-Content-Type-Options: nosniff
 *     The stored content type is authoritative; unknown extensions are never
 *     collected in the first place, and never served as HTML.
 *
 * Residual risk: same-origin hosting still shares the app's domain for
 * cookie *scoping* purposes. Moving deployments to a dedicated domain is the
 * stronger control and the recommended next hardening step; the sandbox
 * directive is what makes same-origin hosting safe enough for V1.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ deploymentId: string; path?: string[] }> },
) {
  const { deploymentId, path } = await params;

  if (!deploymentId || !/^[A-Za-z0-9_-]{1,64}$/.test(deploymentId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Resolve the request path against the artifact. Returns null for any
  // traversal attempt, including percent-encoded ones.
  const requestPath = Array.isArray(path) ? path.join("/") : "";
  const artifactPath = deploymentPublicPath(deploymentId, requestPath);
  if (!artifactPath) {
    return new NextResponse("Not found", { status: 404 });
  }

  let file: Awaited<ReturnType<typeof readPublishedFile>>;
  try {
    file = await readPublishedFile(deploymentId, artifactPath);
  } catch {
    // Never leak storage errors to a public visitor.
    return new NextResponse("Service unavailable", { status: 503 });
  }

  if (!file) {
    return new NextResponse("Not found", { status: 404 });
  }

  let content: string | Uint8Array<ArrayBuffer> = file.content;
  // Binary artifacts (images, fonts) are stored base64 — the files table
  // is text-shaped — so decode them back to raw bytes before serving.
  // The stored `encoding` column is authoritative; rows written before it
  // existed fall back to the content-type predicate.
  const binary =
    file.encoding != null
      ? file.encoding === "base64"
      : isBinaryContentType(file.contentType);
  if (binary) {
    content = new Uint8Array(Buffer.from(file.content, "base64"));
  }
  // LiTT form wiring: static exports render forms with an empty
  // `deploymentId` hidden input (the id doesn't exist until the deploy
  // is created). At serve time the id is known from the URL, so fill it
  // in for any page that carries a LiTT form — the form backend resolves
  // the site owner from this id. Without this, a published form can
  // never submit. The id was validated against a strict pattern above,
  // so it is safe to interpolate.
  if (
    file.contentType.includes("text/html") &&
    typeof content === "string" &&
    content.includes('data-litt-form="1"') &&
    content.includes('name="deploymentId" value=""')
  ) {
    content = content.replaceAll(
      'name="deploymentId" value=""',
      `name="deploymentId" value="${deploymentId}"`,
    );
  }

  // LiTT branding: inject a subtle, dismissible "Built with LiTT" badge
  // before </body> on HTML pages, unless the page opts out with
  // data-litt-badge="0". The badge is fixed-position, non-intrusive, and
  // never replaces the site owner's own branding.
  if (
    file.contentType.includes("text/html") &&
    typeof content === "string" &&
    !content.includes('data-litt-badge="0"') &&
    content.includes("</body>")
  ) {
    const badge = `<div id="litt-badge" style="position:fixed;bottom:12px;right:12px;z-index:2147483647;display:flex;align-items:center;gap:6px;background:rgba(10,10,18,0.85);border:1px solid rgba(139,92,246,0.4);border-radius:9999px;padding:4px 10px 4px 4px;font-family:system-ui,sans-serif;font-size:11px;color:#e4e4e7;backdrop-filter:blur(8px);box-shadow:0 2px 12px rgba(0,0,0,0.4)"><img src="/brand/litt-robot-32.png" alt="LiTT" width="20" height="20" style="border-radius:50%"/><a href="https://www.litlabs.net" target="_blank" rel="noopener" style="color:#e4e4e7;text-decoration:none">Built with LiTT</a><button onclick="this.parentElement.remove()" aria-label="Dismiss" style="background:none;border:none;color:#a1a1aa;cursor:pointer;font-size:14px;line-height:1;padding:0 2px">×</button></div>`;
    content = content.replace("</body>", `${badge}</body>`);
  }

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "X-Content-Type-Options": "nosniff",
      // Opaque origin: no access to the app's cookies or storage.
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups",
      "Referrer-Policy": "no-referrer",
      // A deployment snapshot is immutable, but keep the window short so a
      // redeploy to a new id is never served from a stale intermediary.
      "Cache-Control": "public, max-age=60",
    },
  });
}
