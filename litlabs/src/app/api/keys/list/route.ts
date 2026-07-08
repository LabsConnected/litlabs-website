import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import { getDbUserId } from "@/lib/api/auth";
import { unauthorized } from "@/lib/api/response";

async function handler(_req: NextRequest) {
  const dbUserId = await getDbUserId();
  if (!dbUserId) {
    return unauthorized();
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ keys: [] });
  }

  const sb = getAdminSupabase();
  const { data, error } = await sb
    .from("api_keys")
    .select("id, name, prefix, scopes, last_used_at, revoked_at, created_at")
    .eq("user_id", dbUserId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }

  return NextResponse.json({ keys: data || [] });
}

export const GET = withRateLimit(handler, 60, 60);
