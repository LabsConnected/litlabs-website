import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/marketplace(.*)",
  "/settings(.*)",
  "/profile(.*)",
  "/gallery/(.*)",
  "/api/user-agents(.*)",
  "/api/conversations(.*)",
  "/api/settings/(.*)",
  "/api/wallet(.*)",
  "/api/users/(.*)",
  "/api/account",
  "/api/orchestrate",
]);

// Skip middleware entirely if Clerk is not configured
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const isClerkConfigured = !!(clerkKey && clerkSecretKey);

const configuredMiddleware = isClerkConfigured
  ? clerkMiddleware(async (auth, req) => {
  let userId: string | null = null;
  try {
    const authResult = await auth();
    userId = authResult.userId;
  } catch (error) {
    // Clerk unreachable — allow request through rather than crashing
    console.error("Clerk auth error:", error);
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
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  return response;
    })
  : null;

// clerkMiddleware validates its keys before its callback runs, so choose the
// pass-through handler before constructing it in local/custom-auth mode.
export default configuredMiddleware ?? (() => NextResponse.next());

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$|api/studio/video|api/media/generate|api/music/generate).*)",
    "/__clerk/:path*",
  ],
};
