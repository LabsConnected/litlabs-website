import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

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
    return NextResponse.json({ ok: true, postId: "local" });
  }

  try {
    const client = getAdminSupabase();

    // Verify the gallery item exists and is public
    const { data: item } = await client
      .from("gallery_items")
      .select("id, user_id, title, image_url, video_url, media_type")
      .eq("id", id)
      .maybeSingle();

    if (!item) {
      return NextResponse.json({ error: "Gallery item not found" }, { status: 404 });
    }

    // Create a post referencing the gallery item
    const mediaUrls = [item.image_url, item.video_url].filter(Boolean) as string[];
    const postContent = body.content?.trim() || `Check out my creation: ${item.title}`;

    const { data: post, error } = await client
      .from("posts")
      .insert({
        user_id: userId,
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
