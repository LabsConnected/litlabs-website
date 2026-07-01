// POST /api/invites/validate
// Public (no auth required). Checks if an invite code is valid without consuming it.
// Used to give real-time feedback on a code entry field.
import { NextRequest, NextResponse } from "next/server";
import { hashToken } from "@/lib/tokens";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

async function handler(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rawCode: string = (body.code || "").trim().toUpperCase();

  if (!rawCode || rawCode.length < 6) {
    return NextResponse.json({ valid: false, error: "No code provided" }, { status: 400 });
  }

  if (!isAdminSupabaseConfigured()) {
    // Graceful degradation: DB not set up yet — accept any code so onboarding isn't blocked
    return NextResponse.json({ valid: true, degraded: true });
  }

  const codeHash = hashToken(rawCode);
  const sb = getAdminSupabase();
  const { data } = await sb
    .from("invite_codes")
    .select("id, max_uses, uses_count, expires_at, revoked_at")
    .eq("code_hash", codeHash)
    .single();

  if (!data) {
    return NextResponse.json({ valid: false, error: "Invalid code" });
  }
  if (data.revoked_at) {
    return NextResponse.json({ valid: false, error: "Code has been revoked" });
  }
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ valid: false, error: "Code has expired" });
  }
  if (data.uses_count >= data.max_uses) {
    return NextResponse.json({ valid: false, error: "Code has reached its usage limit" });
  }

  return NextResponse.json({
    valid: true,
    remaining: data.max_uses - data.uses_count,
  });
}

// Stricter rate limit on validation to prevent brute-force guessing
export const POST = withRateLimit(handler, 20, 60);
