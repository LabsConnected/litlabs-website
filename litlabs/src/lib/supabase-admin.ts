// Server-side Supabase admin client
// Uses SERVICE_ROLE_KEY to bypass RLS (auth handled by Clerk in API routes)
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

let _client: SupabaseClient | null = null;

export function getAdminSupabase(): SupabaseClient {
  if (!url || !key) {
    throw new Error("Admin Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (!_client) {
    _client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _client;
}

export const isAdminSupabaseConfigured = () => {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return !!(u && k && !u.includes("your-project") && !k.includes("your-anon"));
};
