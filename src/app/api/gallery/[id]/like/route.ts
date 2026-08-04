import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gallery/[id]/like
 * Toggles like on a gallery item.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth(request).catch(() => ({ userId: null }));
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ ok: true, liked: true, likes: 0 });
  }

  try {
    const client = getAdminSupabase();

    // Check if already liked
    const { data: existing } = await client
      .from("gallery_likes")
      .select("id")
      .eq("gallery_item_id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      // Unlike
      await client
        .from("gallery_likes")
        .delete()
        .eq("gallery_item_id", id)
        .eq("user_id", userId);

      await client.rpc("decrement_gallery_likes", { item_id: id });
      return NextResponse.json({ ok: true, liked: false });
    } else {
      // Like
      await client
        .from("gallery_likes")
        .insert({ gallery_item_id: id, user_id: userId });

      await client.rpc("increment_gallery_likes", { item_id: id });
      return NextResponse.json({ ok: true, liked: true });
    }
  } catch {
    return NextResponse.json({ error: "Failed to toggle like" }, { status: 500 });
  }
}
