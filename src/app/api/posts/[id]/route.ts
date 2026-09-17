// Single post — GET (visibility-checked) / PATCH (owner) / DELETE (owner)
// DB-backed only. No mocks: errors return 500.
import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import { getPostDTO, requireAuthDbUser, resolveDbUser } from "@/lib/social-feed";
import { auth } from "@/lib/auth";

const VISIBILITIES = ["public", "followers", "crew", "private"] as const;

async function getViewerDbId(req: NextRequest): Promise<string | null> {
  const { userId } = await auth(req);
  if (!userId) return null;
  return (await resolveDbUser(userId))?.id ?? null;
}

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewerDbId = await getViewerDbId(req);
  const dto = await getPostDTO(id, viewerDbId);
  if (!dto) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  return NextResponse.json({ post: dto });
}

async function patchHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const sb = getAdminSupabase();
  const { data: existing } = await sb.from("posts").select("user_id").eq("id", id).single();
  if (!existing) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  if (existing.user_id !== dbUser.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.content !== undefined) {
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content || content.length > 5000) {
      return NextResponse.json({ error: "Content must be 1..5000 characters" }, { status: 400 });
    }
    updates.content = content;
  }
  if (body.visibility !== undefined) {
    if (!(VISIBILITIES as readonly string[]).includes(body.visibility)) {
      return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
    }
    updates.visibility = body.visibility;
  }
  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await sb.from("posts").update(updates).eq("id", id);
  if (error) {
    return NextResponse.json({ error: "Failed to update post" }, { status: 500 });
  }
  const dto = await getPostDTO(id, dbUser.id);
  return NextResponse.json({ post: dto });
}

async function deleteHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const sb = getAdminSupabase();
  const { data: existing } = await sb.from("posts").select("user_id").eq("id", id).single();
  if (!existing) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  if (existing.user_id !== dbUser.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await sb.from("posts").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: "Failed to delete post" }, { status: 500 });
  }
  return NextResponse.json({ deleted: true });
}

export const GET = withRateLimit(getHandler, 100, 60);
export const PATCH = withRateLimit(patchHandler, 30, 60);
export const DELETE = withRateLimit(deleteHandler, 30, 60);
