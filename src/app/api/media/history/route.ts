import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET /api/media/history
 * Returns the user's playback history.
 */
export async function GET() {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const { data, error } = await admin
    .from("media_playback_history")
    .select("*")
    .eq("user_id", session.userId)
    .order("played_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ history: data ?? [] });
}

/**
 * POST /api/media/history
 * Records a playback event.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    provider?: string;
    sourceUrl?: string;
    title?: string;
    creator?: string;
    artworkUrl?: string;
    durationMs?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.sourceUrl || !body.provider) {
    return NextResponse.json({ error: "sourceUrl and provider are required" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const { data, error } = await admin
    .from("media_playback_history")
    .insert({
      user_id: session.userId,
      provider: body.provider,
      source_url: body.sourceUrl,
      title: body.title ?? null,
      creator: body.creator ?? null,
      artwork_url: body.artworkUrl ?? null,
      duration_ms: body.durationMs ?? null,
      played_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entry: data });
}
