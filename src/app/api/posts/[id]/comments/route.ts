// Post Comments API — GET / POST
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";
import { rateLimit } from "@/lib/rate-limiter";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { success, remaining, resetTime } = rateLimit(req, 100, 60);
  if (!success) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "Retry-After": String(resetTime),
        "X-RateLimit-Limit": "100",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetTime),
      },
    });
  }

  const { id: postId } = await params;
  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ comments: [] });
  }
  try {
    const sb = getAdminSupabase();
    const { data, error } = await sb
      .from("post_comments")
      .select(
        "id, content, created_at, users:user_id (name, username, avatar_url)",
      )
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const response = NextResponse.json({ comments: data || [] });
    response.headers.set("X-RateLimit-Limit", "100");
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    response.headers.set("X-RateLimit-Reset", String(resetTime));
    return response;
  } catch {
    // GET comments error:
    return NextResponse.json({ comments: [] });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { success, remaining, resetTime } = rateLimit(req, 30, 60);
  if (!success) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "Retry-After": String(resetTime),
        "X-RateLimit-Limit": "30",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetTime),
      },
    });
  }

  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: postId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !body.content?.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({
      success: true,
      comment: {
        id: "mock_c",
        content: body.content.trim(),
        created_at: new Date().toISOString(),
        users: { name: "You", username: "you", avatar_url: "🔥" },
      },
      mock: true,
    });
  }

  try {
    const sb = getAdminSupabase();
    const { data: user } = await sb
      .from("users")
      .select("id")
      .eq("clerk_id", userId)
      .single();
    if (!user)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Get post owner for notification
    const { data: post } = await sb
      .from("posts")
      .select("user_id")
      .eq("id", postId)
      .single();

    const { data: comment, error } = await sb
      .from("post_comments")
      .insert({
        post_id: postId,
        user_id: user.id,
        content: body.content.trim(),
      })
      .select(
        "id, content, created_at, users:user_id (name, username, avatar_url)",
      )
      .single();

    if (error) throw error;
    await sb.rpc("increment_post_comments", { post_id: postId });

    // Notify post owner (skip if commenting on own post)
    if (post && post.user_id !== user.id) {
      await sb.from("notifications").insert({
        recipient_id: post.user_id,
        actor_id: user.id,
        type: "comment",
        entity_type: "post",
        entity_id: postId,
        content: `commented: "${body.content.trim().slice(0, 40)}${body.content.trim().length > 40 ? "..." : ""}"`,
      });
    }

    const response = NextResponse.json({ success: true, comment });
    response.headers.set("X-RateLimit-Limit", "30");
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    response.headers.set("X-RateLimit-Reset", String(resetTime));
    return response;
  } catch {
    // POST comment error:
    return NextResponse.json(
      { error: "Failed to create comment" },
      { status: 500 },
    );
  }
}
