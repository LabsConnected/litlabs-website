// User Database Operations — Clerk + Supabase Integration
// Uses admin client server-side, anon client browser-side. Graceful when unconfigured.

import type { SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;
let _anon: SupabaseClient | null = null;

function getDb(): SupabaseClient | null {
  // Server-side: try admin first
  if (typeof window === "undefined") {
    try {
      const { getAdminSupabase } = require("./supabase-admin");
      if (!_admin) _admin = getAdminSupabase();
      return _admin;
    } catch {
      // admin not configured — fall through to anon
    }
    try {
      const { getSupabase } = require("./supabase");
      if (!_anon) _anon = getSupabase();
      return _anon;
    } catch {
      return null;
    }
  }
  // Browser-side: use anon client
  try {
    const { getSupabase } = require("./supabase");
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
export async function getOrCreateUser(clerkId: string, email: string, name?: string | null) {
  const db = getDb();
  if (!db) {
    // Supabase not configured — returning mock user
    return { user: null as unknown as UserProfile, isNew: true };
  }

  const { data: existing } = await db.from("users").select("*").eq("clerk_id", clerkId).single();
  if (existing) return { user: existing as UserProfile, isNew: false };

  const { data: user, error: createError } = await db
    .from("users")
    .insert({ clerk_id: clerkId, email, name: name || email.split("@")[0], username: email.split("@")[0] })
    .select()
    .single();

  if (createError || !user) {
    // Failed to create user:
    return { user: null as unknown as UserProfile, isNew: false };
  }

  await db.from("user_preferences").insert({ user_id: user.id });
  await db.from("wallets").insert({ user_id: user.id, balance: 500 });

  return { user: user as UserProfile, isNew: true };
}

/** Get user profile by Clerk ID */
export async function getUserByClerkId(clerkId: string): Promise<UserProfile | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db.from("users").select("*").eq("clerk_id", clerkId).single();
  if (error || !data) return null;
  return data as UserProfile;
}

/** Update user profile */
export async function updateUserProfile(
  clerkId: string,
  updates: Partial<Omit<UserProfile, "id" | "clerk_id" | "email" | "created_at" | "updated_at">>
) {
  const db = getDb();
  if (!db) throw new Error("Database not configured");
  const user = await getUserByClerkId(clerkId);
  if (!user) throw new Error("User not found");
  const { data, error } = await db.from("users").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", user.id).select().single();
  if (error) throw new Error(`Failed to update profile: ${error.message}`);
  return data as UserProfile;
}

/** Get user preferences */
export async function getUserPreferences(clerkId: string): Promise<UserPreferences | null> {
  const db = getDb();
  if (!db) return null;
  const user = await getUserByClerkId(clerkId);
  if (!user) return null;
  const { data, error } = await db.from("user_preferences").select("*").eq("user_id", user.id).single();
  if (error || !data) return null;
  return data as UserPreferences;
}

/** Update user preferences */
export async function updateUserPreferences(
  clerkId: string,
  updates: Partial<Omit<UserPreferences, "id" | "user_id" | "created_at" | "updated_at">>
) {
  const db = getDb();
  if (!db) throw new Error("Database not configured");
  const user = await getUserByClerkId(clerkId);
  if (!user) throw new Error("User not found");
  const { data, error } = await db.from("user_preferences").upsert({ user_id: user.id, ...updates, updated_at: new Date().toISOString() }).select().single();
  if (error) throw new Error(`Failed to update preferences: ${error.message}`);
  return data as UserPreferences;
}

/** Get user wallet — auto-creates with 500 coins if missing */
export async function getUserWallet(clerkId: string): Promise<Wallet | null> {
  const db = getDb();
  if (!db) return null;
  const user = await getUserByClerkId(clerkId);
  if (!user) return null;
  const { data, error } = await db.from("wallets").select("*").eq("user_id", user.id).single();
  if (!error && data) return data as Wallet;
  // Wallet missing — create with default 500 coins
  const { data: created, error: createErr } = await db
    .from("wallets")
    .insert({ user_id: user.id, balance: 500 })
    .select()
    .single();
  if (createErr || !created) return null;
  return created as Wallet;
}

/** Update wallet balance */
export async function updateWalletBalance(clerkId: string, newBalance: number, lastClaimDate?: string) {
  const db = getDb();
  if (!db) throw new Error("Database not configured");
  const user = await getUserByClerkId(clerkId);
  if (!user) throw new Error("User not found");
  const { data, error } = await db.from("wallets").update({ balance: newBalance, ...(lastClaimDate && { last_claim_date: lastClaimDate }), updated_at: new Date().toISOString() }).eq("user_id", user.id).select().single();
  if (error) throw new Error(`Failed to update wallet: ${error.message}`);
  return data as Wallet;
}

/** Claim daily bonus */
export async function claimDailyBonus(clerkId: string, bonusAmount: number = 50) {
  const wallet = await getUserWallet(clerkId);
  if (!wallet) throw new Error("Wallet not found");
  const today = new Date().toISOString().split("T")[0];
  if (wallet.last_claim_date === today) throw new Error("Daily bonus already claimed");
  return updateWalletBalance(clerkId, wallet.balance + bonusAmount, today);
}
