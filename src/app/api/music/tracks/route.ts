// src/app/api/music/tracks/route.ts
// GET /api/music/tracks — list the current user's tracks with playable URLs.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limiter";
import { resolveTrackAudioUrl } from "@/lib/music/generation-service";
import type { TrackVisibility } from "@/types/music";

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

export async function GET(req: NextRequest) {
  const { success, resetTime } = await rateLimit(req, 60, 60);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(resetTime) } });
  }

  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = await resolveUserId(clerkId);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const visibility = searchParams.get("visibility");
    const projectId = searchParams.get("projectId");

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
    }

    let query = admin
      .from("music_tracks")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (visibility) {
      query = query.eq("visibility", visibility);
    }
    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { data: tracks, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Resolve playable URLs (signed for private/unlisted, public URL for public).
    const tracksWithUrls = await Promise.all(
      (tracks ?? []).map(async (t) => {
        let audioUrl: string | null = null;
        try {
          audioUrl = await resolveTrackAudioUrl(
            t.audio_storage_key as string,
            t.visibility as TrackVisibility,
          );
        } catch {
          audioUrl = null; // R2 not configured — UI will show unavailable
        }
        return { ...t, audioUrl };
      }),
    );

    return NextResponse.json({ tracks: tracksWithUrls });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch tracks";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
