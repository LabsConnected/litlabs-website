import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

function getClient() {
  try {
    return getSupabaseAdmin();
  } catch {
    return null;
  }
}

// GET /api/tracks - Fetch active tracks
export async function GET(req: NextRequest) {
  const supabase = getClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const genre = searchParams.get("genre");
    const limit = parseInt(searchParams.get("limit") || "50");

    let query = supabase
      .from("tracks")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(limit);

    if (genre) {
      query = query.eq("genre", genre);
    }

    const { data: tracks, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch tracks" },
        { status: 500 },
      );
    }

    const tracksWithUrls = await Promise.all(
      tracks.map(async (track) => {
        let url = track.public_url;
        if (track.storage_provider === "r2" && !url && track.storage_key) {
          url = null;
        }
        return {
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration_seconds,
          url: url,
          cover: track.cover_art_url,
          genre: track.genre,
          plays: track.play_count,
        };
      }),
    );

    return NextResponse.json({ tracks: tracksWithUrls });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/tracks - Create new track (admin only)
export async function POST(req: NextRequest) {
  const supabase = getClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  try {
    const body = await req.json();
    const {
      title,
      artist,
      album,
      duration,
      storage_provider,
      storage_key,
      public_url,
      cover_art_url,
      genre,
      sort_order,
    } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const { data: track, error } = await supabase
      .from("tracks")
      .insert({
        title,
        artist: artist || "Unknown",
        album,
        duration_seconds: duration,
        storage_provider: storage_provider || "url",
        storage_key,
        public_url,
        cover_art_url,
        genre: genre || "synthwave",
        sort_order: sort_order || 0,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to create track" },
        { status: 500 },
      );
    }

    return NextResponse.json({ track }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
