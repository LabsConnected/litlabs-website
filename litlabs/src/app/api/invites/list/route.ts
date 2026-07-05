// GET /api/invites/list
// Admin-only: return all invite codes (without their hashes) for the admin dashboard.
// DELETE /api/invites/list — revoke by id (body: { id })
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

const ADMIN_IDS = (process.env.ADMIN_CLERK_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

function isAdmin(userId: string) {
  return ADMIN_IDS.length === 0 || ADMIN_IDS.includes(userId);
}

async function getHandler(_req: NextRequest) {
  const { userId } = await auth();
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ codes: [] });
  }

  const sb = getAdminSupabase();
  const { data, error } = await sb
    .from("invite_codes")
    .select("id, label, created_by, max_uses, uses_count, expires_at, revoked_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch codes" }, { status: 500 });
  }

  return NextResponse.json({ codes: data || [] });
}

async function deleteHandler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const id: string = body.id || "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const sb = getAdminSupabase();
  const { error } = await sb
    .from("invite_codes")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to revoke code" }, { status: 500 });
  }

  return NextResponse.json({ revoked: true });
}

export const GET = withRateLimit(getHandler, 60, 60);
export const DELETE = withRateLimit(deleteHandler, 30, 60);
