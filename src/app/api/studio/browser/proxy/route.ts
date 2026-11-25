import { NextRequest, NextResponse } from "next/server";
import { fetch as undiciFetch, type Dispatcher } from "undici";
import { auth } from "@/lib/auth";
import { checkBrowserUrlPolicy } from "@/lib/litt-intelligence/browser-url-policy";
import {
  DestinationBlockedError,
  pinnedDispatcherFor,
} from "@/lib/studio/proxy-destination";
import { rateLimit } from "@/lib/rate-limiter";
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
 * passes three independent gates before a single byte is fetched:
 *   1. checkBrowserUrlPolicy: http/https only; no localhost,
 *      link-local, cloud-metadata, phishing, or deceptive-subdomain
 *      hosts, and no non-public IP literals;
 *   2. resolvePublicAddresses: the hostname's DNS answers are ALL
 *      validated as public unicast — one private answer fails the
 *      destination closed;
 *   3. pinnedDispatcherFor: the connection is pinned to those validated
 *      addresses, so DNS rebinding between validation and connect is
 *      impossible.
 * Redirects are followed manually so each hop re-passes all three
 * gates: an allowed page cannot bounce the proxy into a blocked
 * address. Errors are served as a Studio-styled HTML document, not
 * raw JSON, so the panel frame always shows a readable state.
 */

const UPSTREAM_TIMEOUT_MS = 20_000;
/** HTML larger than this is passed through unrewritten rather than buffered forever. */
const MAX_HTML_REWRITE_BYTES = 5 * 1024 * 1024;
/** Hard cap on any single proxied response body. */
const MAX_PROXY_RESPONSE_BYTES = 32 * 1024 * 1024;
/** Redirect hops followed per request before giving up. */
const MAX_REDIRECT_HOPS = 5;
/** Per-user proxy request budget (page navigations + link clicks). */
const RATE_LIMIT = 120;
const RATE_LIMIT_WINDOW_SEC = 60;

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

class ResponseTooLargeError extends Error {}

/** Read a response body fully, refusing beyond `cap` bytes. */
async function readBodyWithLimit(res: Response, cap: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) throw new ResponseTooLargeError();
  const body = res.body;
  if (!body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > cap) throw new ResponseTooLargeError();
    return new Uint8Array(buf);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => {});
        throw new ResponseTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Stream a response body while enforcing `cap`: once the running
 * total exceeds it the upstream is cancelled and the stream errors,
 * so a lying/missing content-length cannot smuggle an unbounded
 * download through the proxy.
 */
function sizeLimitedStream(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
): ReadableStream<Uint8Array> {
  if (!body) return new ReadableStream({ start: (c) => c.close() });
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        total += value.byteLength;
        if (total > cap) {
          await reader.cancel().catch(() => {});
          controller.error(new ResponseTooLargeError("response exceeded size cap"));
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
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

  // Every proxied request costs an upstream fetch — bound the per-user
  // rate so the panel can't be used as an open fetch amplifier.
  const rl = await rateLimit(req, RATE_LIMIT, RATE_LIMIT_WINDOW_SEC);
  if (!rl.success) {
    return errorPage(
      429,
      "Too many requests",
      `The Studio browser is limited to ${RATE_LIMIT} page loads per minute. Wait a moment and try again.`,
    );
  }

  const rawTarget = new URL(req.url).searchParams.get("url")?.trim();
  if (!rawTarget) {
    return errorPage(400, "Missing address", "No web address was provided to the Studio browser.");
  }

  // Follow redirects manually so EVERY hop passes all three gates —
  // fetch's built-in redirect:"follow" would let an allowed page
  // bounce the proxy into localhost, a metadata endpoint, a private
  // IP, or a phishing host without re-checking.
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

    // DNS gate: resolve the host and prove EVERY answer is public
    // unicast, then pin the connection to those answers. IP literals
    // skip this — the policy's literal-IP classification already
    // covered them.
    let dispatcher: Dispatcher | undefined;
    try {
      dispatcher = await pinnedDispatcherFor(new URL(currentUrl).hostname);
    } catch (err) {
      if (err instanceof DestinationBlockedError) {
        return errorPage(
          403,
          "This address can't be shown",
          `Blocked by the Studio browser's network policy: ${err.message}.`,
          currentUrl,
          "If you believe this is a mistake, open the address in a regular browser instead.",
        );
      }
      return errorPage(
        502,
        "The site's address could not be verified",
        "The Studio browser couldn't confirm this address points to a public website, so it refused to connect.",
        currentUrl,
      );
    }

    let res: Response;
    try {
      // undici's own fetch is required when passing a dispatcher —
      // Node's bundled global fetch rejects foreign-version dispatchers.
      res = (await undiciFetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: {
          "user-agent": BROWSER_USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "accept-language": req.headers.get("accept-language") ?? "en-US,en;q=0.9",
        },
        ...(dispatcher ? { dispatcher } : {}),
      } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
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

  // Up-front size gate on the declared length; the streaming guard
  // below covers chunked/undeclared bodies.
  const declaredLength = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROXY_RESPONSE_BYTES) {
    try {
      await upstream.body?.cancel();
    } catch {
      /* ignore */
    }
    return errorPage(
      502,
      "The page is too large to proxy",
      "This response is larger than the Studio browser's 32 MB limit, so it wasn't loaded.",
      currentUrl,
      "Try opening the address in a regular browser instead.",
    );
  }

  if (isHtmlContentType(contentType)) {
    let body: Uint8Array;
    try {
      body = await readBodyWithLimit(upstream, MAX_PROXY_RESPONSE_BYTES);
    } catch (err) {
      if (err instanceof ResponseTooLargeError) {
        return errorPage(
          502,
          "The page is too large to proxy",
          "This response exceeded the Studio browser's 32 MB limit, so it wasn't loaded.",
          currentUrl,
          "Try opening the address in a regular browser instead.",
        );
      }
      throw err;
    }
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
    return new NextResponse(new Blob([new Uint8Array(body)]), {
      status: upstream.status,
      headers,
    });
  }

  return new NextResponse(sizeLimitedStream(upstream.body, MAX_PROXY_RESPONSE_BYTES), {
    status: upstream.status,
    headers,
  });
}
