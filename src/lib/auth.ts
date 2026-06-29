import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function auth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  // Build-safe: if Supabase isn't configured, treat as anonymous
  if (!url || !key || url.length < 10 || key.length < 10) {
    return { userId: null };
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {}
      },
    },
  });
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id ?? null;
  return { userId };
}
