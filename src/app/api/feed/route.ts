import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

async function getHandler(req: NextRequest) {
  try {
    if (!isAdminSupabaseConfigured()) {
      return NextResponse.json({ posts: [], mock: true });
    }

    const sb = getAdminSupabase();
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");

    const { data: posts, error } = await sb
      .from("posts")
      .select(`
        id,
        user_id,
        content,
        media_urls,
        likes_count,
        comments_count,
        is_ai_post,
        created_at,
        users:user_id (name, username, avatar_url)
      `)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Fetch comments for each post
    const postIds = posts?.map(p => p.id) || [];
    let commentsMap: Record<string, any[]> = {};
    
    if (postIds.length > 0) {
      const { data: comments } = await sb
        .from("comments")
        .select(`
          id,
          post_id,
          user_id,
          content,
          created_at,
          users:user_id (name, username, avatar_url)
        `)
        .in("post_id", postIds)
        .order("created_at", { ascending: true });

      if (comments) {
        commentsMap = comments.reduce((acc, c) => {
          if (!acc[c.post_id]) acc[c.post_id] = [];
          acc[c.post_id].push(c);
          return acc;
        }, {} as Record<string, any[]>);
      }
    }

    const enrichedPosts = (posts || []).map(post => ({
      ...post,
      author: post.users,
      comments: commentsMap[post.id] || [],
      users: undefined,
    }));

    return NextResponse.json({ posts: enrichedPosts, mock: false });
  } catch {
    return NextResponse.json({ posts: [], mock: true });
  }
}

async function postHandler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const hasContent = body?.content?.trim();
  const hasMedia = body?.media_urls?.length > 0;
  
  if (!body || (!hasContent && !hasMedia)) {
    return NextResponse.json({ error: "Content or media is required" }, { status: 400 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ success: true, id: "mock_new", mock: true });
  }

  try {
    const sb = getAdminSupabase();
    let { data: user } = await sb.from("users").select("id").eq("clerk_id", userId).single();

    if (!user) {
      const shortId = userId.slice(-8);
      const { data: newUser, error: createError } = await sb
        .from("users")
        .insert({
          clerk_id: userId,
          username: `user_${shortId}`,
          display_name: `LiTBit User ${shortId}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      
      if (createError) {
        return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
      }
      
      user = newUser;
      await sb.from("wallets").insert({ user_id: user.id, balance: 500, lifetime_earned: 500 });
    }

    const { data: post, error } = await sb
      .from("posts")
      .insert({
        user_id: user.id,
        content: body.content.trim(),
        media_urls: body.media_urls || [],
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, post });
  } catch {
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 20, 60);