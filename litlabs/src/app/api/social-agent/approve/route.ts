import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

type ApproveBody = {
  postId?: string;
  action?: "approve" | "reject" | "edit";
  caption?: string;
  scheduledAt?: string;
};

async function handler(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ApproveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { postId, action, caption, scheduledAt } = body;
  if (!postId || typeof postId !== "string") {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }
  if (!action || !["approve", "reject", "edit"].includes(action)) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (action === "approve") {
      update.status = "approved";
      if (scheduledAt) update.scheduled_at = scheduledAt;
    } else if (action === "reject") {
      update.status = "rejected";
    } else if (action === "edit") {
      update.status = "draft";
      if (caption !== undefined) update.caption = caption;
    }

    const { data: post, error } = await supabaseAdmin
      .from("social_posts")
      .update(update)
      .eq("id", postId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json({ post });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 30, 60);
