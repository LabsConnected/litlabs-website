import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateApiKey } from "@/lib/tokens";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { supabase } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";
import { supabaseAdmin } from "@/lib/supabase";

async function getUserId() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  return user?.id ?? null;
}

async function handler(req: NextRequest) {
  const dbUserId = await getUserId();
  if (!dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
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
    .eq("user_id", dbUserId)
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
      user_id: dbUserId,
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

  return NextResponse.json({
    key: raw,
    id: data.id,
    name: data.name,
    prefix: data.prefix,
    scopes: data.scopes,
    created_at: data.created_at,
  });
}

export const POST = withRateLimit(handler, 10, 60);
