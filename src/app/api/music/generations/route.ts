// src/app/api/music/generations/route.ts
// POST /api/music/generations — create a music generation (Quick Create / Custom).
// Auth: Clerk. LBC: charged atomically via the existing credit_ledger.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limiter";
import { createGeneration } from "@/lib/music/generation-service";
import type { GenerateSongInput } from "@/types/music";

/** Resolve Clerk id → internal public.users.id UUID. */
async function resolveUserId(clerkId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data } = await admin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

export async function POST(req: NextRequest) {
  const { success, resetTime } = await rateLimit(req, 5, 60); // 5 generations/min
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(resetTime) } });
  }

  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const {
      prompt,
      instrumental,
      duration,
      vocalType,
      explicit,
      lyrics,
      style,
      energy,
      idempotencyKey,
    } = body as Record<string, unknown>;

    if (typeof prompt !== "string" || prompt.trim().length < 5) {
      return NextResponse.json({ error: "Prompt must be at least 5 characters" }, { status: 400 });
    }
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8) {
      return NextResponse.json({ error: "idempotencyKey is required (min 8 chars)" }, { status: 400 });
    }

    const userId = await resolveUserId(clerkId);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const durationSeconds =
      duration === "concept" ? 30 : typeof duration === "number" ? duration : 180;

    const input: GenerateSongInput = {
      prompt: prompt.trim(),
      instrumental: Boolean(instrumental),
      durationSeconds,
      vocalType: typeof vocalType === "string" ? vocalType : undefined,
      explicit: Boolean(explicit),
      lyrics: typeof lyrics === "string" ? lyrics : undefined,
      style: typeof style === "string" ? style : undefined,
      energy: typeof energy === "number" ? energy : undefined,
      idempotencyKey: idempotencyKey.trim(),
    };

    const result = await createGeneration({ clerkId, userId, input });

    return NextResponse.json(
      {
        generationId: result.generationId,
        status: result.status,
        lbcCharged: result.lbcCharged,
        replayed: result.replayed,
        message: result.replayed ? "Existing generation returned" : "Generation started",
      },
      { status: 202 },
    );
  } catch (error: unknown) {
    const err = error as Error & { name?: string };
    if (err.name === "SAFETY_VIOLATION") {
      return NextResponse.json({ error: err.message, code: "SAFETY_VIOLATION" }, { status: 400 });
    }
    if (err.name === "EXPLICIT_CONTENT") {
      return NextResponse.json({ error: err.message, code: "EXPLICIT_CONTENT" }, { status: 400 });
    }
    if (err.name === "INSUFFICIENT_LBC") {
      return NextResponse.json({ error: err.message, code: "INSUFFICIENT_LBC" }, { status: 402 });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message, code: "GENERATION_FAILED" }, { status: 500 });
  }
}
