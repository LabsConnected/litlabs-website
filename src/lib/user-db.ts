// User Database Operations — Clerk + Supabase Integration
// Uses admin client server-side, anon client browser-side. Graceful when unconfigured.

import type { SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;
let _anon: SupabaseClient | null = null;

function getDb(): SupabaseClient | null {
  // Server-side: try admin first
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
  // Browser-side: use anon client
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
  bio: string | null;
  website: string | null;
  location: string | null;
  created_at: string;
  updated_at: string;
};

export type UserPreferences = {
  id: string;
  user_id: string;
  theme_mode: string;
  theme_skin: string;
  theme_accent: string;
  crt_enabled: boolean;
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

  // Use upsert with onConflict so duplicate calls are idempotent
  await db.from("user_preferences").upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
  await db.from("wallets").upsert({ user_id: user.id, balance: 500 }, { onConflict: "user_id", ignoreDuplicates: true });

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
): Promise<UserPreferences | null> {
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
  return data as UserPreferences;
}

/** Update user preferences */
export async function updateUserPreferences(
  clerkId: string,
  updates: Partial<
    Omit<UserPreferences, "id" | "user_id" | "created_at" | "updated_at">
  >,
) {
  const db = getDb();
  if (!db) throw new Error("Database not configured");
  const user = await getUserByClerkId(clerkId);
  if (!user) throw new Error("User not found");
  const { data, error } = await db
    .from("user_preferences")
    .upsert({
      user_id: user.id,
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to update preferences: ${error.message}`);
  return data as UserPreferences;
}

/** Get user wallet — auto-creates user+wallet if missing. Returns balance:0 fallback only if DB is truly unreachable. */
export async function getUserWallet(clerkId: string): Promise<Wallet> {
  const db = getDb();
  if (db) {
    try {
      let user = await getUserByClerkId(clerkId);

      // Auto-ensure: if user row missing, create it before bailing
      if (!user) {
        const { user: ensured } = await getOrCreateUser(
          clerkId,
          `${clerkId}@placeholder.local`,
          "",
        );
        user = ensured ?? null;
      }

      if (user) {
        const { data } = await db
          .from("wallets")
          .select("*")
          .eq("user_id", user.id)
          .single();
        if (data) return data as Wallet;
        // Wallet row missing — create with default 500 coins
        const { data: created } = await db
          .from("wallets")
          .insert({ user_id: user.id, balance: 500 })
          .select()
          .single();
        if (created) return created as Wallet;
      }
    } catch {
      // DB query failed — fall through to zero-balance fallback
    }
  }

  // True fallback: DB unreachable — return 0 balance so UI reflects reality
  return {
    id: "fallback",
    user_id: clerkId,
    balance: 0,
    last_claim_date: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Update wallet balance. Pass `absolute: true` to set a fixed value; otherwise amount is treated as a delta. */
export async function updateWalletBalance(
  clerkId: string,
  amount: number,
  options?: { absolute?: boolean; lastClaimDate?: string },
) {
  const { absolute = false, lastClaimDate } = options || {};
  const db = getDb();

  if (!db) {
    throw new Error("Database not configured — cannot persist wallet update");
  }

  let user = await getUserByClerkId(clerkId);
  if (!user) {
    // Auto-ensure user row before failing
    const { user: ensured } = await getOrCreateUser(
      clerkId,
      `${clerkId}@placeholder.local`,
      "",
    );
    user = ensured ?? null;
  }
  if (!user) throw new Error(`User not found for clerkId: ${clerkId}`);

  let targetBalance = amount;
  if (!absolute) {
    const { data: wallet } = await db
      .from("wallets")
      .select("balance")
      .eq("user_id", user.id)
      .single();
    targetBalance = (wallet?.balance ?? 0) + amount;
    if (targetBalance < 0) throw new Error("Insufficient balance");
  }

  const { data, error } = await db
    .from("wallets")
    .update({
      balance: targetBalance,
      ...(lastClaimDate && { last_claim_date: lastClaimDate }),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .select()
    .single();
  if (error) throw new Error(`Failed to update wallet: ${error.message}`);
  return data as Wallet;
}

/** Claim daily bonus */
export async function claimDailyBonus(
  clerkId: string,
  bonusAmount: number = 50,
) {
  const wallet = await getUserWallet(clerkId);
  const today = new Date().toISOString().split("T")[0];
  if (wallet.last_claim_date === today)
    throw new Error("Daily bonus already claimed");
  return updateWalletBalance(clerkId, wallet.balance + bonusAmount, {
    absolute: true,
    lastClaimDate: today,
  });
}
