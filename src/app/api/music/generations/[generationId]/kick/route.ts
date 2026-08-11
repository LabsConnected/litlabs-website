import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserByClerkId } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";
import { getSupabaseAdmin } from "@/lib/supabase";
import { processPendingGenerations } from "@/lib/music/generation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TAG = "[music:kick]";

/**
 * POST /api/music/generations/:id/kick
 *
 * Authenticated, user-safe endpoint that asks the worker to process
 * (or resume processing) a specific music generation.
 *
 * This REPLACES the old browser → /api/music/worker call that always
 * got 401 because the browser cannot send MUSIC_WORKER_SECRET.
 *
 * Security:
 *   - Clerk authenticated (the user must own this generation)
 *   - Only operates on the specified generation ID
 *   - Rate limited (3 kicks per 60s per IP — prevents abuse)
 *   - Idempotent (kicking an already-processing job is a no-op)
 *   - Cannot process another user's generation (ownership check)
 *
 * The actual processing happens server-side via processPendingGenerations(),
 * which claims and processes ALL pending jobs (not just this one). This is
 * intentional — it's simpler and the claim RPC prevents double-processing.
 */
async function handler(req: NextRequest, { params }: { params: Promise<{ generationId: string }> }) {
  const start = Date.now();
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { generationId } = await params;
  if (!generationId || generationId.length < 8) {
    return NextResponse.json({ error: "Invalid generation ID" }, { status: 400 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Ownership check: verify this generation belongs to the authenticated user.
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const { data: gen, error } = await admin
    .from("music_generations")
    .select("id, status, user_id")
    .eq("id", generationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !gen) {
    return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  }

  // If the generation is already in a terminal state, no kick needed.
  const terminalStatuses = ["completed", "failed", "cancelled"];
  if (terminalStatuses.includes(gen.status as string)) {
    return NextResponse.json({
      kicked: false,
      status: gen.status,
      reason: "Generation is already in a terminal state",
    });
  }

  // Kick the worker. This is a server-side call — no browser auth issues.
  // The worker claims and processes all pending jobs atomically.
  try {
    const result = await processPendingGenerations();
    console.info(
      `${TAG} 200 userId=${clerkId} genId=${generationId} processed=${result.processed} recovered=${result.recovered} dur=${Date.now() - start}ms`,
    );
    return NextResponse.json({
      kicked: true,
      processed: result.processed,
      recovered: result.recovered,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Worker failed";
    console.error(`${TAG} 500 userId=${clerkId} genId=${generationId} err=${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Rate limit: 3 kicks per 60s per IP. Kicking is cheap but processing
// is expensive, so we limit how often a user can trigger the worker.
export const POST = withRateLimit(handler, 3, 60);
