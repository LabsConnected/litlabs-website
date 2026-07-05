import { NextResponse, type NextRequest } from "next/server";

// Skip Clerk entirely when keys are not configured so the app can
// still run (unauthenticated) without crashing at startup.
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const isClerkConfigured = !!(clerkKey && clerkSecretKey);

const PROTECTED_PREFIXES = [
  "/marketplace",
  "/settings",
  "/profile",
  "/agent-chat",
  "/gallery/",
  "/api/user-agents",
  "/api/conversations",
  "/api/settings/",
  "/api/wallet",
  "/api/users/",
  "/api/account",
  "/api/orchestrate",
];

const CACHEABLE_PAGES = ["/about", "/contact", "/docs", "/pricing"];

function isProtected(pathname: string) {
  return PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
}

// Lazily import Clerk middleware only when keys are present so that
// the module-level initialisation inside @clerk/nextjs never fires
// without valid credentials.
let clerkHandler:
  | ((req: NextRequest) => Promise<NextResponse> | NextResponse)
  | null = null;

if (isClerkConfigured) {
  // Dynamic require is intentional — keeps the import tree-shaken
  // when Clerk is not configured.
  const {
    clerkMiddleware,
    createRouteMatcher,
  } = require("@clerk/nextjs/server") as typeof import("@clerk/nextjs/server");

  const isProtectedRoute = createRouteMatcher(
    PROTECTED_PREFIXES.map((p) => `${p}(.*)`)
  );

  clerkHandler = clerkMiddleware(async (auth, req) => {
    const { userId } = await auth();

    const response = NextResponse.next();

    if (CACHEABLE_PAGES.includes(req.nextUrl.pathname)) {
      response.headers.set(
        "Cache-Control",
        "public, max-age=1800, stale-while-revalidate=3600"
      );
    }

    if (
      req.nextUrl.pathname.startsWith("/login") ||
      req.nextUrl.pathname.startsWith("/signup")
    ) {
      response.headers.set("Cache-Control", "no-store, must-revalidate");
    }

    response.headers.set("Vary", "Accept-Encoding");

    if (isProtectedRoute(req) && !userId) {
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }

    return response;
  }) as (req: NextRequest) => Promise<NextResponse>;
}

export default function middleware(req: NextRequest) {
  if (clerkHandler) {
    return clerkHandler(req);
  }

  // Clerk not configured — pass through with standard headers
  const response = NextResponse.next();

  if (CACHEABLE_PAGES.includes(req.nextUrl.pathname)) {
    response.headers.set(
      "Cache-Control",
      "public, max-age=1800, stale-while-revalidate=3600"
    );
  }

  if (
    req.nextUrl.pathname.startsWith("/login") ||
    req.nextUrl.pathname.startsWith("/signup")
  ) {
    response.headers.set("Cache-Control", "no-store, must-revalidate");
  }

  response.headers.set("Vary", "Accept-Encoding");

  // Without auth, redirect protected routes to sign-in
  if (isProtected(req.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    "/__clerk/:path*",
  ],
};
