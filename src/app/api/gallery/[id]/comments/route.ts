import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gallery/[id]/comments
 * Returns comments for a gallery item.
 *
 * POST /api/gallery/[id]/comments
 * Adds a comment to a gallery item.
 */
async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth(request).catch(() => ({ userId: null }));
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ comments: [] });
  }

  try {
    const client = getAdminSupabase();
    const { data } = await client
      .from("gallery_comments")
      .select("id, author_name, text, created_at")
      .eq("gallery_item_id", id)
      .order("created_at", { ascending: true })
      .limit(50);

    return NextResponse.json({ comments: data ?? [] });
  } catch {
    return NextResponse.json({ comments: [] });
  }
}

async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth(request).catch(() => ({ userId: null }));
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: { text: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.text?.trim()) {
    return NextResponse.json({ error: "Comment text required" }, { status: 400 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ ok: true, comment: { id: "local", text: body.text, createdAt: new Date().toISOString() } });
  }

  try {
    const client = getAdminSupabase();
    const { data } = await client
      .from("gallery_comments")
      .insert({
        gallery_item_id: id,
        user_id: userId,
        text: body.text.trim(),
      })
      .select("id, text, created_at")
      .single();

    return NextResponse.json({ ok: true, comment: data });
  } catch {
    return NextResponse.json({ error: "Failed to add comment" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler, 60, 60);
export const POST = withRateLimit(postHandler, 20, 60);
