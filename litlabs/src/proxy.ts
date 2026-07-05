import {
  NextResponse,
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
} from "next/server";

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

function applyCacheHeaders(req: NextRequest, res: NextResponse) {
  const pathname = req.nextUrl.pathname;
  if (CACHEABLE_PAGES.includes(pathname)) {
    res.headers.set(
      "Cache-Control",
      "public, max-age=1800, stale-while-revalidate=3600",
    );
  }
  if (pathname.startsWith("/login") || pathname.startsWith("/signup")) {
    res.headers.set("Cache-Control", "no-store, must-revalidate");
  }
  res.headers.set("Vary", "Accept-Encoding");
}

// Lazy-load Clerk middleware only when keys are present. Using a dynamic
// import inside the middleware function keeps the Edge bundle tree-shaken
// when Clerk is not configured and avoids module-level `require` side effects.
let clerkInitPromise: Promise<NextMiddleware> | null = null;

async function getClerkHandler(): Promise<NextMiddleware | null> {
  if (!isClerkConfigured) return null;
  if (!clerkInitPromise) {
    clerkInitPromise = (async () => {
      const { clerkMiddleware, createRouteMatcher } = await import(
        "@clerk/nextjs/server"
      );
      const isProtectedRoute = createRouteMatcher(
        PROTECTED_PREFIXES.map((p) => `${p}(.*)`),
      );
      return clerkMiddleware(async (auth, req) => {
        const { userId } = await auth();
        const response = NextResponse.next();
        applyCacheHeaders(req, response);
        if (isProtectedRoute(req) && !userId) {
          return NextResponse.redirect(new URL("/sign-in", req.url));
        }
        return response;
      });
    })();
  }
  return clerkInitPromise;
}

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  const clerkHandler = await getClerkHandler();
  if (clerkHandler) {
    return clerkHandler(req, event);
  }

  // Clerk not configured — pass through with standard headers
  const response = NextResponse.next();
  applyCacheHeaders(req, response);
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
