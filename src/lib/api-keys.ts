// src/lib/api-keys.ts
// Server-side helper: validate an incoming API key from a request's Authorization header.
// Usage in any protected route:
//
//   import { validateApiKey } from "@/lib/api-keys";
//   const auth = await validateApiKey(req, ["agents:run"]);
//   if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

import type { NextRequest } from "next/server";
import { hashToken, extractBearerToken } from "@/lib/tokens";
import { isAdminSupabaseConfigured, getAdminSupabase } from "@/lib/supabase-admin";
import { createHash } from "crypto";

export interface ApiKeyAuthResult {
  ok: boolean;
  userId?: string;
  scopes?: string[];
  keyId?: string;
  error?: string;
}

/**
 * Validates an API key from the Authorization header.
 * Checks: exists → not revoked → scopes satisfied (if provided) → records usage.
 *
 * @param req      The incoming NextRequest
 * @param scopes   Optional array of required scopes. Empty = any valid key works.
 * @param endpoint Override for the endpoint logged in api_key_usage (defaults to req.nextUrl.pathname)
 */
export async function validateApiKey(
  req: NextRequest,
  scopes: string[] = [],
  endpoint?: string,
): Promise<ApiKeyAuthResult> {
  const raw = extractBearerToken(req.headers.get("authorization"));

  if (!raw || !raw.startsWith("lit_live_")) {
    return { ok: false, error: "Missing or invalid API key" };
  }

  if (!isAdminSupabaseConfigured()) {
    // DB not configured — allow in dev/staging so you don't get locked out
    return { ok: true, userId: "degraded", scopes: [], error: undefined };
  }

  const keyHash = hashToken(raw);
  const sb = getAdminSupabase();

  const { data: key } = await sb
    .from("api_keys")
    .select("id, user_id, scopes, revoked_at")
    .eq("key_hash", keyHash)
    .single();

  if (!key) {
    return { ok: false, error: "Invalid API key" };
  }
  if (key.revoked_at) {
    return { ok: false, error: "API key has been revoked" };
  }

  // Scope check
  if (scopes.length > 0) {
    const keyScopes: string[] = key.scopes || [];
    const missing = scopes.filter((s) => !keyScopes.includes(s));
    if (missing.length > 0) {
      return { ok: false, error: `Missing required scopes: ${missing.join(", ")}` };
    }
  }

  // Record usage (fire-and-forget, don't block the response)
  const logEntry = async () => {
    try {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 16);
      await sb.from("api_key_usage").insert({
        api_key_id: key.id,
        endpoint: endpoint || req.nextUrl.pathname,
        ip_hash: ipHash,
        status: null, // status is unknown at validation time; update after response if needed
      });
      // Update last_used_at
      await sb
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", key.id);
    } catch {
      // Non-critical — don't fail the request over usage logging
    }
  };
  logEntry();

  return {
    ok: true,
    userId: key.user_id,
    scopes: key.scopes || [],
    keyId: key.id,
  };
}
