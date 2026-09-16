// Post Share — increments shares_count, returns the canonical post URL.
// DB-backed only. Errors return 500.
import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import { getPostDTO, requireAuthDbUser, resolveDbUser } from "@/lib/social-feed";
import { auth } from "@/lib/auth";

async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const sb = getAdminSupabase();
  const { data: post } = await sb.from("posts").select("id, shares_count").eq("id", postId).single();
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const { error } = await sb.rpc("increment_post_shares", { post_id: postId });
  if (error) {
    return NextResponse.json({ error: "Failed to record share" }, { status: 500 });
  }

  return NextResponse.json({
    shared: true,
    shares: (post.shares_count ?? 0) + 1,
    url: `/post/${postId}`,
  });
}

// Unsigned share-count read is fine (counts are public metadata); auth the
// increment path above so share counts can't be farmed anonymously.
async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const { userId } = await auth(req);
  const viewerDbId = userId ? (await resolveDbUser(userId))?.id ?? null : null;
  const dto = await getPostDTO(postId, viewerDbId);
  if (!dto) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  return NextResponse.json({ shares: dto.counts.shares, url: `/post/${postId}` });
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 30, 60);
