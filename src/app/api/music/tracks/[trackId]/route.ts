import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getUserByClerkId } from "@/lib/user-db";
import { deleteTrack } from "@/lib/music/generation-service";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
});

/**
 * PATCH /api/music/tracks/:id
 * Update track metadata (title, visibility).
 * Ownership: only the track owner can update.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { trackId } = await params;
  if (!trackId) {
    return NextResponse.json({ error: "Missing track ID" }, { status: 400 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid request" },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  // Ownership check: update only if user_id matches
  const { data: updated, error } = await admin
    .from("music_tracks")
    .update(parsed.data)
    .eq("id", trackId)
    .eq("user_id", user.id)
    .select("id, title, version_label, duration, bpm, musical_key, visibility, created_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  return NextResponse.json({ track: updated });
}

/**
 * DELETE /api/music/tracks/:id
 * Delete a track and its R2 audio object.
 * Ownership: only the track owner can delete. R2 delete validates ownership
 * again server-side (key must be prefixed with {userId}/).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { trackId } = await params;
  if (!trackId) {
    return NextResponse.json({ error: "Missing track ID" }, { status: 400 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  try {
    const deleted = await deleteTrack(trackId, user.id);
    if (!deleted) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
