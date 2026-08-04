import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/media/search
 * Searches across configured media providers (YouTube, Spotify, SoundCloud).
 * Returns empty results with guidance when API keys are not configured.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { query?: string; provider?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const query = body.query;
  if (!query || typeof query !== "string" || !query.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const provider = body.provider ?? "all";
  const limit = Math.min(body.limit ?? 10, 20);

  const results: unknown[] = [];
  const warnings: string[] = [];

  // YouTube search (requires YOUTUBE_DATA_API_KEY)
  if ((provider === "all" || provider === "youtube") && process.env.YOUTUBE_DATA_API_KEY) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&maxResults=${limit}&type=video&key=${process.env.YOUTUBE_DATA_API_KEY}`,
      );
      if (res.ok) {
        const data = await res.json();
        for (const item of data.items ?? []) {
          results.push({
            provider: "youtube",
            sourceUrl: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
            title: item.snippet?.title,
            creator: item.snippet?.channelTitle,
            artworkUrl: item.snippet?.thumbnails?.medium?.url,
          });
        }
      }
    } catch {
      warnings.push("YouTube search failed");
    }
  } else if (provider === "all" || provider === "youtube") {
    warnings.push("YouTube search requires YOUTUBE_DATA_API_KEY");
  }

  // SoundCloud search (requires SOUNDCLOUD_CLIENT_ID)
  if ((provider === "all" || provider === "soundcloud") && process.env.SOUNDCLOUD_CLIENT_ID) {
    try {
      const res = await fetch(
        `https://api.soundcloud.com/tracks?q=${encodeURIComponent(query)}&limit=${limit}&client_id=${process.env.SOUNDCLOUD_CLIENT_ID}`,
      );
      if (res.ok) {
        const data = await res.json();
        for (const item of data ?? []) {
          results.push({
            provider: "soundcloud",
            sourceUrl: item.permalink_url,
            title: item.title,
            creator: item.user?.username,
            artworkUrl: item.artwork_url?.replace("-large", "-t500x500"),
            durationMs: item.duration,
          });
        }
      }
    } catch {
      warnings.push("SoundCloud search failed");
    }
  } else if (provider === "all" || provider === "soundcloud") {
    warnings.push("SoundCloud search requires SOUNDCLOUD_CLIENT_ID");
  }

  // Spotify search requires OAuth token — return guidance
  if (provider === "all" || provider === "spotify") {
    warnings.push("Spotify catalog search requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET");
  }

  return NextResponse.json({ results, warnings, total: results.length });
}
