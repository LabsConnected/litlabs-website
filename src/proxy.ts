import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { isAnonymousDevAllowed, isClerkConfigured } from "@/lib/env";

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

// In production or any deployed environment, Clerk MUST be configured.
// The test bypass is valid in local CI/test environments.
// ALLOW_ANONYMOUS_DEV=true in non-production lets local dev run without Clerk
// (matches the behavior of auth() in src/lib/auth.ts).
if (!clerkConfigured && !isTestAuthDisabled && !isAnonymousDevAllowed()) {
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

const useClerkMiddleware = clerkConfigured && !isTestAuthDisabled;
const middleware = useClerkMiddleware
  ? clerkMiddleware(async (auth, req) => {
      let userId: string | null = null;
      try {
        const authResult = await auth();
        userId = authResult.userId;
      } catch {
        // Clerk unreachable — allow request through, API will 401
      }

      const response = NextResponse.next();

      if (["/about", "/contact", "/docs", "/pricing"].includes(req.nextUrl.pathname)) {
        response.headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=3600");
      }

      if (req.nextUrl.pathname.startsWith("/login") || req.nextUrl.pathname.startsWith("/signup")) {
        response.headers.set("Cache-Control", "no-store, must-revalidate");
      }

      response.headers.set("Vary", "Accept-Encoding");

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

      return response;
    })
  : function passthroughMiddleware(req: NextRequest) {
      const response = NextResponse.next();

      if (["/about", "/contact", "/docs", "/pricing"].includes(req.nextUrl.pathname)) {
        response.headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=3600");
      }

      if (req.nextUrl.pathname.startsWith("/login") || req.nextUrl.pathname.startsWith("/signup")) {
        response.headers.set("Cache-Control", "no-store, must-revalidate");
      }

      response.headers.set("Vary", "Accept-Encoding");

      // Redirect protected routes to sign-in when Clerk is not configured
      if (isProtectedRoute(req)) {
        // API routes return JSON 401, page routes redirect to sign-in
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

      return response;
    };

export default middleware;

export const config = {
  matcher: [
    // Exclude: Next.js internals, static images, and the self-hosted
    // EmulatorJS runtime (large binary .data/.wasm/.js assets in public/).
    // Running Clerk middleware on these caused 500s and wasted RAM.
    "/((?!_next/static|_next/image|favicon.ico|emulatorjs|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    "/__clerk/:path*",
  ],
};
