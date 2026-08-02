import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { getUserByClerkId } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";
import { createGeneration } from "@/lib/music/generation-service";
import { getConfiguredProviderName, isMockAllowed } from "@/lib/music/providers/factory";

export const dynamic = "force-dynamic";

const TAG = "[music:generations]";

const GenerateSchema = z.object({
  prompt: z.string().min(3, "Prompt must be at least 3 characters").max(500),
  instrumental: z.boolean().default(false),
  duration: z.enum(["concept", "full"]).default("concept"),
  vocalType: z.string().optional(),
  explicit: z.boolean().optional(),
  lyrics: z.string().optional(),
  energy: z.number().min(1).max(10).optional(),
  idempotencyKey: z.string().min(8, "Idempotency key required"),
});

/**
 * POST /api/music/generations
 * Start a new music generation. Returns 202 with the generation ID.
 *
 * The generation runs asynchronously — the client polls
 * GET /api/music/generations/:id for status updates.
 *
 * Billing:
 *   - LBC is debited atomically before generation starts
 *   - If generation fails, LBC is refunded automatically
 *   - Idempotency key prevents duplicate charges
 *
 * Provider gating:
 *   - The mock provider is rejected here unless explicitly allowed
 *     (tests or MUSIC_ALLOW_MOCK=true). Production must set MUSIC_PROVIDER
 *     to a real provider (elevenlabs|mureka) so a billed path can never
 *     silently produce fake audio.
 */
async function handler(req: NextRequest) {
  const start = Date.now();
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    console.info(`${TAG} 401 userId=anon dur=${Date.now() - start}ms`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Mock gate — reject before any billing/DB work in production.
  const providerName = getConfiguredProviderName();
  if (providerName === "mock" && !isMockAllowed()) {
    console.info(`${TAG} 503 userId=${clerkId} reason=mock-not-allowed dur=${Date.now() - start}ms`);
    return NextResponse.json(
      {
        error:
          "Music generation is not configured. Set MUSIC_PROVIDER to a supported provider (elevenlabs|mureka).",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = GenerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid request" },
      { status: 400 },
    );
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    console.info(`${TAG} 404 userId=${clerkId} reason=user-not-found dur=${Date.now() - start}ms`);
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { duration, ...rest } = parsed.data;
  const durationSeconds = duration === "concept" ? 30 : 120;

  try {
    const result = await createGeneration({
      clerkId,
      userId: user.id,
      input: { ...rest, durationSeconds },
    });
    console.info(
      `${TAG} ${result.replayed ? 200 : 202} userId=${clerkId} genId=${result.generationId} provider=${providerName} charged=${result.lbcCharged} replayed=${result.replayed} dur=${Date.now() - start}ms`,
    );
    return NextResponse.json(result, { status: result.replayed ? 200 : 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    const name = err instanceof Error ? err.name : "";
    console.error(`${TAG} 500 userId=${clerkId} errName=${name} msg=${message} dur=${Date.now() - start}ms`);

    if (name === "INSUFFICIENT_LBC") {
      return NextResponse.json({ error: message }, { status: 402 });
    }
    if (name === "SAFETY_VIOLATION" || name === "EXPLICIT_CONTENT") {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Rate limit: 10 generation starts per 60s per IP (withRateLimit is backed by
// the Supabase rate_limit_store and keyed on the client IP). Generation is
// expensive and billed, so the budget is tighter than the read-heavy routes.
export const POST = withRateLimit(handler, 10, 60);

