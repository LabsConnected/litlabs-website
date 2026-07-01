// POST /api/keys/create
// Auth required. Generates a new API key for the current user.
// The raw key is returned ONCE in this response — only the hash is stored.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateApiKey } from "@/lib/tokens";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

async function handler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const name: string = (body.name || "").trim();
  const scopes: string[] = Array.isArray(body.scopes) ? body.scopes : [];

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Enforce a reasonable limit per user
  const sb = getAdminSupabase();
  const { count } = await sb
    .from("api_keys")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("revoked_at", null);

  if ((count ?? 0) >= 10) {
    return NextResponse.json(
      { error: "Maximum of 10 active API keys. Revoke one before creating another." },
      { status: 400 }
    );
  }

  const { raw, hash, prefix } = generateApiKey();

  const { data, error } = await sb
    .from("api_keys")
    .insert({
      user_id: userId,
      name,
      prefix,
      key_hash: hash,
      scopes,
    })
    .select("id, name, prefix, scopes, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create API key" }, { status: 500 });
  }

  // Return the raw key ONCE — client must copy it now
  return NextResponse.json({
    key: raw,           // show once, never stored
    id: data.id,
    name: data.name,
    prefix: data.prefix,
    scopes: data.scopes,
    created_at: data.created_at,
  });
}

// Strict limit — creating keys shouldn't happen often
export const POST = withRateLimit(handler, 10, 60);
