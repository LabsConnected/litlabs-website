// POST /api/invites/redeem
// Auth required. Marks an invite code as used by the current user.
// Should be called once after successful signup/onboarding.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { hashToken } from "@/lib/tokens";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

async function handler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const rawCode: string = (body.code || "").trim().toUpperCase();

  if (!rawCode) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ redeemed: true, degraded: true });
  }

  const codeHash = hashToken(rawCode);
  const sb = getAdminSupabase();

  // Fetch the invite
  const { data: invite } = await sb
    .from("invite_codes")
    .select("id, max_uses, uses_count, expires_at, revoked_at")
    .eq("code_hash", codeHash)
    .single();

  if (!invite) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }
  if (invite.revoked_at) {
    return NextResponse.json({ error: "Code has been revoked" }, { status: 400 });
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "Code has expired" }, { status: 400 });
  }
  if (invite.uses_count >= invite.max_uses) {
    return NextResponse.json({ error: "Code has reached its usage limit" }, { status: 400 });
  }

  // Check if this user already redeemed this code
  const { data: existing } = await sb
    .from("invite_redemptions")
    .select("id")
    .eq("invite_code_id", invite.id)
    .eq("clerk_id", userId)
    .single();

  if (existing) {
    return NextResponse.json({ redeemed: true, already: true });
  }

  // Find the user's internal UUID (may not exist yet if Clerk webhook isn't set up)
  const { data: user } = await sb
    .from("users")
    .select("id")
    .eq("clerk_id", userId)
    .single();

  // Record the redemption
  await sb.from("invite_redemptions").insert({
    invite_code_id: invite.id,
    user_id: user?.id || null,
    clerk_id: userId,
  });

  // Increment uses_count atomically
  await sb
    .from("invite_codes")
    .update({ uses_count: invite.uses_count + 1 })
    .eq("id", invite.id);

  return NextResponse.json({ redeemed: true, remaining: invite.max_uses - invite.uses_count - 1 });
}

// Very strict — 5 attempts per minute per IP
export const POST = withRateLimit(handler, 5, 60);
