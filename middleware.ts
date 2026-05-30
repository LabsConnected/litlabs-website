import { NextResponse } from "next/server";
import { verifyToken } from "./src/lib/jwt";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/register",
  "/api/auth",
  "/api/chat",
  "/api/settings",
  "/gallery",
];

const STATIC_EXTENSIONS = [
  ".svg",
  ".ico",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".css",
  ".js",
];

export async function middleware(request: {
  nextUrl: { pathname: string; origin: string; href: string };
  cookies: { get: (name: string) => { value: string } | undefined };
}) {
  const { pathname } = request.nextUrl;

  // Public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    STATIC_EXTENSIONS.some((ext) => pathname.endsWith(ext))
  ) {
    return NextResponse.next();
  }

  // Auth check
  const token = request.cookies.get("auth-token")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  }

  const payload = await verifyToken(token);
  if (!payload) {
    const res = NextResponse.redirect(
      new URL("/login", request.nextUrl.origin)
    );
    res.cookies.delete("auth-token");
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
