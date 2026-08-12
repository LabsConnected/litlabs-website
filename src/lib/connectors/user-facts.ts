import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────

export type FactSource =
  | "user_explicit"
  | "profile"
  | "device"
  | "connector"
  | "conversation";

export interface UserFactRow {
  id: string;
  user_id: string;
  key: string;
  value: unknown;
  source: FactSource;
  confidence: number;
  confirmed: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UserFact {
  id: string;
  userId: string;
  key: string;
  value: unknown;
  source: FactSource;
  confidence: number;
  confirmed: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function rowToFact(row: UserFactRow): UserFact {
  return {
    id: row.id,
    userId: row.user_id,
    key: row.key,
    value: row.value,
    source: row.source,
    confidence: row.confidence,
    confirmed: row.confirmed,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Repository ─────────────────────────────────────────────────────────

/**
 * Get all user facts for a user, ordered by confidence (highest first).
 */
export async function getUserFacts(userId: string): Promise<UserFact[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];
  const { data, error } = await admin
    .from("user_facts")
    .select("*")
    .eq("user_id", userId)
    .order("confidence", { ascending: false });
  if (error || !data) return [];
  return (data as UserFactRow[]).map(rowToFact);
}

/**
 * Get a single fact by key.
 */
export async function getUserFact(
  userId: string,
  key: string,
): Promise<UserFact | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from("user_facts")
    .select("*")
    .eq("user_id", userId)
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  return rowToFact(data as UserFactRow);
}

/**
 * Upsert a user fact with provenance.
 * If the fact already exists, it updates value/source/confidence/confirmed.
 * If not, it creates a new fact.
 */
export async function upsertUserFact(
  userId: string,
  key: string,
  fields: {
    value: unknown;
    source?: FactSource;
    confidence?: number;
    confirmed?: boolean;
    metadata?: Record<string, unknown>;
  },
): Promise<UserFact | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from("user_facts")
    .upsert(
      {
        user_id: userId,
        key,
        value: fields.value,
        source: fields.source ?? "conversation",
        confidence: fields.confidence ?? 0.5,
        confirmed: fields.confirmed ?? false,
        metadata: fields.metadata ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,key" },
    )
    .select("*")
    .single();
  if (error) return null;
  return rowToFact(data as UserFactRow);
}

/**
 * Confirm a user fact — mark it as explicitly confirmed by the user.
 * This upgrades its trustworthiness.
 */
export async function confirmUserFact(
  userId: string,
  key: string,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  const { error } = await admin
    .from("user_facts")
    .update({ confirmed: true, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("key", key);
  return !error;
}

/**
 * Delete a user fact.
 */
export async function deleteUserFact(
  userId: string,
  key: string,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  const { error } = await admin
    .from("user_facts")
    .delete()
    .eq("user_id", userId)
    .eq("key", key);
  return !error;
}

/**
 * Get the most trustworthy value for a fact key.
 * Prefers confirmed facts, then highest confidence.
 * Returns null if no fact exists for the key.
 */
export async function getBestFactValue<T = unknown>(
  userId: string,
  key: string,
): Promise<T | null> {
  const fact = await getUserFact(userId, key);
  if (!fact) return null;
  return fact.value as T;
}

/**
 * Build a summary of all user facts for the system prompt.
 * Only includes confirmed or high-confidence facts.
 */
export function buildFactsContextBlock(facts: UserFact[]): string {
  const relevant = facts.filter(
    (f) => f.confirmed || f.confidence >= 0.7,
  );
  if (relevant.length === 0) return "";

  const lines: string[] = ["USER FACTS (learned about the user):"];
  for (const fact of relevant) {
    const valueStr =
      typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
    const trust = fact.confirmed ? "confirmed" : `confidence: ${fact.confidence}`;
    lines.push(`  ${fact.key}: ${valueStr} (${trust})`);
  }
  return lines.join("\n");
}
