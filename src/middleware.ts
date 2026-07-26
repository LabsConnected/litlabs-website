import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/marketplace(.*)",
  "/settings(.*)",
  "/profile(.*)",
  "/agent-chat(.*)",
  "/gallery/(.*)",
  "/api/user-agents(.*)",
  "/api/conversations(.*)",
  "/api/settings/(.*)",
  "/api/wallet(.*)",
  "/api/users/(.*)",
  "/api/account",
  "/api/orchestrate",
]);

const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const isClerkConfigured = !!(clerkKey && clerkSecretKey);

// Always call clerkMiddleware() so detectClerkMiddleware(req) succeeds in
// API routes. When Clerk env vars are missing, auth() returns { userId: null }
// instead of throwing, and API routes respond with 401 as designed.
// The isClerkConfigured flag only gates the protected-route redirect logic.
export default clerkMiddleware(async (auth, req) => {
  let userId: string | null = null;
  if (isClerkConfigured) {
    try {
      const authResult = await auth();
      userId = authResult.userId;
    } catch {
      // Clerk unreachable — allow request through
    }
  }

  const response = NextResponse.next();

  if (["/about", "/contact", "/docs", "/pricing"].includes(req.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=3600");
  }

  if (req.nextUrl.pathname.startsWith("/login") || req.nextUrl.pathname.startsWith("/signup")) {
    response.headers.set("Cache-Control", "no-store, must-revalidate");
  }

  response.headers.set("Vary", "Accept-Encoding");

  if (isClerkConfigured && isProtectedRoute(req) && !userId) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  return response;
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    "/__clerk/:path*",
  ],
};
