import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRuntimeSnapshotInternal } from "@/lib/terminal-internal-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/runtime-feed
 *
 * Same-origin relay for the Studio "live status feed".
 *
 * ROOT CAUSE IT FIXES: the browser used to open a Socket.IO connection
 * directly to the terminal server at
 *   NEXT_PUBLIC_TERMINAL_WS_URL ?? "http://127.0.0.1:4001".
 * NEXT_PUBLIC_* is baked in at build time — when it is unset (as in
 * production), every browser, including phones, tries its own loopback
 * address and the feed can never connect. The direct path also needs a
 * public wss domain plus TERMINAL_ALLOWED_ORIGIN CORS config, three
 * deployment knobs that all have to be right at once.
 *
 * This relay removes all three: the browser talks only to its own origin,
 * and the web server fetches the identical runtime snapshot from the
 * terminal server over the already-proven internal service connection
 * (TERMINAL_SERVER_INTERNAL_URL + TERMINAL_INTERNAL_SERVICE_KEY —
 * the same path workspace provisioning uses).
 *
 * Failure is honest: 401 when signed out, 503 with a machine-readable
 * code when the terminal server is unreachable — the client keeps the
 * "feed down" state truthful instead of silently faking it.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth(request).catch(() => ({ userId: null }));

  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "Sign in required." },
      { status: 401 },
    );
  }

  try {
    const snapshot = await getRuntimeSnapshotInternal();
    return NextResponse.json({
      snapshot,
      relayedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const notConfigured =
      message.includes("not configured") || message.includes("NOT_CONFIGURED");
    return NextResponse.json(
      {
        code: notConfigured ? "TERMINAL_NOT_CONFIGURED" : "TERMINAL_UNREACHABLE",
        // Never leak internal URLs or keys — the client only needs to know
        // the feed is down, not why at the infrastructure level.
        message: notConfigured
          ? "Terminal server is not configured."
          : "Terminal server is unreachable.",
      },
      { status: 503 },
    );
  }
}
