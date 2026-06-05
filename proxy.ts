import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  // ============================================
  // CACHING STRATEGY
  // ============================================

  // Cache gallery and marketplace pages for 1 hour
  if (request.nextUrl.pathname.startsWith("/gallery") || request.nextUrl.pathname.startsWith("/marketplace")) {
    response.headers.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  }

  // Cache static pages for 30 minutes
  if (["/about", "/contact", "/docs", "/pricing"].includes(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=3600");
  }

  // No cache for auth pages
  if (request.nextUrl.pathname.startsWith("/login") || request.nextUrl.pathname.startsWith("/signup")) {
    response.headers.set("Cache-Control", "no-store, must-revalidate");
  }

  // ============================================
  // SECURITY HEADERS
  // ============================================

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';");

  // ============================================
  // COMPRESSION
  // ============================================

  response.headers.set("Vary", "Accept-Encoding");

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!api|_next/static|_next/image|favicon.ico|public).*)",
  ],
};
