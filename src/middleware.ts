/**
 * Clerk middleware — route-tree authentication gate.
 *
 * Protects /dashboard/*, /studio/*, and /api/* at the edge so unauthenticated
 * requests are rejected before they reach any route handler. Per-route auth
 * checks in @/lib/auth remain as defense-in-depth.
 *
 * Public routes are explicitly allowlisted; everything else is protected.
 * Webhook endpoints are public by path but validate their own signatures
 * (Stripe HMAC, Clerk svix) inside their route handlers.
 *
 * Dev-only bypass (ALLOW_ANONYMOUS_DEV / PLAYWRIGHT_AUTH_DISABLED) is handled
 * inside @/lib/auth.ts; this middleware simply skips when Clerk keys are absent
 * so local dev without Clerk configured still works.
 */

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that are intentionally public — no Clerk session required.
const isPublicRoute = createRouteMatcher([
  // Landing and marketing pages
  "/",
  "/pricing(.*)",
  "/marketplace(.*)",
  "/blog(.*)",
  "/about(.*)",
  "/terms(.*)",
  "/privacy(.*)",
  "/contact(.*)",

  // Auth flow (Clerk-hosted or custom pages)
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback(.*)",

  // Public API endpoints
  "/api/health",
  "/api/health/(.*)",

  // Webhooks — authenticated by their own signature verification
  "/api/webhooks/(.*)",
  "/api/billing/webhook",
  "/api/stripe/(.*)",
  "/api/clerk/(.*)",
  "/api/n8n/(.*)",

  // Public preview / embed endpoints (workspace previews are scoped by token)
  "/api/preview/(.*)",
]);

// If Clerk keys are not configured (local dev without .env.local), export a
// no-op middleware so routes still work without Clerk installed.
const CLERK_CONFIGURED =
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
  Boolean(process.env.CLERK_SECRET_KEY);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let exportedMiddleware: any;

if (CLERK_CONFIGURED) {
  exportedMiddleware = clerkMiddleware((auth, request) => {
    // Playwright CI bypass — same guard as @/lib/auth.ts so tests work in CI
    if (
      process.env.PLAYWRIGHT_AUTH_DISABLED === "true" &&
      process.env.CI === "true" &&
      process.env.PLAYWRIGHT_TEST === "true" &&
      !process.env.RAILWAY_ENVIRONMENT &&
      !process.env.RAILWAY_PROJECT_ID &&
      !process.env.VERCEL
    ) {
      return NextResponse.next();
    }

    if (!isPublicRoute(request)) {
      auth.protect();
    }
  });
} else {
  // No Clerk configured: pass all requests through. Per-route auth.ts handles
  // ALLOW_ANONYMOUS_DEV and returns 401 when neither Clerk nor dev mode is active.
  exportedMiddleware = (_request: NextRequest) => NextResponse.next();
}

export default exportedMiddleware;

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico and other common static assets
     * This pattern is Clerk's recommended matcher for Next.js App Router.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
