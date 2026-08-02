import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserByClerkId } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";
import { getGenerationStatus } from "@/lib/music/generation-service";

export const dynamic = "force-dynamic";

const TAG = "[music:status]";

/**
 * GET /api/music/generations/:id
 * Poll generation status. Returns the current status, tracks, and billing info.
 *
 * Ownership: only the generation owner can poll — userId is validated
 * server-side and the query is scoped by user_id.
 */
async function handler(
  _req: NextRequest,
  { params }: { params: Promise<{ generationId: string }> },
) {
  const start = Date.now();
  const { userId: clerkId } = await auth(_req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { generationId } = await params;
  if (!generationId) {
    return NextResponse.json({ error: "Missing generation ID" }, { status: 400 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  try {
    const status = await getGenerationStatus(generationId, user.id);
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch status";
    console.error(`${TAG} 500 userId=${clerkId} genId=${generationId} msg=${message} dur=${Date.now() - start}ms`);
    if (/not found/i.test(message)) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Status polling is read-heavy (the client polls every ~3s); allow 60/60s.
export const GET = withRateLimit(handler, 60, 60);
