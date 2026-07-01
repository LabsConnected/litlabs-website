import { NextRequest, NextResponse } from "next/server";

async function getAccessToken(req: NextRequest): Promise<string | null> {
  const base = new URL(req.url).origin;
  const res = await fetch(`${base}/api/spotify/token`, { headers: { cookie: req.headers.get("cookie") ?? "" } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token ?? null;
}

// GET /api/spotify/search?q=query&type=track,artist&limit=20
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  if (!q) return NextResponse.json({ error: "missing q" }, { status: 400 });

  const type = searchParams.get("type") ?? "track";
  const limit = searchParams.get("limit") ?? "20";

  const token = await getAccessToken(req);
  if (!token) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", q);
  url.searchParams.set("type", type);
  url.searchParams.set("limit", limit);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  const data = await res.json();

  // Normalize tracks for the music player
  const tracks = (data.tracks?.items ?? []).map((t: Record<string, unknown>) => {
    const artists = t.artists as { name: string }[];
    const album = t.album as { name: string; images: { url: string }[] };
    return {
      id: t.id as string,
      spotifyId: t.id as string,
      title: t.name as string,
      artist: artists.map((a) => a.name).join(", "),
      album: album?.name ?? "",
      cover: album?.images?.[0]?.url ?? "",
      duration: Math.floor((t.duration_ms as number) / 1000),
      preview_url: t.preview_url as string | null,
      uri: t.uri as string,
      genre: "spotify",
    };
  });

  return NextResponse.json({ tracks, raw: data });
}
