import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMediaHealth } from "@/lib/generation/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/media/health
 *
 * Returns real provider health for all media modalities.
 * Health is determined by actual API probes, not just env var existence.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const health = await getMediaHealth();
    return NextResponse.json(health, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Health check failed" },
      { status: 500 },
    );
  }
}
