import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, NextRequest } from "next/server";
import { isAnonymousDevAllowed, isClerkConfigured, isDeployed } from "@/lib/env";

// ─── Bot detection ────────────────────────────────────────────────
// Merged from the former src/middleware.ts. Next.js 16 forbids having
// both middleware.ts and proxy.ts, and Clerk 6.39+ now detects proxy.ts
// on Next 16, so the bot-protection logic lives here alongside Clerk.
//
// This runs BEFORE Clerk auth. It blocks:
//   - Requests with no User-Agent (bots almost never send one)
//   - Known malicious bot signatures (scrapers, crawlers, attack tools)
//   - Requests with suspicious header patterns
//
// It does NOT block:
//   - Legitimate crawlers (Googlebot, Bingbot) — they're allowed for SEO
//   - Webhook calls from Stripe, Clerk, GitHub (verified by signature in handlers)
//   - API calls from authenticated users
//   - Health check probes (Vercel, UptimeRobot) and the /metrics scrape

/** User-Agent patterns that are always blocked. */
const BLOCKED_BOT_PATTERNS: readonly RegExp[] = [
  // Attack/scanning tools
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /dirbuster/i,
  /wpscan/i,
  /hydra/i,
  /burpcollaborator/i,
  /acunetix/i,
  /nessus/i,
  /zap/i,
  /fiddler/i,
  // Aggressive scrapers (not search engines)
  /scrapy/i,
  /mechanize/i,
  /python-requests/i,
  /python-urllib/i,
  /curl\/[0-9]/i,
  /wget\/[0-9]/i,
  /httpclient/i,
  /httpx\/[0-9]/i,
  /go-http-client/i,
  /java\/[0-9]/i,
  /okhttp\/[0-9]/i,
  /node-fetch/i,
  /axios\/[0-9]/i,
  /got\/[0-9]/i,
  /aiohttp/i,
  /perl/i,
  /libwww/i,
  /lwp-/i,
  // Known spam bots
  /semrush/i,
  /ahrefsbot/i,
  /dotbot/i,
  /blexbot/i,
  /bombora/i,
  /petalbot/i,
  /yandexbot/i, // Yandex is rarely needed for EU/US-focused sites
];

/** User-Agent patterns that are always allowed (legitimate crawlers). */
const ALLOWED_CRAWLER_PATTERNS: readonly RegExp[] = [
  /googlebot/i,
  /bingbot/i,
  /duckduckbot/i,
  /slurp/i, // Yahoo
  /baiduspider/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /discordbot/i,
  /telegrambot/i,
  /whatsapp/i,
  /applebot/i,
];

/** Paths that skip bot detection (webhooks verify signatures themselves). */
const WEBHOOK_PATHS: readonly string[] = [
  "/api/webhook/clerk",
  "/api/webhooks/meta-developer",
  "/api/github/webhook",
  "/api/gitlab/webhook",
  "/api/webhook/agent-action",
  "/api/stripe/webhook",
  "/api/vapi/tools",
  "/api/vapi/events",
  "/api/vapi/turn",
];

/** Paths that skip bot detection (health checks + metrics scrape). */
const HEALTH_PATHS: readonly string[] = [
  "/api/health",
  "/api/llm/health",
  "/api/voice/health",
  "/api/system-health",
  "/metrics",
];

function isAllowedCrawler(ua: string): boolean {
  return ALLOWED_CRAWLER_PATTERNS.some((p) => p.test(ua));
}

function isBlockedBot(ua: string): boolean {
  return BLOCKED_BOT_PATTERNS.some((p) => p.test(ua));
}

function isWebhookPath(pathname: string): boolean {
  return WEBHOOK_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isHealthPath(pathname: string): boolean {
  return HEALTH_PATHS.some((p) => pathname === p);
}

/**
 * Runs bot detection before delegating to the inner middleware. Returns a
 * 403/400 response for blocked requests, otherwise calls `inner(...args)` to
 * continue with Clerk auth + route protection.
 *
 * The inner function is typed loosely so it can accept whatever signature
 * Clerk's `NextMiddleware` expects (e.g. `(req, event)`).
 */
function withBotProtection(inner: (...args: never[]) => unknown) {
  return async function botProtected(
    req: NextRequest,
    ...rest: unknown[]
  ): Promise<NextResponse> {
    const { pathname } = req.nextUrl;

    // Skip webhooks + health checks + metrics — they verify themselves.
    // This check MUST come before validateAuthConfig() so that health probes
    // (Railway/Vercel healthcheck at /api/health) succeed even when Clerk env
    // vars are not yet configured. Without this ordering, the middleware throws
    // on every request including /api/health, causing a blanket 500 that makes
    // the deployment fail healthcheck and blocks all debugging.
    if (isWebhookPath(pathname) || isHealthPath(pathname)) {
      return (inner(req as never, ...rest as never[]) as Promise<NextResponse>) ??
        NextResponse.next();
    }

    const userAgent = req.headers.get("user-agent") ?? "";

    // Block requests with no User-Agent (legitimate browsers always send one)
    if (!userAgent.trim()) {
      return new NextResponse(
        JSON.stringify({ error: "User-Agent header required" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Allow legitimate crawlers (for SEO)
    if (isAllowedCrawler(userAgent)) {
      return (inner(req as never, ...rest as never[]) as Promise<NextResponse>) ??
        NextResponse.next();
    }

    // Validate auth config only for protected routes, on first request
    // (not at module load). Public routes (landing page, pricing, etc.) must
    // render even when Clerk env vars are not yet configured. Without this
    // guard, the middleware throws on every request including public pages,
    // causing a blanket 500 that blocks the entire site.
    if (isProtectedRoute(req)) {
      validateAuthConfig();
    }

    // Block known malicious bots
    if (isBlockedBot(userAgent)) {
      return new NextResponse(
        JSON.stringify({ error: "Access denied" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Block requests with suspiciously long User-Agents (buffer overflow attempts)
    if (userAgent.length > 512) {
      return new NextResponse(
        JSON.stringify({ error: "Invalid request" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return (inner(req as never, ...rest as never[]) as Promise<NextResponse>) ??
      NextResponse.next();
  };
}

// ─── Clerk auth + route protection ────────────────────────────────
//
// ONE SOURCE OF TRUTH for public vs protected routes.
//
// Public page routes (explicitly NOT in the protected list):
//   /              — landing page
//   /pricing       — public pricing
//   /docs          — public documentation
//   /about         — public about
//   /privacy       — public privacy policy
//   /terms         — public terms of service
//   /cookies       — public cookie policy
//   /sign-in/*     — Clerk sign-in (catch-all)
//   /sign-up/*     — Clerk sign-up (catch-all)
//   /login         — legacy redirect → /sign-in
//   /gallery/*     — public gallery viewing
//   /games/*       — public games
//   /hire          — public hiring page
//   /resources/*   — public resources
//   /discover      — public discover
//   /showcase/*    — public showcase
//   /marketplace/* — public marketplace browsing (install/checkout are protected APIs)
//   /voice         — public voice playground
//   /social        — public social feed
//   /generate      — public generate page
//   /creator       — public creator page
//   /chat          — public chat
//   /agent         — public agent info
//   /builder       — public builder
//   /ai-builder    — public AI builder
//
// Protected page routes (require authentication):
//   /dashboard, /studio/*, /projects, /wallet,
//   /deployments, /settings/*, /profile/*, /admin/*, /owner,
//   /library/*, /memories, /flow, /code, /agent-chat,
//   /ai-builder, /builder, /chat, /generate,
//   /litt, /litt-terminal, /runtime-test, /order/*

const isProtectedRoute = createRouteMatcher([
  // Protected page routes
  "/studio(.*)",
  "/dashboard(.*)",
  "/projects(.*)",
  "/wallet(.*)",
  "/deployments(.*)",
  "/settings(.*)",
  "/profile(.*)",
  "/admin(.*)",
  "/owner(.*)",
  "/library(.*)",
  "/memories(.*)",
  "/flow(.*)",
  "/code(.*)",
  "/agent-chat(.*)",
  "/ai-builder(.*)",
  "/builder(.*)",
  "/chat(.*)",
  "/generate(.*)",
  "/litt(.*)",
  "/litt-terminal(.*)",
  "/runtime-test(.*)",
  "/order(.*)",
  // Protected API routes
  "/api/user-agents(.*)",
  "/api/conversations(.*)",
  "/api/settings/(.*)",
  "/api/wallet(.*)",
  "/api/users/(.*)",
  "/api/account",
  "/api/orchestrate",
  "/api/marketplace/agents/(.*)/install(.*)",
  "/api/marketplace/agents/(.*)/checkout(.*)",
  "/api/marketplace/installations(.*)",
]);

const clerkConfigured = isClerkConfigured();
const clerkAuthorizedParties = (process.env.CLERK_AUTHORIZED_PARTIES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

/**
 * Test-only auth bypass.
 *
 * PLAYWRIGHT_AUTH_DISABLED is ONLY accepted when ALL of these are true:
 *   - CI === "true"
 *   - PLAYWRIGHT_TEST === "true"
 *   - Not in a deployed environment (VERCEL / RAILWAY_ENVIRONMENT absent)
 *
 * Any deployed environment (Vercel, Railway, Docker, etc.) will reject this
 * flag and fail fast if Clerk is not configured.
 */
const isTestAuthDisabled =
  process.env.PLAYWRIGHT_AUTH_DISABLED === "true" &&
  process.env.CI === "true" &&
  process.env.PLAYWRIGHT_TEST === "true" &&
  !isDeployed();

/**
 * Whether anonymous dev mode is allowed.
 *
 * ALLOW_ANONYMOUS_DEV=true lets local dev run without Clerk. In production
 * (NODE_ENV=production) this is only honored when not deployed — i.e.
 * local `next start` testing. On Railway/Vercel, production always requires
 * real Clerk keys.
 */
function isAnonymousModeAllowed(): boolean {
  if (isDeployed()) return false; // deployed — never allow anonymous
  return isAnonymousDevAllowed() || process.env.ALLOW_ANONYMOUS_DEV === "true";
}

/**
 * Validate auth configuration. Called inside the request handler (not at module
 * load) so the middleware module always loads successfully. A misconfigured
 * deployed environment will still fail closed — but on the first request, not
 * at import time, which prevents the blanket 500 that made debugging impossible.
 */
function validateAuthConfig(): void {
  if (!clerkConfigured && !isTestAuthDisabled && !isAnonymousModeAllowed()) {
    throw new Error(
      "FATAL: Clerk is not configured. " +
        "Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY, " +
        "or set ALLOW_ANONYMOUS_DEV=true for local development. " +
        "PLAYWRIGHT_AUTH_DISABLED is only valid when CI=true, PLAYWRIGHT_TEST=true, " +
        "and not in a deployed environment.",
    );
  }

  // Also reject if someone sets PLAYWRIGHT_AUTH_DISABLED in a deployed environment
  if (process.env.PLAYWRIGHT_AUTH_DISABLED === "true" && !isTestAuthDisabled) {
    throw new Error(
      "FATAL: PLAYWRIGHT_AUTH_DISABLED is set but not in a valid test environment. " +
        "This flag requires CI=true, PLAYWRIGHT_TEST=true, and not deployed.",
    );
  }
}

function setCacheHeaders(response: NextResponse, pathname: string): NextResponse {
  if (pathname === "/") {
    response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  }

  if (["/docs", "/pricing"].includes(pathname)) {
    response.headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=3600");
  }

  if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) {
    response.headers.set("Cache-Control", "no-store, must-revalidate");
  }

  response.headers.set("Vary", "Accept-Encoding");
  return response;
}

function protectRoute(req: NextRequest): NextResponse {
  if (!isProtectedRoute(req)) {
    return setCacheHeaders(NextResponse.next(), req.nextUrl.pathname);
  }

  // API routes should return JSON 401, not redirect to sign-in.
  // Page routes redirect to sign-in with the intended destination preserved.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const signInUrl = new URL("/sign-in", req.url);
  signInUrl.searchParams.set("redirect_url", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(signInUrl);
}

const useClerkMiddleware = clerkConfigured && !isTestAuthDisabled;
const innerMiddleware = useClerkMiddleware
  ? clerkMiddleware(async (auth, req) => {
      let userId: string | null = null;
      try {
        const authResult = await auth();
        userId = authResult.userId;
      } catch {
        // Clerk unreachable — allow request through, API will 401
      }

      if (isProtectedRoute(req) && !userId) {
        // API routes should return JSON 401, not redirect to sign-in.
        // Page routes redirect to sign-in with the intended destination preserved.
        if (req.nextUrl.pathname.startsWith("/api/")) {
          return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 },
          );
        }
        const signInUrl = new URL("/sign-in", req.url);
        signInUrl.searchParams.set("redirect_url", req.nextUrl.pathname + req.nextUrl.search);
        return NextResponse.redirect(signInUrl);
      }

      return setCacheHeaders(NextResponse.next(), req.nextUrl.pathname);
    },
    {
      // Clerk Frontend API proxy — the supported replacement for the old
      // manual Next.js rewrite to clerk.litlabs.net (which was broken with
      // Cloudflare error 1000). This intercepts /__clerk/* in middleware,
      // forwards to frontend-api.clerk.dev with the required headers
      // (Clerk-Proxy-Url, Clerk-Secret-Key, X-Forwarded-For), and
      // auto-derives the server-side proxyUrl for the auth handshake.
      // The browser side uses NEXT_PUBLIC_CLERK_PROXY_URL (ClerkProvider).
      frontendApiProxy: { enabled: true },
      ...(clerkAuthorizedParties.length > 0
        ? { authorizedParties: clerkAuthorizedParties }
        : {}),
    },
  )
  : function passthroughMiddleware(req: NextRequest) {
      // When test auth is disabled (Playwright CI), allow all routes through
      // so E2E tests can access protected pages without authentication.
      if (isTestAuthDisabled) {
        return setCacheHeaders(NextResponse.next(), req.nextUrl.pathname);
      }
      // Redirect protected routes to sign-in when Clerk is not configured
      return protectRoute(req);
    };

// ─── Dev proxy header fix ──────────────────────────────────────────
//
// In local development, a tunnel/proxy (e.g. stitch-mcp, cloudflared) may
// forward browser requests to the Next.js dev server at localhost:3001 while
// the browser's Origin header reflects the proxy's local address
// (e.g. http://127.0.0.1:21151).  The proxy sets `x-forwarded-host` to the
// *destination* host (localhost:3001) instead of the *original* host, so
// Next.js's Server Action CSRF check rejects the request with
// "Invalid Server Actions request" because Origin ≠ X-Forwarded-Host.
//
// This dev-only fix corrects the `x-forwarded-host` header to match the
// browser's Origin for local/trusted origins only.  It does NOT run in
// production (deployed environments) and only affects Server Action POSTs
// from localhost / private-IP origins — it does not disable the CSRF check,
// it makes the proxy headers consistent so the existing CSRF check passes.
//
// The proper long-term fix is to configure the proxy to set
// X-Forwarded-Host to the original request host, not the destination.

/** Local/trusted origin hosts that may need proxy header correction in dev. */
const LOCAL_ORIGIN_PATTERNS: readonly RegExp[] = [
  /^localhost(:\d+)?$/i,
  /^127\.0\.0\.1(:\d+)?$/,
  /^::1(:\d+)?$/,
  /^\[::1\](:\d+)?$/,
  /^192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
];

function isLocalOriginHost(host: string): boolean {
  return LOCAL_ORIGIN_PATTERNS.some((p) => p.test(host));
}

/**
 * Dev-only: if a Server Action POST has a local Origin that doesn't match
 * x-forwarded-host, rewrite x-forwarded-host to match the Origin so the
 * Next.js CSRF check passes.  Returns a modified NextResponse or undefined
 * to continue with the normal middleware chain.
 */
function fixDevProxyHeaders(req: NextRequest): NextResponse | undefined {
  // Never run in production / deployed environments.
  if (isDeployed()) return undefined;

  // Only relevant for Server Action POSTs (Next-Action header present).
  const nextActionHeader = req.headers.get("next-action");
  if (!nextActionHeader) return undefined;

  const originHeader = req.headers.get("origin");
  if (!originHeader) return undefined;

  let originHost: string;
  try {
    originHost = new URL(originHeader).host;
  } catch {
    return undefined;
  }

  if (!isLocalOriginHost(originHost)) return undefined;

  const forwardedHost = req.headers.get("x-forwarded-host");
  const hostHeader = req.headers.get("host");

  // If x-forwarded-host already matches the origin, no fix needed.
  if (forwardedHost === originHost) return undefined;
  // If host header already matches the origin, no fix needed.
  if (!forwardedHost && hostHeader === originHost) return undefined;

  // Rewrite x-forwarded-host to match the browser's Origin so the
  // Server Action CSRF origin/host validation passes.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-forwarded-host", originHost);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

/**
 * Clerk proxy host normalization.
 *
 * The Clerk Frontend API proxy is registered for the apex domain `litlabs.net`
 * in the Clerk Dashboard (proxy_url = https://litlabs.net/__clerk). However,
 * the production app is served at `www.litlabs.net` (Cloudflare redirects
 * apex → www). The `frontendApiProxy` middleware derives `Clerk-Proxy-Url`
 * from the request's `x-forwarded-host`, so when the browser is at
 * `www.litlabs.net` it sends `Clerk-Proxy-Url: https://www.litlabs.net/__clerk`,
 * which Clerk rejects ("Proxy url is invalid. Cannot be on a different domain").
 *
 * This fix rewrites `x-forwarded-host` to `litlabs.net` for `/__clerk` requests
 * in production so the `Clerk-Proxy-Url` header matches the registered domain.
 * It only runs for the proxy path and only in deployed environments.
 */
const CLERK_PROXY_HOST = "litlabs.net";

function fixClerkProxyHost(req: NextRequest): NextRequest {
  if (!isDeployed()) return req;
  if (!req.nextUrl.pathname.startsWith("/__clerk")) return req;
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost === CLERK_PROXY_HOST) return req;
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-forwarded-host", CLERK_PROXY_HOST);
  // Return a new NextRequest with modified headers so downstream middleware
  // (clerkMiddleware's frontendApiProxy) sees the corrected x-forwarded-host.
  return new NextRequest(req, { headers: requestHeaders });
}

// Dev proxy header fix wraps the bot detection so it runs first.
// Bot detection wraps the Clerk/passthrough middleware so it runs next.
const middleware = (req: NextRequest, ...rest: never[]): Promise<NextResponse> => {
  // Temporary debug: check env var access in middleware runtime
  if (req.nextUrl.pathname === "/__clerk/_env") {
    return Promise.resolve(NextResponse.json({
      CLERK_FAPI_URL: process.env.CLERK_FAPI_URL || "(not set)",
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ? "(set)" : "(not set)",
      NODE_ENV: process.env.NODE_ENV,
    }));
  }
  const fixed = fixDevProxyHeaders(req);
  if (fixed) return Promise.resolve(fixed);
  const clerkReq = fixClerkProxyHost(req);
  return withBotProtection(innerMiddleware)(clerkReq, ...rest as never[]);
};

export default middleware;

export const config = {
  matcher: [
    // Exclude: Next.js internals, static images, the self-hosted EmulatorJS
    // runtime (large binary .data/.wasm/.js assets in public/), and other
    // static asset extensions. Running Clerk + bot middleware on these caused
    // 500s and wasted RAM.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|emulatorjs|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|font|woff|woff2|ttf|eot|css|js|map)).*)",
    // Clerk Frontend API proxy path — handled by frontendApiProxy in
    // clerkMiddleware(). Must be in the matcher so the middleware intercepts
    // these requests before they hit a route handler.
    "/__clerk/(.*)",
  ],
};
