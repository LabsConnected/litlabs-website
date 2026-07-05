import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

type ScheduleBody = { postId?: string };

async function handler(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ScheduleBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { postId } = body;
  if (!postId || typeof postId !== "string") {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const { data: post, error } = await supabaseAdmin
      .from("social_posts")
      .select("status")
      .eq("id", postId)
      .eq("user_id", userId)
      .single();

    if (error) throw error;
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (post.status !== "approved") {
      return NextResponse.json({ error: "Post must be approved before scheduling" }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("social_posts")
      .update({ status: "scheduled", updated_at: new Date().toISOString() })
      .eq("id", postId)
      .eq("user_id", userId)
      .select()
      .single();

    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      post: updated,
      note: "Scheduled locally. Buffer/Publer integration coming soon.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 30, 60);
