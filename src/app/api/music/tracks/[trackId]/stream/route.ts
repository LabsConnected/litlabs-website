import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getUserByClerkId } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";
import { resolveTrackAudioUrl } from "@/lib/music/generation-service";

export const dynamic = "force-dynamic";

const TAG = "[music:stream]";

/**
 * GET /api/music/tracks/:id/stream
 * Resolve a playable audio URL for a track (streaming authorization).
 *
 * - Public tracks: returns a public R2 URL (no auth strictly required, but
 *   we still authenticate to avoid leaking which tracks exist).
 * - Private/unlisted tracks: returns a signed R2 URL (1h) that requires
 *   ownership validation — the R2 key must be prefixed with {userId}/.
 *
 * Ownership: only the track owner can request a stream URL. The raw R2 key
 * is never returned — callers receive only the resolved, time-bounded URL.
 */
async function handler(
  _req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const start = Date.now();
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

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const { data: track, error } = await admin
    .from("music_tracks")
    .select("audio_storage_key, visibility")
    .eq("id", trackId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  try {
    const audioUrl = await resolveTrackAudioUrl(
      user.id,
      track.audio_storage_key as string,
      track.visibility as "private" | "unlisted" | "public",
    );
    return NextResponse.json({ url: audioUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve audio URL";
    console.error(`${TAG} 500 userId=${clerkId} trackId=${trackId} msg=${message} dur=${Date.now() - start}ms`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Stream resolution is read-heavy (play + download); allow 60/60s.
export const GET = withRateLimit(handler, 60, 60);
