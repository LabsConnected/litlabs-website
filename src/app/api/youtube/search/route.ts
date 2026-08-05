import { NextResponse, type NextRequest } from "next/server";

/**
 * GET /api/youtube/search?q=<query>&maxResults=<n>
 *
 * Searches YouTube for music videos using the YouTube Data API v3.
 * Returns video results with thumbnails, titles, channel names, and durations.
 *
 * Requires: YOUTUBE_DATA_API_KEY environment variable.
 * Get one at: Google Cloud Console → enable YouTube Data API v3
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: string; // ISO 8601 → "M:SS"
  viewCount?: string;
  publishedAt?: string;
}

interface YouTubeSearchResponse {
  results: YouTubeSearchResult[];
  totalResults: number;
  error?: string;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q");
  const maxResultsParam = request.nextUrl.searchParams.get("maxResults");
  const maxResults = Math.min(parseInt(maxResultsParam ?? "10", 10) || 10, 50);

  if (!query || !query.trim()) {
    return NextResponse.json(
      { results: [], totalResults: 0, error: "Query parameter 'q' is required" } satisfies YouTubeSearchResponse,
      { status: 400 },
    );
  }

  const apiKey = process.env.YOUTUBE_DATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        results: [],
        totalResults: 0,
        error: "YouTube Data API key not configured. Set YOUTUBE_DATA_API_KEY in your environment.",
      } satisfies YouTubeSearchResponse,
      { status: 503 },
    );
  }

  try {
    // Step 1: Search for videos in the music category
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("videoCategoryId", "10"); // Music category
    searchUrl.searchParams.set("maxResults", String(maxResults));
    searchUrl.searchParams.set("key", apiKey);

    const searchResponse = await fetch(searchUrl, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (!searchResponse.ok) {
      const errorBody = await searchResponse.json().catch(() => null) as { error?: { message?: string } } | null;
      return NextResponse.json(
        {
          results: [],
          totalResults: 0,
          error: errorBody?.error?.message ?? `YouTube search failed (${searchResponse.status})`,
        } satisfies YouTubeSearchResponse,
        { status: searchResponse.status },
      );
    }

    const searchData = await searchResponse.json() as {
      items: Array<{
        id: { videoId: string };
        snippet: {
          title: string;
          channelTitle: string;
          thumbnails: { high?: { url: string }; medium?: { url: string }; default?: { url: string } };
          publishedAt: string;
        };
      }>;
      pageInfo?: { totalResults: number };
    };

    if (!searchData.items || searchData.items.length === 0) {
      return NextResponse.json({
        results: [],
        totalResults: 0,
      } satisfies YouTubeSearchResponse);
    }

    const videoIds = searchData.items.map((item) => item.id.videoId).filter(Boolean);

    // Step 2: Fetch video details (duration + view count) in one batch
    const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    detailsUrl.searchParams.set("part", "contentDetails,statistics");
    detailsUrl.searchParams.set("id", videoIds.join(","));
    detailsUrl.searchParams.set("key", apiKey);

    const detailsResponse = await fetch(detailsUrl, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    const detailsMap = new Map<string, { duration: string; viewCount?: string }>();
    if (detailsResponse.ok) {
      const detailsData = await detailsResponse.json() as {
        items: Array<{
          id: string;
          contentDetails: { duration: string };
          statistics?: { viewCount?: string };
        }>;
      };
      for (const item of detailsData.items ?? []) {
        detailsMap.set(item.id, {
          duration: item.contentDetails?.duration ?? "",
          viewCount: item.statistics?.viewCount,
        });
      }
    }

    // Build results
    const results: YouTubeSearchResult[] = searchData.items.map((item) => {
      const details = detailsMap.get(item.id.videoId);
      return {
        videoId: item.id.videoId,
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        thumbnail:
          item.snippet.thumbnails.high?.url ??
          item.snippet.thumbnails.medium?.url ??
          item.snippet.thumbnails.default?.url ??
          `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg`,
        duration: details?.duration ?? "",
        viewCount: details?.viewCount,
        publishedAt: item.snippet.publishedAt,
      };
    });

    return NextResponse.json({
      results,
      totalResults: searchData.pageInfo?.totalResults ?? results.length,
    } satisfies YouTubeSearchResponse, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "YouTube search failed";
    return NextResponse.json(
      {
        results: [],
        totalResults: 0,
        error: message,
      } satisfies YouTubeSearchResponse,
      { status: 500 },
    );
  }
}
