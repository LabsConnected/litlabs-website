import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client factory.
 *
 * Returns null when env vars are missing or placeholder so the app
 * degrades gracefully instead of throwing "supabaseUrl is required".
 * Callers must null-check the return value.
 */
export function createClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (
    !url ||
    url.length < 10 ||
    !url.startsWith("http") ||
    !key ||
    key.length < 10
  ) {
    return null;
  }
  return createBrowserClient(url, key);
}
