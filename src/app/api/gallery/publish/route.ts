import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gallery/publish
 *
 * Publishes a private asset to the public gallery.
 * Body: { itemId, title, prompt?, toolUsed?, providerUsed?, projectName?, projectId? }
 *
 * Sets is_public = true and updates metadata.
 */
async function publishHandler(req: NextRequest) {
  const { userId } = await auth(req).catch(() => ({ userId: null }));
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    itemId: string;
    title?: string;
    prompt?: string;
    toolUsed?: string;
    providerUsed?: string;
    projectName?: string;
    projectId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.itemId) {
    return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ ok: true, published: true, id: body.itemId });
  }

  try {
    const client = getAdminSupabase();

    // Verify ownership before publishing
    const { data: item } = await client
      .from("gallery_items")
      .select("id, user_id")
      .eq("id", body.itemId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!item) {
      return NextResponse.json({ error: "Item not found or not owned by you" }, { status: 404 });
    }

    // Publish — set is_public and update metadata
    const update: Record<string, unknown> = { is_public: true, updated_at: new Date().toISOString() };
    if (body.title) update.title = body.title;
    if (body.prompt) update.prompt = body.prompt;
    if (body.toolUsed) update.tool_used = body.toolUsed;
    if (body.providerUsed) update.provider_used = body.providerUsed;
    if (body.projectName) update.project_name = body.projectName;
    if (body.projectId) update.project_id = body.projectId;

    const { error } = await client
      .from("gallery_items")
      .update(update)
      .eq("id", body.itemId)
      .eq("user_id", userId);

    if (error) {
      return NextResponse.json({ error: "Failed to publish" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, published: true, id: body.itemId });
  } catch {
    return NextResponse.json({ error: "Failed to publish" }, { status: 500 });
  }
}

export const POST = withRateLimit(publishHandler, 20, 60);
