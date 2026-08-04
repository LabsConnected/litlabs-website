import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseMediaUrl, isMediaUrl } from "@/components/media/parse-media-url";

export const runtime = "nodejs";

/**
 * POST /api/media/resolve
 * Resolves a pasted media URL into a normalized MediaItem with metadata.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const url = body.url;
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  if (!isMediaUrl(url)) {
    return NextResponse.json({
      error: "Unsupported URL. Paste a YouTube, Spotify, SoundCloud, Apple Music link, or a direct audio file URL.",
    }, { status: 422 });
  }

  try {
    const item = parseMediaUrl(url);
    return NextResponse.json({ item });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Failed to resolve URL",
    }, { status: 422 });
  }
}
