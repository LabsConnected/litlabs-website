// Post Like / Unlike API — DB-backed only. Honest 503 when the backend
// isn't connected (CI, unconfigured envs); errors never masquerade as success.
import { NextRequest, NextResponse } from "next/server";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import { requireAuthDbUser } from "@/lib/social-feed";

async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Honest 503 when the backend isn't connected — checked before auth so an
  // unconfigured backend never 500s.
  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Likes are unavailable — the community feed isn't connected yet." },
      { status: 503 },
    );
  }

  const { id: postId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const sb = getAdminSupabase();
  const { data: post } = await sb.from("posts").select("user_id").eq("id", postId).single();
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const { error } = await sb.from("post_likes").insert({ post_id: postId, user_id: dbUser.id });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Already liked" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to like post" }, { status: 500 });
  }
  await sb.rpc("increment_post_likes", { post_id: postId });

  // Notify post owner (skip if liking own post)
  if (post.user_id !== dbUser.id) {
    await sb.from("notifications").insert({
      recipient_id: post.user_id,
      actor_id: dbUser.id,
      type: "like",
      entity_type: "post",
      entity_id: postId,
      content: "liked your post",
    });
  }

  return NextResponse.json({ liked: true });
}

async function deleteHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Likes are unavailable — the community feed isn't connected yet." },
      { status: 503 },
    );
  }

  const { id: postId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const sb = getAdminSupabase();
  const { data: existing } = await sb
    .from("post_likes")
    .select("id")
    .match({ post_id: postId, user_id: dbUser.id })
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ liked: false });
  }

  const { error } = await sb.from("post_likes").delete().match({ post_id: postId, user_id: dbUser.id });
  if (error) {
    return NextResponse.json({ error: "Failed to unlike post" }, { status: 500 });
  }
  await sb.rpc("decrement_post_likes", { post_id: postId });
  return NextResponse.json({ liked: false });
}

export const POST = withRateLimit(postHandler, 50, 60);
export const DELETE = withRateLimit(deleteHandler, 50, 60);
