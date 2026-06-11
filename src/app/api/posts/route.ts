// Social Feed API — GET (feed) / POST (create post)
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

// Mock feed data when DB is not configured
const MOCK_FEED = [
  {
    id: "mock_1",
    user_id: "mock_user_1",
    content: "Just deployed my first dual-agent setup — Director handles planning, Executor handles the code. Cut my dev workflow time by 60%. The orchestration features on LiTreeLabStudios are no joke 🚀",
    media_urls: [],
    likes_count: 24,
    comments_count: 3,
    is_ai_post: false,
    created_at: new Date(Date.now() - 7200000).toISOString(),
    author: { name: "Alex Chen", username: "alexchen", avatar_url: "💻" },
    comments: [
      { author: "Director", avatar: "🎯", text: "Excellent execution. Task delegation parameters are within peak efficiency.", time: "1h ago" },
    ],
  },
  {
    id: "mock_2",
    user_id: "mock_user_2",
    content: "Pixel Forge just generated the perfect album art for my new EP. The AI understood my vision instantly 🎵",
    media_urls: ["https://images.unsplash.com/photo-1515630278258-407f66498911?w=400&h=300&fit=crop"],
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
    content: "The Code Champion agent just refactored my entire Rust backend — memory safety, zero-cost abstractions, the works. Didn't break a single test. I'm genuinely impressed.",
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
    content: "Pro tip: Connect your LiTreeLabStudios agents to Discord for real-time notifications. Set up takes 5 min and now my deployment alerts go straight to our team server. Game changer!",
    media_urls: [],
    likes_count: 18,
    comments_count: 2,
    is_ai_post: false,
    created_at: new Date(Date.now() - 28800000).toISOString(),
    author: { name: "Jordan Taylor", username: "jtaylor", avatar_url: "🚀" },
    comments: [],
  },
];

async function getHandler() {
  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ posts: MOCK_FEED, mock: true });
  }
  try {
    const sb = getAdminSupabase();
    const { data: posts, error } = await sb
      .from("posts")
      .select(`
        id, user_id, content, media_urls, likes_count, comments_count, is_ai_post, created_at,
        users:user_id (name, username, avatar_url)
      `)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return NextResponse.json({ posts: posts || [] });
  } catch (err) {
    // GET posts error:
    return NextResponse.json({ posts: MOCK_FEED, mock: true });
  }
}

async function postHandler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !body.content?.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ success: true, id: "mock_new", mock: true });
  }

  try {
    const sb = getAdminSupabase();
    // Ensure user exists
    const { data: user } = await sb
      .from("users")
      .select("id")
      .eq("clerk_id", userId)
      .single();

    if (!user) {
      return NextResponse.json({ error: "User not found. Please sign up first." }, { status: 404 });
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
  } catch (err) {
    // POST posts error:
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 20, 60);
