import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (
    !supabaseUrl ||
    !supabaseKey ||
    supabaseKey.includes("your-anon") ||
    supabaseKey.length < 10
  ) {
    // Return null instead of crashing during static prerendering
    return null;
  }
  if (!_supabase) {
    _supabase = createClient(supabaseUrl, supabaseKey);
  }
  return _supabase;
}

// Build-Safe Proxy Engine — returns a no-op chainable stub when Supabase is not configured
const STUB_METHODS = new Set(["from", "auth", "channel", "storage", "rpc"]);
const CHAIN_STUB: Record<string, () => unknown> = {};
const chainable = () => new Proxy(CHAIN_STUB, {
  get(_, p) {
    if (p === "then") return undefined; // not a thenable
    if (typeof p === "string") return chainable;
    return undefined;
  },
});
for (const m of ["select", "insert", "update", "delete", "upsert", "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is", "not", "or", "and", "order", "limit", "offset", "range", "single", "maybeSingle", "throwOnError", "then", "catch", "finally", "contains", "containedBy", "overlaps", "match", "filter", "textSearch", "rpc"]) {
  CHAIN_STUB[m] = chainable;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabase();
    if (!client) {
      if (typeof prop === "string" && STUB_METHODS.has(prop)) return chainable;
      return undefined;
    }
    return (client as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// Server-only admin client using service role key (bypasses RLS - server routes only)
let _supabaseAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey || serviceKey.length < 10) {
    return null;
  }
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabaseAdmin;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin();
    if (!client) {
      return typeof prop === "string" && ["from"].includes(prop)
        ? () => ({ select: () => ({}), insert: () => ({}), update: () => ({}) })
        : undefined;
    }
    return (client as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// Types for database tables
export type Agent = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  avatar_url: string;
  system_prompt: string;
  personality: string;
  price_cents: number;
  is_public: boolean;
  features: string[];
  created_at: string;
};

export type UserAgent = {
  id: string;
  user_id: string;
  agent_id: string;
  installed_at: string;
  agent?: Agent;
};

export type Conversation = {
  id: string;
  user_id: string;
  agent_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  agent?: Agent;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};
