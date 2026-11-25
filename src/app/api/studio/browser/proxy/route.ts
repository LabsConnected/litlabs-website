import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkBrowserUrlPolicy } from "@/lib/litt-intelligence/browser-url-policy";
import {
  buildProxyErrorPage,
  buildProxyResponseHeaders,
  injectProxyBootstrap,
  isHtmlContentType,
  PROXIED_DOCUMENT_CSP,
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
 * GET only. Every target — the requested URL AND every redirect hop —
 * passes the agent browser URL policy (http/https only; no localhost,
 * link-local, cloud-metadata, phishing, or deceptive-subdomain
 * hosts). Redirects are followed manually so each hop is re-checked:
 * an allowed page cannot bounce the proxy into a blocked address.
 * Errors are served as a Studio-styled HTML document, not raw JSON,
 * so the panel frame always shows a readable state.
 */

const UPSTREAM_TIMEOUT_MS = 20_000;
/** HTML larger than this is passed through unrewritten rather than buffered forever. */
const MAX_HTML_REWRITE_BYTES = 5 * 1024 * 1024;
/** Redirect hops followed per request before giving up. */
const MAX_REDIRECT_HOPS = 5;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 LiTTStudioBrowser/1.0";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function errorPage(
  status: number,
  title: string,
  message: string,
  url?: string | null,
  hint?: string,
): NextResponse {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": PROXIED_DOCUMENT_CSP,
    "cache-control": "no-store",
  });
  return new NextResponse(buildProxyErrorPage({ title, message, url, hint }), {
    status,
    headers,
  });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return errorPage(
      401,
      "Sign in required",
      "Your LiTT session is not active, so the Studio browser can't load pages. Sign in again and retry.",
    );
  }

  const rawTarget = new URL(req.url).searchParams.get("url")?.trim();
  if (!rawTarget) {
    return errorPage(400, "Missing address", "No web address was provided to the Studio browser.");
  }

  // Follow redirects manually so EVERY hop passes the URL policy —
  // fetch's built-in redirect:"follow" would let an allowed page
  // bounce the proxy into localhost, a metadata endpoint, or a
  // phishing host without re-checking.
  let currentUrl = rawTarget;
  let upstream: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const policy = checkBrowserUrlPolicy(currentUrl);
    if (!policy.allowed) {
      return errorPage(
        403,
        "This address can't be shown",
        `Blocked by the Studio browser's security policy: ${policy.reason ?? "not allowed"}.`,
        currentUrl,
        "If you believe this is a mistake, open the address in a regular browser instead.",
      );
    }

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: {
          "user-agent": BROWSER_USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "accept-language": req.headers.get("accept-language") ?? "en-US,en;q=0.9",
        },
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return errorPage(
        timedOut ? 504 : 502,
        timedOut ? "The site took too long to respond" : "The site could not be reached",
        timedOut
          ? "The site didn't answer within the Studio browser's time limit."
          : "The Studio browser couldn't connect to this address. The site may be down or blocking automated access.",
        currentUrl,
      );
    }

    const location = res.headers.get("location");
    if (REDIRECT_STATUSES.has(res.status) && location) {
      // Drop the redirect body before the next hop — otherwise each
      // hop keeps downloading a page we will never show and holds
      // its connection open until completion or timeout.
      try {
        await res.body?.cancel();
      } catch {
        // Body already consumed or locked — nothing to release.
      }
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return errorPage(
          502,
          "The site sent an invalid redirect",
          "The site responded with a redirect the Studio browser couldn't understand.",
          currentUrl,
        );
      }
      continue;
    }

    upstream = res;
    break;
  }

  if (!upstream) {
    return errorPage(
      508,
      "Too many redirects",
      `The site kept redirecting (more than ${MAX_REDIRECT_HOPS} hops), so the Studio browser stopped following it.`,
      currentUrl,
    );
  }

  const headers = buildProxyResponseHeaders(upstream.headers);
  const contentType = upstream.headers.get("content-type");

  if (isHtmlContentType(contentType)) {
    const body = await upstream.arrayBuffer();
    if (body.byteLength <= MAX_HTML_REWRITE_BYTES) {
      const html = new TextDecoder("utf-8").decode(body);
      // Pass our own origin so the injected bootstrap navigates the
      // frame to an ABSOLUTE proxy URL — the document's injected
      // <base href="<target URL>"> would otherwise resolve the
      // root-relative proxy path against the target origin.
      const rewritten = injectProxyBootstrap(
        html,
        upstream.url || currentUrl,
        new URL(req.url).origin,
      );
      headers.set("content-type", "text/html; charset=utf-8");
      return new NextResponse(rewritten, { status: upstream.status, headers });
    }
    return new NextResponse(body, { status: upstream.status, headers });
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
