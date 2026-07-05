import { NextRequest, NextResponse } from "next/server";

async function getAccessToken(req: NextRequest): Promise<string | null> {
  const base = new URL(req.url).origin;
  const res = await fetch(`${base}/api/spotify/token`, { headers: { cookie: req.headers.get("cookie") ?? "" } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token ?? null;
}

// GET /api/spotify/player — current playback state
export async function GET(req: NextRequest) {
  const token = await getAccessToken(req);
  if (!token) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const res = await fetch("https://api.spotify.com/v1/me/player", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 204) return NextResponse.json({ playing: false, track: null });
  if (!res.ok) return NextResponse.json({ error: "player_error" }, { status: res.status });
  return NextResponse.json(await res.json());
}

// POST /api/spotify/player — playback control
// body: { action: "play"|"pause"|"next"|"prev"|"seek"|"volume"|"transfer", ...params }
export async function POST(req: NextRequest) {
  const token = await getAccessToken(req);
  if (!token) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const body = await req.json();
  const { action, device_id, uri, uris, position_ms, volume_percent } = body;

  let endpoint = "";
  let method = "PUT";
  let payload: Record<string, unknown> | null = null;

  switch (action) {
    case "play":
      endpoint = "https://api.spotify.com/v1/me/player/play";
      payload = {};
      if (device_id) payload.device_id = device_id;
      if (uri) payload.uris = [uri];
      if (uris) payload.uris = uris;
      if (position_ms !== undefined) payload.position_ms = position_ms;
      break;
    case "pause":
      endpoint = "https://api.spotify.com/v1/me/player/pause";
      break;
    case "next":
      endpoint = "https://api.spotify.com/v1/me/player/next";
      method = "POST";
      break;
    case "prev":
      endpoint = "https://api.spotify.com/v1/me/player/previous";
      method = "POST";
      break;
    case "seek":
      endpoint = `https://api.spotify.com/v1/me/player/seek?position_ms=${position_ms}`;
      break;
    case "volume":
      endpoint = `https://api.spotify.com/v1/me/player/volume?volume_percent=${volume_percent}`;
      break;
    case "transfer":
      endpoint = "https://api.spotify.com/v1/me/player";
      payload = { device_ids: [device_id], play: true };
      break;
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const res = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });

  if (res.status === 204 || res.status === 200) return NextResponse.json({ ok: true });
  const err = await res.text();
  return NextResponse.json({ error: err }, { status: res.status });
}
