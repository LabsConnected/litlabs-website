import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";
import { cancelGeneration } from "@/lib/music/generation-service";

export const dynamic = "force-dynamic";

const TAG = "[music:cancel]";

/**
 * POST /api/music/generations/:id/cancel
 * Cancel an in-progress generation. Refunds LBC if the generation
 * had not completed.
 *
 * Ownership: only the generation owner can cancel.
 */
async function handler(
  _req: NextRequest,
  { params }: { params: Promise<{ generationId: string }> },
) {
  const start = Date.now();
  const { userId: clerkId } = await auth();
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
    const result = await cancelGeneration(generationId, user.id, clerkId);
    console.info(`${TAG} 200 userId=${clerkId} genId=${generationId} refunded=${result.refunded} dur=${Date.now() - start}ms`);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cancel failed";
    console.error(`${TAG} err userId=${clerkId} genId=${generationId} msg=${message} dur=${Date.now() - start}ms`);
    if (/not found/i.test(message)) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    }
    if (/cannot cancel a completed/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Cancellation triggers a refund path; keep it as tight as generation itself.
export const POST = withRateLimit(handler, 10, 60);
