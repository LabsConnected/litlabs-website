import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// Fallback tracks when Supabase is not configured
const FALLBACK_TRACKS = [
  {
    id: "1",
    title: "Neon Dreams",
    artist: "Synthwave Labs",
    album: "Cyberpunk Collection",
    duration: 180,
    url: null,
    cover: null,
    genre: "synthwave",
    plays: 0,
  },
  {
    id: "2",
    title: "Digital Horizon",
    artist: "Pixel Forge",
    album: "Future Sounds",
    duration: 210,
    url: null,
    cover: null,
    genre: "electronic",
    plays: 0,
  },
];

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
    // Return fallback tracks when Supabase is not configured
    const { searchParams } = new URL(req.url);
    const genre = searchParams.get("genre");
    const filtered = genre
      ? FALLBACK_TRACKS.filter((t) => t.genre === genre)
      : FALLBACK_TRACKS;
    return NextResponse.json({ tracks: filtered });
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
