// GET /api/keys/list
// Auth required. Returns the current user's API keys (prefix/name/metadata — never the hash or raw key).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

async function handler(_req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ keys: [] });
  }

  const sb = getAdminSupabase();
  const { data, error } = await sb
    .from("api_keys")
    .select("id, name, prefix, scopes, last_used_at, revoked_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }

  return NextResponse.json({ keys: data || [] });
}

export const GET = withRateLimit(handler, 60, 60);
