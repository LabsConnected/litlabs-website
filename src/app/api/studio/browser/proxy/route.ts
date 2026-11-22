import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkBrowserUrlPolicy } from "@/lib/litt-intelligence/browser-url-policy";
import {
  buildProxyResponseHeaders,
  injectProxyBootstrap,
  isHtmlContentType,
} from "@/lib/studio/browser-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Studio Browser panel proxy — see src/lib/studio/browser-proxy.ts for
 * the full diagnosis and security model. In short: the panel frames
 * this route (same origin, so the app CSP's frame-src 'self' permits
 * it), this route fetches the target server-side, and the document is
 * re-served with framing-refusal headers stripped and a CSP sandbox
 * forcing an opaque origin.
 *
 * GET only. Every target passes the agent browser URL policy
 * (http/https only; no localhost, link-local, cloud-metadata, or
 * credential-phishing hosts). Redirects are followed by fetch; the
 * final URL is what the injected <base> and bootstrap use.
 */

const UPSTREAM_TIMEOUT_MS = 20_000;
/** HTML larger than this is passed through unrewritten rather than buffered forever. */
const MAX_HTML_REWRITE_BYTES = 5 * 1024 * 1024;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 LiTTStudioBrowser/1.0";

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rawTarget = new URL(req.url).searchParams.get("url")?.trim();
  if (!rawTarget) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const policy = checkBrowserUrlPolicy(rawTarget);
  if (!policy.allowed) {
    return NextResponse.json(
      { error: `This address can't be shown in the Studio browser: ${policy.reason ?? "blocked by policy"}` },
      { status: 403 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(rawTarget, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        "user-agent": BROWSER_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": req.headers.get("accept-language") ?? "en-US,en;q=0.9",
      },
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return NextResponse.json(
      { error: timedOut ? "The site took too long to respond." : "The site could not be reached." },
      { status: timedOut ? 504 : 502 },
    );
  }

  const headers = buildProxyResponseHeaders(upstream.headers);
  const contentType = upstream.headers.get("content-type");

  if (isHtmlContentType(contentType)) {
    const body = await upstream.arrayBuffer();
    if (body.byteLength <= MAX_HTML_REWRITE_BYTES) {
      const html = new TextDecoder("utf-8").decode(body);
      const rewritten = injectProxyBootstrap(html, upstream.url || rawTarget);
      headers.set("content-type", "text/html; charset=utf-8");
      return new NextResponse(rewritten, { status: upstream.status, headers });
    }
    return new NextResponse(body, { status: upstream.status, headers });
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
