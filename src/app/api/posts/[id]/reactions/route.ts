// Post emoji reactions — POST {emoji} / DELETE (remove viewer's reaction)
// DB-backed only. Errors return 500.
import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import { requireAuthDbUser } from "@/lib/social-feed";

// Matches the frontend ReactionBar APPROVED_REACTIONS (src/components/feed/ReactionBar.tsx)
const ALLOWED_EMOJI = ["❤️", "🔥", "👍", "👏", "😂", "😮", "😢", "😡", "🎉", "💯", "🤝", "🚀"];

async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const body = await req.json().catch(() => null);
  const emoji = body?.emoji;
  if (typeof emoji !== "string" || !ALLOWED_EMOJI.includes(emoji)) {
    return NextResponse.json({ error: `emoji must be one of: ${ALLOWED_EMOJI.join(" ")}` }, { status: 400 });
  }

  const sb = getAdminSupabase();
  const { data: post } = await sb.from("posts").select("id").eq("id", postId).single();
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const { error } = await sb.from("post_reactions").insert({ post_id: postId, user_id: dbUser.id, emoji });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Reaction already added" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to add reaction" }, { status: 500 });
  }
  return NextResponse.json({ reacted: true, emoji }, { status: 201 });
}

async function deleteHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const body = await req.json().catch(() => null);
  const emoji = body?.emoji;

  const sb = getAdminSupabase();
  let query = sb.from("post_reactions").delete().match({ post_id: postId, user_id: dbUser.id });
  if (typeof emoji === "string") {
    query = query.eq("emoji", emoji);
  }
  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: "Failed to remove reaction" }, { status: 500 });
  }
  return NextResponse.json({ reacted: false });
}

export const POST = withRateLimit(postHandler, 50, 60);
export const DELETE = withRateLimit(deleteHandler, 50, 60);
