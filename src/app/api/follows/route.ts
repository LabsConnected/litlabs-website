// Follows API — GET (list) / POST (follow) / DELETE (unfollow)
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

async function getHandler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "following"; // "following" | "followers"
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ follows: [], mock: true });
  }

  try {
    const sb = getAdminSupabase();
    const { data: user } = await sb.from("users").select("id").eq("clerk_id", userId).single();
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const column = type === "followers" ? "followee_id" : "follower_id";
    const joinColumn = type === "followers" ? "follower_id" : "followee_id";

    const { data, error } = await sb
      .from("follows")
      .select(`created_at, users!follows_${joinColumn}_fkey(name, username, avatar_url)`)
      .eq(column, user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return NextResponse.json({ follows: data || [] });
  } catch {
    return NextResponse.json({ follows: [], mock: true });
  }
}

async function postHandler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.followee_id) {
    return NextResponse.json({ error: "followee_id is required" }, { status: 400 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ success: true, mock: true });
  }

  try {
    const sb = getAdminSupabase();
    const { data: user } = await sb.from("users").select("id").eq("clerk_id", userId).single();
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { data, error } = await sb
      .from("follows")
      .insert({ follower_id: user.id, followee_id: body.followee_id })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "Already following" }, { status: 409 });
      if (error.code === "23514") return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });
      throw error;
    }
    return NextResponse.json({ success: true, follow: data });
  } catch {
    return NextResponse.json({ success: true, mock: true });
  }
}

async function deleteHandler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const followeeId = searchParams.get("followee_id");
  if (!followeeId) return NextResponse.json({ error: "followee_id is required" }, { status: 400 });

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ success: true, mock: true });
  }

  try {
    const sb = getAdminSupabase();
    const { data: user } = await sb.from("users").select("id").eq("clerk_id", userId).single();
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { error } = await sb.from("follows").delete().match({ follower_id: user.id, followee_id: followeeId });
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true, mock: true });
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 30, 60);
export const DELETE = withRateLimit(deleteHandler, 30, 60);
