import { NextRequest, NextResponse } from "next/server";
import { auth as clerkAuth, verifyToken } from "@clerk/nextjs/server";
import { isClerkConfigured } from "@/lib/env";

/**
 * DEBUG ENDPOINT — shows exactly which auth method works and which fails.
 * This will be removed once the auth issue is resolved.
 */
export async function GET(request: NextRequest) {
  const debug: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    clerkConfigured: isClerkConfigured(),
    hasPublishableKey: !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    hasSecretKey: !!process.env.CLERK_SECRET_KEY,
    secretKeyLength: process.env.CLERK_SECRET_KEY?.length ?? 0,
  };

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
    debug.clerkAuthErrorStack = e instanceof Error ? e.stack?.split("\n").slice(0, 5).join("\n") : null;
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
      debug.verifyTokenIss = (payload as Record<string, unknown>).iss;
    } catch (e) {
      debug.verifyTokenSuccess = false;
      debug.verifyTokenError = e instanceof Error ? e.message : String(e);
    }
  } else {
    debug.verifyTokenSuccess = "skipped (no bearer token)";
  }

  // Test 3: Check all request headers (to see if Clerk middleware set auth headers)
  const headerKeys: string[] = [];
  request.headers.forEach((_value, key) => headerKeys.push(key));
  debug.allHeaderKeys = headerKeys;
  debug.hasClerkAuthStatus = request.headers.has("x-auth-status");
  debug.clerkAuthStatus = request.headers.get("x-auth-status");

  return NextResponse.json(debug, { status: 200 });
}
