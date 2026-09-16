// Post Repost / Unrepost — DB-backed only. Errors return 500.
import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import { requireAuthDbUser } from "@/lib/social-feed";

async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const sb = getAdminSupabase();
  const { data: post } = await sb.from("posts").select("user_id").eq("id", postId).single();
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const { error } = await sb.from("post_reposts").insert({ post_id: postId, user_id: dbUser.id });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Already reposted" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to repost" }, { status: 500 });
  }
  await sb.rpc("increment_post_reposts", { post_id: postId });

  if (post.user_id !== dbUser.id) {
    await sb.from("notifications").insert({
      recipient_id: post.user_id,
      actor_id: dbUser.id,
      type: "repost",
      entity_type: "post",
      entity_id: postId,
      content: "reposted your post",
    });
  }

  return NextResponse.json({ reposted: true }, { status: 201 });
}

async function deleteHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const sb = getAdminSupabase();
  const { data: existing } = await sb
    .from("post_reposts")
    .select("id")
    .match({ post_id: postId, user_id: dbUser.id })
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ reposted: false });
  }

  const { error } = await sb.from("post_reposts").delete().match({ post_id: postId, user_id: dbUser.id });
  if (error) {
    return NextResponse.json({ error: "Failed to remove repost" }, { status: 500 });
  }
  await sb.rpc("decrement_post_reposts", { post_id: postId });
  return NextResponse.json({ reposted: false });
}

export const POST = withRateLimit(postHandler, 30, 60);
export const DELETE = withRateLimit(deleteHandler, 30, 60);
