// Post Like / Unlike API
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";
import { rateLimit } from "@/lib/rate-limiter";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { success, remaining, resetTime } = await rateLimit(req, 50, 60);
  if (!success) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "Retry-After": String(resetTime),
        "X-RateLimit-Limit": "50",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetTime),
      },
    });
  }

  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: postId } = await params;
  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ success: true, mock: true });
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

    await sb
      .from("post_likes")
      .insert({ post_id: postId, user_id: user.id })
      .select();
    await sb.rpc("increment_post_likes", { post_id: postId });

    // Notify post owner (skip if liking own post)
    if (post && post.user_id !== user.id) {
      await sb.from("notifications").insert({
        recipient_id: post.user_id,
        actor_id: user.id,
        type: "like",
        entity_type: "post",
        entity_id: postId,
        content: "liked your post",
      });
    }

    const response = NextResponse.json({ success: true });
    response.headers.set("X-RateLimit-Limit", "50");
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    response.headers.set("X-RateLimit-Reset", String(resetTime));
    return response;
  } catch {
    return NextResponse.json({ success: true, mock: true });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { success, remaining, resetTime } = await rateLimit(req, 50, 60);
  if (!success) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "Retry-After": String(resetTime),
        "X-RateLimit-Limit": "50",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetTime),
      },
    });
  }

  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: postId } = await params;
  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ success: true, mock: true });
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

    await sb
      .from("post_likes")
      .delete()
      .match({ post_id: postId, user_id: user.id });
    await sb.rpc("decrement_post_likes", { post_id: postId });
    const response = NextResponse.json({ success: true });
    response.headers.set("X-RateLimit-Limit", "50");
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    response.headers.set("X-RateLimit-Reset", String(resetTime));
    return response;
  } catch {
    return NextResponse.json({ success: true, mock: true });
  }
}
