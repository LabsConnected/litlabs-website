import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import { resolveDbUser } from "@/lib/social-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gallery/[id]/share
 *
 * Shares a gallery item to the Discover feed by creating a post
 * that references the gallery item.
 *
 * Body: { content?: string } — optional caption
 */
async function shareHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth(req).catch(() => ({ userId: null }));
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: { content?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Sharing isn't connected yet." },
      { status: 503 },
    );
  }

  try {
    const client = getAdminSupabase();

    // Verify the gallery item exists and belongs to the caller.
    // NOTE: gallery_items.user_id stores the Clerk user id (see
    // dashboard/gallery-widget-data.ts), so this ownership check stays on the
    // raw Clerk id.
    const { data: item } = await client
      .from("gallery_items")
      .select("id, user_id, title, image_url, video_url, media_type")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!item) {
      return NextResponse.json({ error: "Gallery item not found" }, { status: 404 });
    }

    // posts.user_id is a FK to public.users(id) (UUID) — the raw Clerk id
    // would violate the FK and 500. Resolve the DB row first.
    const dbUser = await resolveDbUser(userId);
    if (!dbUser) {
      return NextResponse.json(
        { error: "Your account isn't fully set up yet — try signing out and back in." },
        { status: 409 },
      );
    }

    // Create a post referencing the gallery item
    const mediaUrls = [item.image_url, item.video_url].filter(Boolean) as string[];
    const postContent = body.content?.trim() || `Check out my creation: ${item.title}`;

    const { data: post, error } = await client
      .from("posts")
      .insert({
        user_id: dbUser.id,
        content: postContent,
        media_urls: mediaUrls,
        gallery_item_id: id,
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, postId: post.id });
  } catch {
    return NextResponse.json({ error: "Failed to share" }, { status: 500 });
  }
}

export const POST = withRateLimit(shareHandler, 20, 60);
