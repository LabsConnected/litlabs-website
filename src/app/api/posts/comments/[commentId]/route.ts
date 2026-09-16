// Single comment — PATCH (owner edits) / DELETE (owner; cascades replies)
// DB-backed only. Errors return 500.
import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import { requireAuthDbUser } from "@/lib/social-feed";

async function patchHandler(req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const { commentId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 2000) {
    return NextResponse.json({ error: "Content must be 1..2000 characters" }, { status: 400 });
  }

  const sb = getAdminSupabase();
  const { data: existing } = await sb.from("post_comments").select("user_id").eq("id", commentId).single();
  if (!existing) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  if (existing.user_id !== dbUser.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: updated, error } = await sb
    .from("post_comments")
    .update({ content, edited_at: new Date().toISOString() })
    .eq("id", commentId)
    .select("id, post_id, user_id, parent_comment_id, content, likes_count, created_at, edited_at")
    .single();
  if (error || !updated) {
    return NextResponse.json({ error: "Failed to update comment" }, { status: 500 });
  }
  return NextResponse.json({ comment: updated });
}

async function deleteHandler(req: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const { commentId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const sb = getAdminSupabase();
  const { data: existing } = await sb.from("post_comments").select("user_id, post_id").eq("id", commentId).single();
  if (!existing) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  if (existing.user_id !== dbUser.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await sb.from("post_comments").delete().eq("id", commentId);
  if (error) {
    return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 });
  }
  return NextResponse.json({ deleted: true });
}

export const PATCH = withRateLimit(patchHandler, 30, 60);
export const DELETE = withRateLimit(deleteHandler, 30, 60);
