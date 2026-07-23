// Social Feed API — GET (feed) / POST (create post)
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

// Mock feed data when DB is not configured
const MOCK_FEED = [
  {
    id: "mock_1",
    user_id: "mock_user_1",
    content:
      "Just deployed my first dual-agent setup — Director handles planning, Executor handles the code. Cut my dev workflow time by 60%. The orchestration features on LiTTree-LabStudios are no joke 🚀",
    media_urls: [],
    likes_count: 24,
    comments_count: 3,
    is_ai_post: false,
    created_at: new Date(Date.now() - 7200000).toISOString(),
    author: { name: "Alex Chen", username: "alexchen", avatar_url: "💻" },
    comments: [
      {
        author: "Director",
        avatar: "🎯",
        text: "Excellent execution. Task delegation parameters are within peak efficiency.",
        time: "1h ago",
      },
    ],
  },
  {
    id: "mock_2",
    user_id: "mock_user_2",
    content:
      "Pixel Forge just generated the perfect album art for my new EP. The AI understood my vision instantly 🎵",
    media_urls: [
      "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=1600&h=1600&fit=crop&q=80",
    ],
    likes_count: 56,
    comments_count: 12,
    is_ai_post: false,
    created_at: new Date(Date.now() - 14400000).toISOString(),
    author: { name: "Sarah Kim", username: "sarahk", avatar_url: "🎨" },
    comments: [],
  },
  {
    id: "mock_3",
    user_id: "mock_user_3",
    content:
      "The Code Champion agent just refactored my entire Rust backend — memory safety, zero-cost abstractions, the works. Didn't break a single test. I'm genuinely impressed.",
    media_urls: [],
    likes_count: 42,
    comments_count: 1,
    is_ai_post: false,
    created_at: new Date(Date.now() - 21600000).toISOString(),
    author: { name: "Mike Dev", username: "mikedev", avatar_url: "⚡" },
    comments: [],
  },
  {
    id: "mock_4",
    user_id: "mock_user_4",
    content:
      "Pro tip: Connect your LiTTree-LabStudios agents to Discord for real-time notifications. Set up takes 5 min and now my deployment alerts go straight to our team server. Game changer!",
    media_urls: [],
    likes_count: 18,
    comments_count: 2,
    is_ai_post: false,
    created_at: new Date(Date.now() - 28800000).toISOString(),
    author: { name: "Jordan Taylor", username: "jtaylor", avatar_url: "🚀" },
    comments: [],
  },
];

async function getHandler(req: NextRequest) {
  try {
    if (!isAdminSupabaseConfigured()) {
      return NextResponse.json({ posts: MOCK_FEED, mock: true });
    }
    const sb = getAdminSupabase();
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("filter"); // "all" | "following"

    let query = sb
      .from("posts")
      .select(
        `
        id, user_id, content, media_urls, likes_count, comments_count, is_ai_post, created_at,
        users:user_id (name, username, avatar_url)
      `,
      )
      .order("created_at", { ascending: false })
      .limit(50);

    if (filter === "following") {
      const { userId } = await auth();
      if (userId) {
        const { data: user } = await sb
          .from("users")
          .select("id")
          .eq("clerk_id", userId)
          .single();
        if (user) {
          const { data: follows } = await sb
            .from("follows")
            .select("followee_id")
            .eq("follower_id", user.id);
          const followeeIds = (follows || []).map((f) => f.followee_id);
          if (followeeIds.length > 0) {
            query = query.in("user_id", followeeIds);
          } else {
            // No follows yet — return empty so UI can show "Discover people" prompt
            return NextResponse.json({ posts: [], empty_following: true });
          }
        }
      }
    }

    const { data: posts, error } = await query;
    if (error) throw error;
    return NextResponse.json({ posts: posts || [] });
  } catch {
    return NextResponse.json({ posts: MOCK_FEED, mock: true });
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
    return NextResponse.json(
      { error: "Content or media is required" },
      { status: 400 },
    );
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ success: true, id: "mock_new", mock: true });
  }

  try {
    const sb = getAdminSupabase();
    // Ensure user exists - create if not found
    let { data: user } = await sb
      .from("users")
      .select("id")
      .eq("clerk_id", userId)
      .single();

    if (!user) {
      // Auto-create user from Clerk data
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
        return NextResponse.json(
          { error: "Failed to create user" },
          { status: 500 },
        );
      }

      user = newUser;
      if (!user) {
        return NextResponse.json(
          { error: "Failed to create user" },
          { status: 500 },
        );
      }

      // Create initial wallet
      await sb.from("wallets").insert({
        user_id: user!.id,
        balance: 500,
        lifetime_earned: 500,
      });
    }

    const { data: post, error } = await sb
      .from("posts")
      .insert({
        user_id: user!.id,
        content: body.content.trim(),
        media_urls: body.media_urls || [],
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, post });
  } catch {
    // POST posts error:
    return NextResponse.json(
      { error: "Failed to create post" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 20, 60);
