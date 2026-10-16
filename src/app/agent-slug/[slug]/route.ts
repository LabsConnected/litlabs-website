import { redirect } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";
import { isKnownAgentSlug } from "@/lib/agent-slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "x-robots-tag": "noindex, nofollow",
  "cache-control": "no-store",
};

/**
 * Same card as src/app/not-found.tsx, used when the server cannot read
 * the framework 404 document. Kept as markup so this route does not import
 * react-dom/server (forbidden in route handlers).
 */
const NOT_FOUND_FALLBACK = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>404 — Page Not Found | LiTTree LabStudios</title>
<meta name="robots" content="noindex, nofollow"/>
</head>
<body style="margin:0;background:#0f0f14;color:#e2e8f0">
<div class="min-h-dvh flex items-center justify-center px-4 pt-16" style="background-color:#0f0f14;color:#e2e8f0">
  <div class="max-w-md w-full rounded-xl p-8" style="border:1px solid #2a2a3a;background-color:#1a1a24">
    <div class="text-center mb-6">
      <h1 class="text-3xl font-bold tracking-tight mb-2" style="color:#e2e8f0">404</h1>
      <p class="text-xs opacity-60">Page Not Found</p>
    </div>
    <p class="text-xs text-center mb-6 opacity-60 leading-relaxed">The page you're looking for doesn't exist or has been moved.</p>
    <div class="flex gap-3 justify-center">
      <a href="/">← Back to Home</a>
      <a href="/marketplace">Marketplace →</a>
    </div>
  </div>
</div>
</body>
</html>`;

/**
 * Production traffic for /agents/[slug] is rewritten here.
 *
 * notFound() inside the app layout cannot set a real HTTP status: the root
 * loading boundary and the force-dynamic (app) layout stream a 200 shell
 * first. This handler runs outside that tree. Known slugs still redirect
 * to Studio. Unknown slugs return the framework 404 document.
 */
async function frameworkNotFound(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL("/__hidden-public-test-page", req.url);
    const upstream = await fetch(url, {
      headers: {
        "user-agent": req.headers.get("user-agent") || "Mozilla/5.0",
        accept: "text/html",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    const html = await upstream.text();
    if (html.includes("Page Not Found")) {
      return new NextResponse(html, { status: 404, headers: NOT_FOUND_HEADERS });
    }
  } catch {
    // The in-process copy below still answers 404.
  }
  return new NextResponse(NOT_FOUND_FALLBACK, { status: 404, headers: NOT_FOUND_HEADERS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!isKnownAgentSlug(slug)) return frameworkNotFound(req);
  redirect("/studio?tool=workflows");
}
