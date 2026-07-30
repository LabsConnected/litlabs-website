import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { getUserByClerkId } from "@/lib/user-db";
import { createGeneration } from "@/lib/music/generation-service";

export const dynamic = "force-dynamic";

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
 */
export async function POST(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json(result, { status: result.replayed ? 200 : 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    const name = err instanceof Error ? err.name : "";

    if (name === "INSUFFICIENT_LBC") {
      return NextResponse.json({ error: message }, { status: 402 });
    }
    if (name === "SAFETY_VIOLATION" || name === "EXPLICIT_CONTENT") {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
