// DELETE /api/keys/revoke/[id]
// Auth required. Revokes an API key by setting revoked_at.
// Users can only revoke their own keys.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

async function handler(
  _req: NextRequest,
  ctx?: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ctx?.params) {
    return NextResponse.json(
      { error: "Missing route params" },
      { status: 400 },
    );
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  const sb = getAdminSupabase();

  // Verify ownership before revoking
  const { data: key } = await sb
    .from("api_keys")
    .select("id, user_id, revoked_at")
    .eq("id", id)
    .single();

  if (!key) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }
  if (key.user_id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (key.revoked_at) {
    return NextResponse.json({ revoked: true, already: true });
  }

  const { error } = await sb
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to revoke key" },
      { status: 500 },
    );
  }

  return NextResponse.json({ revoked: true });
}

export const DELETE = withRateLimit(handler as (req: NextRequest, ctx?: unknown) => Promise<NextResponse>, 30, 60);
