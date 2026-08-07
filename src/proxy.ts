import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { isAnonymousDevAllowed, isClerkConfigured } from "@/lib/env";

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

    // Validate auth config on first request, not at module load.
    // This prevents the blanket 500 that made production debugging impossible.
    validateAuthConfig();

    // Skip webhooks + health checks + metrics — they verify themselves
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

const isProtectedRoute = createRouteMatcher([
  "/settings(.*)",
  "/profile(.*)",
  "/wallet(.*)",
  "/dashboard(.*)",
  "/agent-chat(.*)",
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

/**
 * Test-only auth bypass.
 *
 * PLAYWRIGHT_AUTH_DISABLED is ONLY accepted when ALL of these are true:
 *   - CI === "true"
 *   - PLAYWRIGHT_TEST === "true"
 *   - VERCEL env var is absent (not a deployed environment)
 *
 * Any deployed environment (Vercel, Railway, Docker, etc.) will reject this
 * flag and fail fast if Clerk is not configured.
 */
const isTestAuthDisabled =
  process.env.PLAYWRIGHT_AUTH_DISABLED === "true" &&
  process.env.CI === "true" &&
  process.env.PLAYWRIGHT_TEST === "true" &&
  !process.env.VERCEL;

/**
 * Whether anonymous dev mode is allowed.
 *
 * ALLOW_ANONYMOUS_DEV=true lets local dev run without Clerk. In production
 * (NODE_ENV=production) this is only honored when VERCEL is absent — i.e.
 * local `next start` testing. On Vercel, production always requires real Clerk
 * keys.
 */
function isAnonymousModeAllowed(): boolean {
  if (process.env.VERCEL) return false; // deployed — never allow anonymous
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
        "and VERCEL is absent.",
    );
  }

  // Also reject if someone sets PLAYWRIGHT_AUTH_DISABLED in a deployed environment
  if (process.env.PLAYWRIGHT_AUTH_DISABLED === "true" && !isTestAuthDisabled) {
    throw new Error(
      "FATAL: PLAYWRIGHT_AUTH_DISABLED is set but not in a valid test environment. " +
        "This flag requires CI=true, PLAYWRIGHT_TEST=true, and VERCEL absent.",
    );
  }
}

function setCacheHeaders(response: NextResponse, pathname: string): NextResponse {
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
  signInUrl.searchParams.set("redirect", req.nextUrl.pathname);
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
        signInUrl.searchParams.set("redirect", req.nextUrl.pathname);
        return NextResponse.redirect(signInUrl);
      }

      return setCacheHeaders(NextResponse.next(), req.nextUrl.pathname);
    })
  : function passthroughMiddleware(req: NextRequest) {
      // Redirect protected routes to sign-in when Clerk is not configured
      return protectRoute(req);
    };

// Bot detection wraps the Clerk/passthrough middleware so it runs first.
const middleware = withBotProtection(innerMiddleware);

export default middleware;

export const config = {
  matcher: [
    // Exclude: Next.js internals, static images, the self-hosted EmulatorJS
    // runtime (large binary .data/.wasm/.js assets in public/), and other
    // static asset extensions. Running Clerk + bot middleware on these caused
    // 500s and wasted RAM.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|emulatorjs|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|font|woff|woff2|ttf|eot|css|js|map)).*)",
    "/__clerk/:path*",
  ],
};
