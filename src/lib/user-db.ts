// User Database Operations — Clerk + Supabase Integration
// Uses admin client server-side, anon client browser-side. Graceful when unconfigured.

import type { SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;
let _anon: SupabaseClient | null = null;

function getDb(): SupabaseClient | null {
  if (typeof window === "undefined") {
    try {
      const { getAdminSupabase } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("./supabase-admin");
      if (!_admin) _admin = getAdminSupabase();
      return _admin;
    } catch {
      // admin not configured — fall through to anon
    }
    try {
      const { getSupabase } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("./supabase");
      if (!_anon) _anon = getSupabase();
      return _anon;
    } catch {
      return null;
    }
  }
  try {
    const { getSupabase } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("./supabase");
    if (!_anon) _anon = getSupabase();
    return _anon;
  } catch {
    return null;
  }
}

export type UserProfile = {
  id: string;
  clerk_id: string;
  email: string;
  name: string | null;
  username: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  bio: string | null;
  website: string | null;
  location: string | null;
  created_at: string;
  updated_at: string;
};

export type UserPreferenceRow = {
  id: string;
  user_id: string;
  theme_mode: string;
  theme_skin: string;
  theme_accent: string;
  crt_enabled: boolean;
  notify_discord: string | null;
  notify_alexa: boolean | null;
  notify_email: boolean | null;
  workspace_autosave: boolean | null;
  workspace_compact: boolean | null;
  workspace_live_preview: boolean | null;
  workspace_telemetry: boolean | null;
  workspace_default: string | null;
  created_at: string;
  updated_at: string;
};

export type Wallet = {
  id: string;
  user_id: string;
  balance: number;
  last_claim_date: string | null;
  created_at: string;
  updated_at: string;
};

/** Get or create user by Clerk ID */
export async function getOrCreateUser(
  clerkId: string,
  email: string,
  name?: string | null,
) {
  const db = getDb();
  if (!db) {
    // Supabase not configured — returning mock user
    return { user: null as unknown as UserProfile, isNew: true };
  }

  const { data: existing } = await db
    .from("users")
    .select("*")
    .eq("clerk_id", clerkId)
    .single();
  if (existing) return { user: existing as UserProfile, isNew: false };

  const { data: user, error: createError } = await db
    .from("users")
    .insert({
      clerk_id: clerkId,
      email,
      name: name || email.split("@")[0],
      username: email.split("@")[0],
    })
    .select()
    .single();

  if (createError || !user) {
    // Failed to create user:
    return { user: null as unknown as UserProfile, isNew: false };
  }

  await db.from("user_preferences").insert({ user_id: user.id });
  // No wallets row: credit_ledger is the authoritative balance system.
  // The Starter 500 grant is issued lazily by getCreditBalances with an
  // idempotency key, so nothing needs to be written here.

  return { user: user as UserProfile, isNew: true };
}

/** Get user profile by Clerk ID */
export async function getUserByClerkId(
  clerkId: string,
): Promise<UserProfile | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("clerk_id", clerkId)
    .single();
  if (error || !data) return null;
  return data as UserProfile;
}

/** Update user profile */
export async function updateUserProfile(
  clerkId: string,
  updates: Partial<
    Omit<UserProfile, "id" | "clerk_id" | "email" | "created_at" | "updated_at">
  >,
) {
  const db = getDb();
  if (!db) throw new Error("Database not configured");
  const user = await getUserByClerkId(clerkId);
  if (!user) throw new Error("User not found");
  const { data, error } = await db
    .from("users")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", user.id)
    .select()
    .single();
  if (error) throw new Error(`Failed to update profile: ${error.message}`);
  return data as UserProfile;
}

/** Get user preferences */
export async function getUserPreferences(
  clerkId: string,
): Promise<UserPreferenceRow | null> {
  const db = getDb();
  if (!db) return null;
  const user = await getUserByClerkId(clerkId);
  if (!user) return null;
  const { data, error } = await db
    .from("user_preferences")
    .select("*")
    .eq("user_id", user.id)
    .single();
  if (error || !data) return null;
  return data as UserPreferenceRow;
}

/** Upsert user preferences */
export async function upsertUserPreferences(
  userId: string,
  updates: Partial<
    Omit<
      UserPreferenceRow,
      "id" | "user_id" | "created_at" | "updated_at"
    >
  >,
) {
  const db = getDb();
  if (!db)
    throw new Error("Database not configured");
  const { data, error } = await db
    .from("user_preferences")
    .upsert({
      user_id: userId,
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error)
    throw new Error(
      `Failed to update preferences: ${error.message}`,
    );
  return data as UserPreferenceRow;
}

/**
 * Get user wallet — canonical balance from credit_ledger via
 * get_user_balances. Throws on failure: the previous synthetic
 * "9999 LiTTBits" fallback reported a fake balance whenever the
 * database was unreachable, and the wallets table is not a
 * balance source anymore.
 */
export async function getUserWallet(clerkId: string): Promise<Wallet> {
  // Lazy import: this module predates the server-only split and is
  // structured for dual client/server bundling — resolve the ledger at
  // call time so a stray client import fails at the call site, not at
  // bundle time.
  const { getCreditBalances } = await import("@/lib/wallet-ledger");
  const balances = await getCreditBalances(clerkId);
  const now = new Date().toISOString();
  return {
    id: "ledger",
    user_id: clerkId,
    balance: balances.total,
    last_claim_date: balances.lastDailyClaim,
    created_at: now,
    updated_at: now,
  };
}
