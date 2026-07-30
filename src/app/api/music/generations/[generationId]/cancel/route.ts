import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/user-db";
import { cancelGeneration } from "@/lib/music/generation-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/music/generations/:id/cancel
 * Cancel an in-progress generation. Refunds LBC if the generation
 * had not completed.
 *
 * Ownership: only the generation owner can cancel.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ generationId: string }> },
) {
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
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cancel failed";
    if (/not found/i.test(message)) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    }
    if (/cannot cancel a completed/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
