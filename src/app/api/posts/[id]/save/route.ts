// Post Saves — GET {saved} / POST (save) / DELETE (unsave)
// DB-backed only. Errors return 500.
import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import { requireAuthDbUser } from "@/lib/social-feed";

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const sb = getAdminSupabase();
  const { data, error } = await sb
    .from("post_saves")
    .select("id")
    .match({ post_id: postId, user_id: dbUser.id })
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Failed to check save" }, { status: 500 });
  }
  return NextResponse.json({ saved: !!data });
}

async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const sb = getAdminSupabase();
  const { data: post } = await sb.from("posts").select("id").eq("id", postId).single();
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const { data: existing } = await sb
    .from("post_saves")
    .select("id")
    .match({ post_id: postId, user_id: dbUser.id })
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ saved: true });
  }

  const { error } = await sb.from("post_saves").insert({ post_id: postId, user_id: dbUser.id });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ saved: true });
    }
    return NextResponse.json({ error: "Failed to save post" }, { status: 500 });
  }
  await sb.rpc("increment_post_saves", { post_id: postId });
  return NextResponse.json({ saved: true }, { status: 201 });
}

async function deleteHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const sb = getAdminSupabase();
  const { data: existing } = await sb
    .from("post_saves")
    .select("id")
    .match({ post_id: postId, user_id: dbUser.id })
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ saved: false });
  }

  const { error } = await sb.from("post_saves").delete().match({ post_id: postId, user_id: dbUser.id });
  if (error) {
    return NextResponse.json({ error: "Failed to unsave post" }, { status: 500 });
  }
  await sb.rpc("decrement_post_saves", { post_id: postId });
  return NextResponse.json({ saved: false });
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 30, 60);
export const DELETE = withRateLimit(deleteHandler, 30, 60);
