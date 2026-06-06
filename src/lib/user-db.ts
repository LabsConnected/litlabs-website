// User Database Operations - Clerk + Supabase Integration
import { supabase } from "./supabase";

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

/**
 * Get or create user by Clerk ID
 * Call this when a user signs in via Clerk
 */
export async function getOrCreateUser(clerkId: string, email: string, name?: string | null) {
  // Try to find existing user
  const { data: existing, error: findError } = await supabase
    .from("users")
    .select("*")
    .eq("clerk_id", clerkId)
    .single();

  if (existing) {
    return { user: existing as UserProfile, isNew: false };
  }

  // Create new user
  const { data: user, error: createError } = await supabase
    .from("users")
    .insert({
      clerk_id: clerkId,
      email,
      name: name || email.split("@")[0],
      username: email.split("@")[0],
    })
    .select()
    .single();

  if (createError) {
    throw new Error(`Failed to create user: ${createError.message}`);
  }

  // Create default preferences
  await supabase.from("user_preferences").insert({ user_id: user.id }).select().single();

  // Create wallet with starting balance
  await supabase.from("wallets").insert({ user_id: user.id, balance: 500 }).select().single();

  return { user: user as UserProfile, isNew: true };
}

/**
 * Get user profile by Clerk ID
 */
export async function getUserByClerkId(clerkId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("clerk_id", clerkId)
    .single();

  if (error || !data) return null;
  return data as UserProfile;
}

/**
 * Update user profile
 */
export async function updateUserProfile(
  clerkId: string,
  updates: Partial<Omit<UserProfile, "id" | "clerk_id" | "email" | "created_at" | "updated_at">>
) {
  const user = await getUserByClerkId(clerkId);
  if (!user) throw new Error("User not found");

  const { data, error } = await supabase
    .from("users")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", user.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update profile: ${error.message}`);
  return data as UserProfile;
}

/**
 * Get user preferences
 */
export async function getUserPreferences(clerkId: string): Promise<UserPreferences | null> {
  const user = await getUserByClerkId(clerkId);
  if (!user) return null;

  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error || !data) return null;
  return data as UserPreferences;
}

/**
 * Update user preferences
 */
export async function updateUserPreferences(
  clerkId: string,
  updates: Partial<Omit<UserPreferences, "id" | "user_id" | "created_at" | "updated_at">>
) {
  const user = await getUserByClerkId(clerkId);
  if (!user) throw new Error("User not found");

  const { data, error } = await supabase
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

/**
 * Get user wallet
 */
export async function getUserWallet(clerkId: string): Promise<Wallet | null> {
  const user = await getUserByClerkId(clerkId);
  if (!user) return null;

  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error || !data) return null;
  return data as Wallet;
}

/**
 * Update wallet balance
 */
export async function updateWalletBalance(clerkId: string, newBalance: number, lastClaimDate?: string) {
  const user = await getUserByClerkId(clerkId);
  if (!user) throw new Error("User not found");

  const { data, error } = await supabase
    .from("wallets")
    .update({
      balance: newBalance,
      ...(lastClaimDate && { last_claim_date: lastClaimDate }),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update wallet: ${error.message}`);
  return data as Wallet;
}

/**
 * Claim daily bonus
 */
export async function claimDailyBonus(clerkId: string, bonusAmount: number = 50) {
  const wallet = await getUserWallet(clerkId);
  if (!wallet) throw new Error("Wallet not found");

  const today = new Date().toISOString().split("T")[0];
  
  // Check if already claimed today
  if (wallet.last_claim_date === today) {
    throw new Error("Daily bonus already claimed");
  }

  const newBalance = wallet.balance + bonusAmount;
  return updateWalletBalance(clerkId, newBalance, today);
}
