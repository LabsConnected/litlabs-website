// Public user profile summary — GET. No auth required.
// DB-backed only. Errors return 500.
import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import { auth } from "@/lib/auth";
import { isPostVisibleTo, resolveDbUser } from "@/lib/social-feed";

async function getHandler(req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  if (!username || username.length > 64) {
    return NextResponse.json({ error: "Invalid username" }, { status: 400 });
  }

  const sb = getAdminSupabase();
  const { data: user } = await sb
    .from("users")
    .select("id, username, name, avatar_url, bio, website, location")
    .eq("username", username)
    .single();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { userId } = await auth(req);
  const viewerDbId = userId ? (await resolveDbUser(userId))?.id ?? null : null;

  const [{ count: postRows }, { count: followersCount }, { count: followingCount }, viewerFollow] = await Promise.all([
    sb.from("posts").select("id, visibility", { count: "exact", head: false }).eq("user_id", user.id),
    sb.from("follows").select("id", { count: "exact", head: true }).eq("followee_id", user.id),
    sb.from("follows").select("id", { count: "exact", head: true }).eq("follower_id", user.id),
    viewerDbId && viewerDbId !== user.id
      ? sb.from("follows").select("id").match({ follower_id: viewerDbId, followee_id: user.id }).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Post count reflects what the viewer can actually see
  const isFollowing = !!viewerFollow?.data;
  const postsCount = ((postRows ?? []) as { visibility: string | null }[]).filter((p) =>
    isPostVisibleTo({ user_id: user.id, visibility: p.visibility }, viewerDbId, isFollowing),
  ).length;

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.name ?? user.username,
      avatarUrl: user.avatar_url ?? null,
      coverUrl: null, // no cover column yet — Phase 2 media work will add it
      bio: user.bio ?? null,
      website: user.website ?? null,
      location: user.location ?? null,
      counts: {
        posts: postsCount,
        followers: followersCount ?? 0,
        following: followingCount ?? 0,
      },
      viewer: {
        following: isFollowing,
      },
    },
  });
}

export const GET = withRateLimit(getHandler, 100, 60);
