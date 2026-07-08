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
  cover_url: string | null;
  bio: string | null;
  website: string | null;
  location: string | null;
  mood: string | null;
  interests: string[] | null;
  social_links: Record<string, string> | null;
  music_links: Record<string, string> | null;
  signup_source: string | null;
  signup_referrer: string | null;
  signup_landing_path: string | null;
  signup_utm: Record<string, string> | null;
  clerk_metadata: Record<string, unknown> | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SignupAttributionInput = {
  source?: string | null;
  referrer?: string | null;
  landingPath?: string | null;
  utm?: Record<string, string> | null;
  clerkMetadata?: Record<string, unknown> | null;
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

export type GetOrCreateUserResult = {
  user: UserProfile | null;
  isNew: boolean;
  error?: string;
};

/** Get or create user by Clerk ID */
export async function getOrCreateUser(
  clerkId: string,
  email: string,
  name?: string | null,
  attribution?: SignupAttributionInput,
): Promise<GetOrCreateUserResult> {
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
  if (existing) {
    const updates = userAttributionUpdates(attribution, false);
    if (Object.keys(updates).length > 0) {
      const { data: updated } = await db
        .from("users")
        .update(updates)
        .eq("id", existing.id)
        .select()
        .single();
      return { user: (updated ?? existing) as UserProfile, isNew: false };
    }
    return { user: existing as UserProfile, isNew: false };
  }

  const { data: user, error: createError } = await db
    .from("users")
    .insert({
      clerk_id: clerkId,
      email,
      name: name || email.split("@")[0],
      display_name: name || email.split("@")[0],
      username: email.split("@")[0],
      plan: "free",
      ...userAttributionUpdates(attribution, true),
    })
    .select()
    .single();

  if (createError || !user) {
    const msg = createError?.message || "Unknown database error";
    // Failed to create user:
    return { user: null as unknown as UserProfile, isNew: false, error: msg };
  }

  const { error: prefsError } = await db
    .from("user_preferences")
    .insert({ user_id: user.id });
  if (prefsError) {
    console.error(
      `[user-db] Failed to create preferences for user ${user.id}:`,
      prefsError.message,
    );
  }
  const { error: walletError } = await db
    .from("wallets")
    .insert({ user_id: user.id, balance: 500 });
  if (walletError) {
    console.error(
      `[user-db] Failed to create wallet for user ${user.id}:`,
      walletError.message,
    );
  }

  return { user: user as UserProfile, isNew: true };
}

function userAttributionUpdates(attribution: SignupAttributionInput | undefined, isNew: boolean) {
  const updates: Record<string, unknown> = {
    last_seen_at: new Date().toISOString(),
  };

  if (!attribution) return updates;

  if (isNew || attribution.source) updates.signup_source = attribution.source || "direct";
  if (isNew || attribution.referrer) updates.signup_referrer = attribution.referrer || null;
  if (isNew || attribution.landingPath) updates.signup_landing_path = attribution.landingPath || null;
  if (isNew || attribution.utm) updates.signup_utm = attribution.utm || {};
  if (attribution.clerkMetadata) updates.clerk_metadata = attribution.clerkMetadata;

  return updates;
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

/** Get user wallet — auto-creates with 500 coins if missing. Returns synthetic wallet on ANY failure. */
export async function getUserWallet(clerkId: string): Promise<Wallet> {
  const db = getDb();
  if (db) {
    try {
      const user = await getUserByClerkId(clerkId);
      if (user) {
        const { data } = await db
          .from("wallets")
          .select("*")
          .eq("user_id", user.id)
          .single();
        if (data) return data as Wallet;
        // Wallet missing — create with default 500 coins
        const { data: created, error: createError } = await db
          .from("wallets")
          .insert({ user_id: user.id, balance: 500 })
          .select()
          .single();
        if (createError) {
          console.error(
            `[user-db] Failed to create wallet for user ${user.id}:`,
            createError.message,
          );
        }
        if (created) return created as Wallet;
      }
    } catch (err) {
      // DB query failed — log and fall through to synthetic wallet
      console.error(
        `[user-db] getUserWallet DB query failed for ${clerkId}, using fallback wallet:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Fallback: Use localStorage for wallet persistence when Supabase isn't configured
  const storageKey = `litlabs-wallet-${clerkId}`;
  let stored: string | null = null;
  try {
    stored =
      typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
  } catch {
    // localStorage not available
  }

  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      return {
        id: "local",
        user_id: clerkId,
        balance: parsed.balance ?? 9999,
        last_claim_date: parsed.last_claim_date ?? null,
        created_at: parsed.created_at ?? new Date().toISOString(),
        updated_at: parsed.updated_at ?? new Date().toISOString(),
      };
    } catch {
      // Invalid stored data
    }
  }

  // Default fallback wallet
  return {
    id: "fallback",
    user_id: "00000000-0000-0000-0000-000000000000",
    balance: 9999,
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

  // Fallback mode — Supabase not configured, use localStorage
  if (!db) {
    const storageKey = `litlabs-wallet-${clerkId}`;
    let currentBalance = 9999;

    // Try to get existing balance from localStorage
    try {
      const stored =
        typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
      if (stored) {
        const parsed = JSON.parse(stored);
        currentBalance = parsed.balance ?? 9999;
      }
    } catch {
      // localStorage not available
    }

    // Calculate new balance
    const newBalance = absolute ? amount : currentBalance + amount;

    // Save to localStorage
    const walletData = {
      balance: Math.max(0, newBalance),
      last_claim_date: lastClaimDate || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(storageKey, JSON.stringify(walletData));
      }
    } catch {
      // localStorage not available
    }

    return {
      id: "local",
      user_id: clerkId,
      ...walletData,
    } as Wallet;
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    // Graceful fallback — user exists in Clerk but not yet in Supabase, use localStorage
    const storageKey = `litlabs-wallet-${clerkId}`;
    let currentBalance = 9999;

    try {
      const stored =
        typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
      if (stored) {
        const parsed = JSON.parse(stored);
        currentBalance = parsed.balance ?? 9999;
      }
    } catch {
      /* ignore */
    }

    const newBalance = absolute ? amount : currentBalance + amount;
    const walletData = {
      balance: Math.max(0, newBalance),
      last_claim_date: lastClaimDate || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(storageKey, JSON.stringify(walletData));
      }
    } catch {
      /* ignore */
    }

    return {
      id: "local",
      user_id: clerkId,
      ...walletData,
    } as Wallet;
  }

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
