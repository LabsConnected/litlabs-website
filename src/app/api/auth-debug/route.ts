import { NextRequest, NextResponse } from "next/server";
import { auth as clerkAuth, verifyToken } from "@clerk/nextjs/server";
import { isClerkConfigured } from "@/lib/env";

/**
 * DEBUG ENDPOINT — shows exactly which auth method works and which fails.
 * Visit /api/auth-debug while signed in to see the auth state.
 */
export async function GET(request: NextRequest) {
  const debug: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    clerkConfigured: isClerkConfigured(),
    hasPublishableKey: !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    hasSecretKey: !!process.env.CLERK_SECRET_KEY,
    secretKeyLength: process.env.CLERK_SECRET_KEY?.length ?? 0,
    hasFrontendApiUrl: !!process.env.NEXT_PUBLIC_CLERK_FRONTEND_API_URL,
    frontendApiUrl: process.env.NEXT_PUBLIC_CLERK_FRONTEND_API_URL ?? null,
  };

  // Check ALL Clerk-related headers
  const clerkHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (key.startsWith("x-clerk")) {
      clerkHeaders[key] = value;
    }
  });
  debug.clerkHeaders = clerkHeaders;

  // Check cookies
  const cookieNames: string[] = [];
  request.cookies.forEach((_value, name) => cookieNames.push(name));
  debug.cookieNames = cookieNames;
  debug.hasClerkCookie = cookieNames.some((n) => n.includes("clerk") || n.includes("__clerk"));

  // Check if Authorization header is present
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  debug.hasAuthHeader = !!authHeader;
  debug.authHeaderPrefix = authHeader?.slice(0, 20) ?? null;

  // Test 1: Clerk cookie-based auth
  try {
    const result = await clerkAuth();
    debug.clerkAuthUserId = result.userId;
    debug.clerkAuthSuccess = true;
  } catch (e) {
    debug.clerkAuthSuccess = false;
    debug.clerkAuthError = e instanceof Error ? e.message : String(e);
  }

  // Test 2: Bearer token verification
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    debug.tokenLength = token.length;
    try {
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
      });
      debug.verifyTokenSuccess = true;
      debug.verifyTokenSub = payload.sub;
    } catch (e) {
      debug.verifyTokenSuccess = false;
      debug.verifyTokenError = e instanceof Error ? e.message : String(e);
    }
  } else {
    debug.verifyTokenSuccess = "skipped (no bearer token)";
  }

  return NextResponse.json(debug, { status: 200 });
}
