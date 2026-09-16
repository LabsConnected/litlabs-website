// Poll vote — POST {optionId}. One vote per user per poll (409), 410 if closed.
// DB-backed only. Errors return 500.
import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import { getPostDTO, requireAuthDbUser } from "@/lib/social-feed";

async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const body = await req.json().catch(() => null);
  const optionId = typeof body?.optionId === "string" && body.optionId ? body.optionId : null;
  if (!optionId) {
    return NextResponse.json({ error: "optionId is required" }, { status: 400 });
  }

  // Post must exist, be a poll, and be visible to the voter
  const dto = await getPostDTO(postId, dbUser.id);
  if (!dto) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  if (!dto.poll) {
    return NextResponse.json({ error: "Post has no poll" }, { status: 400 });
  }
  if (dto.poll.endsAt && new Date(dto.poll.endsAt).getTime() <= Date.now()) {
    return NextResponse.json({ error: "Poll is closed" }, { status: 410 });
  }

  const sb = getAdminSupabase();

  // Sequential, transaction-ish: check existing vote first, then option, then write.
  const { data: existingVote } = await sb
    .from("poll_votes")
    .select("id")
    .match({ poll_id: dto.poll.id, user_id: dbUser.id })
    .maybeSingle();
  if (existingVote) {
    return NextResponse.json({ error: "Already voted in this poll" }, { status: 409 });
  }

  const { data: option } = await sb
    .from("poll_options")
    .select("id, votes_count")
    .eq("id", optionId)
    .eq("poll_id", dto.poll.id)
    .single();
  if (!option) {
    return NextResponse.json({ error: "Invalid optionId for this poll" }, { status: 400 });
  }

  const { error: voteError } = await sb.from("poll_votes").insert({
    poll_id: dto.poll.id,
    option_id: optionId,
    user_id: dbUser.id,
  });
  if (voteError) {
    if (voteError.code === "23505") {
      return NextResponse.json({ error: "Already voted in this poll" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to record vote" }, { status: 500 });
  }

  const { error: rpcError } = await sb.rpc("increment_poll_option_votes", { option_id: optionId });
  if (rpcError) {
    return NextResponse.json({ error: "Failed to record vote" }, { status: 500 });
  }

  return NextResponse.json({ voted: true, optionId, votes: (option.votes_count ?? 0) + 1 }, { status: 201 });
}

export const POST = withRateLimit(postHandler, 30, 60);
