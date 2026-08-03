import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getUserByClerkId } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";
import { resolveTrackAudioUrl } from "@/lib/music/generation-service";

export const dynamic = "force-dynamic";

const TAG = "[music:tracks]";

/**
 * GET /api/music/tracks
 * List all music tracks for the authenticated user.
 * Returns track metadata with resolved audio URLs (signed for private/unlisted).
 *
 * Ownership: rows are scoped by the server-derived user_id; the raw R2 storage
 * key is stripped from the response (callers receive a resolved audioUrl only).
 */
async function handler(req: NextRequest) {
  const start = Date.now();
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const { data: tracks, error } = await admin
      .from("music_tracks")
      .select(
        "id, title, version_label, audio_storage_key, duration, bpm, musical_key, visibility, blueprint, provider, lbc_charged, created_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(`${TAG} 500 userId=${clerkId} msg=${error.message} dur=${Date.now() - start}ms`);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Resolve audio URLs (signed for private/unlisted, public for public).
    // The raw storage key is never returned to the client.
    const tracksWithUrls = await Promise.all(
      (tracks ?? []).map(async (t) => {
        try {
          const audioUrl = await resolveTrackAudioUrl(
            user.id,
            t.audio_storage_key as string,
            t.visibility as "private" | "unlisted" | "public",
          );
          return { ...t, audioUrl, audio_storage_key: undefined };
        } catch {
          return { ...t, audioUrl: null, audio_storage_key: undefined };
        }
      }),
    );

    return NextResponse.json({ tracks: tracksWithUrls });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch tracks";
    console.error(`${TAG} 500 userId=${clerkId} msg=${message} dur=${Date.now() - start}ms`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Track listing is read-heavy; allow 60/60s.
export const GET = withRateLimit(handler, 60, 60);
