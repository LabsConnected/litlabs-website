// POST /api/invites/create
// Admin-only: generate a new invite code and store its hash in Supabase.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateInviteCode, hashToken } from "@/lib/tokens";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

const ADMIN_IDS = (process.env.ADMIN_CLERK_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

async function handler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(userId)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const label: string = body.label || "";
  const maxUses: number = Math.max(1, Math.min(1000, Number(body.max_uses) || 1));
  const expiresAt: string | null = body.expires_at || null;

  const rawCode = generateInviteCode();
  const codeHash = hashToken(rawCode);

  const sb = getAdminSupabase();
  const { data, error } = await sb
    .from("invite_codes")
    .insert({
      code_hash: codeHash,
      label: label || null,
      created_by: userId,
      max_uses: maxUses,
      expires_at: expiresAt,
    })
    .select("id, label, max_uses, uses_count, expires_at, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create invite code" }, { status: 500 });
  }

  // Return the raw code once — it will never be retrievable again
  return NextResponse.json({
    code: rawCode,
    id: data.id,
    label: data.label,
    max_uses: data.max_uses,
    uses_count: data.uses_count,
    expires_at: data.expires_at,
    created_at: data.created_at,
  });
}

export const POST = withRateLimit(handler, 30, 60);
