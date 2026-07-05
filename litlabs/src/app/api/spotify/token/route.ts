import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  });
  if (!res.ok) return null;
  return res.json();
}

// GET /api/spotify/token — returns a valid access token (refreshes if needed)
export async function GET() {
  const jar = await cookies();
  const accessToken = jar.get("sp_access_token")?.value;
  const refreshToken = jar.get("sp_refresh_token")?.value;
  const expiresAt = Number(jar.get("sp_expires_at")?.value ?? 0);

  if (!refreshToken) {
    return NextResponse.json({ error: "not_connected" }, { status: 401 });
  }

  // Token still valid with 60s buffer
  if (accessToken && Date.now() < expiresAt - 60_000) {
    return NextResponse.json({ access_token: accessToken });
  }

  // Refresh
  const fresh = await refreshAccessToken(refreshToken);
  if (!fresh?.access_token) {
    return NextResponse.json({ error: "refresh_failed" }, { status: 401 });
  }

  const res = NextResponse.json({ access_token: fresh.access_token });
  res.cookies.set("sp_access_token", fresh.access_token, {
    httpOnly: true, secure: true, sameSite: "lax",
    maxAge: fresh.expires_in, path: "/",
  });
  res.cookies.set("sp_expires_at", String(Date.now() + fresh.expires_in * 1000), {
    httpOnly: true, secure: true, sameSite: "lax",
    maxAge: 60 * 60 * 24 * 180, path: "/",
  });
  return res;
}

// DELETE /api/spotify/token — disconnect Spotify
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("sp_access_token");
  res.cookies.delete("sp_refresh_token");
  res.cookies.delete("sp_expires_at");
  return res;
}
