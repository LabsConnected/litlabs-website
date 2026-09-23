import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createTerminalToken } from "@/lib/terminal-auth";
import { isDeployed } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/runtime-test/token
 *
 * Local-only helper for the /runtime-test acceptance page.
 * Requires a Clerk session, mints a token for that user, and never
 * returns internal service credentials. Deployed environments 404.
 *
 * Production command traffic goes through /api/studio/command.
 */
export async function GET(req: NextRequest) {
  if (isDeployed()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { userId } = await auth(req);
  if (!userId || userId === "anonymous-dev") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.TERMINAL_AUTH_SECRET ?? "";
  if (secret.length < 32) {
    return NextResponse.json(
      { error: "Terminal auth not configured" },
      { status: 503 },
    );
  }

  const { token, expiresAt } = createTerminalToken(userId);
  return NextResponse.json({ token, expiresAt });
}
