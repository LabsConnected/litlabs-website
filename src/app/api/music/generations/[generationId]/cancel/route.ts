// src/app/api/music/generations/[generationId]/cancel/route.ts
// POST /api/music/generations/[generationId]/cancel — cancel + refund.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limiter";
import { cancelGeneration } from "@/lib/music/generation-service";

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ generationId: string }> },
) {
  const { success, resetTime } = await rateLimit(req, 10, 60);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(resetTime) } });
  }

  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { generationId } = await params;
    const userId = await resolveUserId(clerkId);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const result = await cancelGeneration(generationId, userId, clerkId);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Cancel failed";
    const status = message === "Generation not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
