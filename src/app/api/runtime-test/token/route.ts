import { NextResponse } from "next/server";
import { createTerminalToken } from "@/lib/terminal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/runtime-test/token
 *
 * TEMPORARY: Mints a terminal token for the /runtime-test acceptance page.
 * This route is NOT protected by Clerk auth — it exists only for OS-2D.2
 * browser acceptance testing and will be deleted after the proof is complete.
 *
 * In production, terminal tokens are issued via /api/terminal/token which
 * requires Clerk authentication.
 */
export async function GET() {
  const secret = process.env.TERMINAL_AUTH_SECRET ?? "";
  if (secret.length < 32) {
    return NextResponse.json(
      { error: "Terminal auth not configured" },
      { status: 503 },
    );
  }

  const { token, expiresAt } = createTerminalToken("runtime-test-user");

  // Also return the internal service key for the test page to trigger commands.
  // This is ONLY acceptable because this route is temporary and unprotected.
  // In production, command triggering goes through /api/studio/command with Clerk auth.
  const internalKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";

  return NextResponse.json({ token, expiresAt, internalKey });
}
