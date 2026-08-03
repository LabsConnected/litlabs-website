// src/app/api/music/tracks/[trackId]/route.ts
// GET    /api/music/tracks/[trackId]   — fetch one track (owner or public)
// PATCH  /api/music/tracks/[trackId]   — update title/visibility (owner only)
// DELETE /api/music/tracks/[trackId]   — delete track + R2 audio (owner only)
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limiter";
import {
  resolveTrackAudioUrl,
  deleteTrack,
} from "@/lib/music/generation-service";
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { success, resetTime } = await rateLimit(req, 60, 60);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(resetTime) } });
  }

  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { trackId } = await params;
    const userId = await resolveUserId(clerkId);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
    }

    const { data: track, error } = await admin
      .from("music_tracks")
      .select("*")
      .eq("id", trackId)
      .maybeSingle();

    if (error || !track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    // Owner or public only. Unlisted is treated as private for direct fetches
    // (unlisted tracks are only meant to be accessed via a shared link with a
    // signed URL — not enumerated).
    const isOwner = track.user_id === userId;
    if (!isOwner && track.visibility !== "public") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let audioUrl: string | null = null;
    try {
      audioUrl = await resolveTrackAudioUrl(
        track.audio_storage_key as string,
        track.visibility as TrackVisibility,
      );
    } catch {
      audioUrl = null;
    }

    return NextResponse.json({ track: { ...track, audioUrl } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch track";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { success, resetTime } = await rateLimit(req, 20, 60);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(resetTime) } });
  }

  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { trackId } = await params;
    const userId = await resolveUserId(clerkId);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (typeof body.title === "string" && body.title.trim()) {
      updates.title = body.title.trim();
    }
    if (
      typeof body.visibility === "string" &&
      ["private", "unlisted", "public"].includes(body.visibility)
    ) {
      updates.visibility = body.visibility;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
    }

    // Verify ownership.
    const { data: existing } = await admin
      .from("music_tracks")
      .select("user_id")
      .eq("id", trackId)
      .maybeSingle();
    if (!existing || existing.user_id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: track, error } = await admin
      .from("music_tracks")
      .update(updates)
      .eq("id", trackId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ track });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update track";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { success, resetTime } = await rateLimit(req, 20, 60);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(resetTime) } });
  }

  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { trackId } = await params;
    const userId = await resolveUserId(clerkId);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const deleted = await deleteTrack(trackId, userId);
    if (!deleted) {
      return NextResponse.json({ error: "Track not found or not owned by user" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to delete track";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
