import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/builder(.*)",
  "/api/user-agents(.*)",
  "/api/conversations(.*)",
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

  // Security headers
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';");
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
  ],
};
