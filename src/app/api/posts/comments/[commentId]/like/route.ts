// Comment Like / Unlike — DB-backed only. Errors return 500.
import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import { requireAuthDbUser } from "@/lib/social-feed";

async function postHandler(req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const { commentId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const sb = getAdminSupabase();
  const { data: comment } = await sb.from("post_comments").select("id").eq("id", commentId).single();
  if (!comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  const { error } = await sb.from("comment_likes").insert({ comment_id: commentId, user_id: dbUser.id });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Already liked" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to like comment" }, { status: 500 });
  }
  await sb.rpc("increment_comment_likes", { comment_id: commentId });
  return NextResponse.json({ liked: true }, { status: 201 });
}

async function deleteHandler(req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const { commentId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const sb = getAdminSupabase();
  const { data: existing } = await sb
    .from("comment_likes")
    .select("id")
    .match({ comment_id: commentId, user_id: dbUser.id })
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ liked: false });
  }

  const { error } = await sb.from("comment_likes").delete().match({ comment_id: commentId, user_id: dbUser.id });
  if (error) {
    return NextResponse.json({ error: "Failed to unlike comment" }, { status: 500 });
  }
  await sb.rpc("decrement_comment_likes", { comment_id: commentId });
  return NextResponse.json({ liked: false });
}

export const POST = withRateLimit(postHandler, 50, 60);
export const DELETE = withRateLimit(deleteHandler, 50, 60);
