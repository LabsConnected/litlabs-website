import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher([
  // Pages requiring login
  "/builder(.*)",
  "/marketplace(.*)",
  "/settings(.*)",
  "/profile(.*)",
  "/agent-chat(.*)",
  "/gallery/(.*)", // specific gallery items
  
  // API routes requiring auth
  "/api/user-agents(.*)",
  "/api/conversations(.*)",
  "/api/settings/(.*)",
  "/api/wallet(.*)",
  "/api/users/(.*)",
  "/api/account",
  "/api/orchestrate",
]);

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();

  // Add cache headers for performance
  const response = NextResponse.next();

  // Cache static pages for 30 minutes
  if (["/about", "/contact", "/docs", "/pricing"].includes(req.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=3600");
  }

  // No cache for auth pages
  if (req.nextUrl.pathname.startsWith("/login") || req.nextUrl.pathname.startsWith("/signup")) {
    response.headers.set("Cache-Control", "no-store, must-revalidate");
  }

  response.headers.set("Vary", "Accept-Encoding");

  // Protect private routes
  if (isProtectedRoute(req) && !userId) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  return response;
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    "/__clerk/:path*",
  ],
};
