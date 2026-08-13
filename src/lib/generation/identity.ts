/**
 * Generation identity resolver.
 *
 * generation_jobs.user_id is:
 *   UUID NOT NULL REFERENCES public.users(id)
 *
 * auth().userId is a Clerk user ID (clerk_xxx), NOT the internal UUID.
 *
 * This module provides the canonical resolution from Clerk ID → internal
 * public.users.id UUID for all generation_jobs reads and writes.
 *
 * Every caller of createGenerationJob, getGenerationJobByRequestId,
 * getGenerationJobByProviderJobId, updateGenerationJobStatus, etc.
 * MUST pass the internal UUID, never the Clerk ID.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase";

/**
 * Resolve a Clerk user ID to the internal public.users.id UUID.
 * Returns null if the user is not found or the database is not configured.
 *
 * This is the ONLY correct way to obtain the user identity for
 * generation_jobs operations.
 */
export async function resolveInternalUserId(
  clerkId: string,
): Promise<string | null> {
  if (!clerkId) return null;
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (error || !data) return null;
  return data.id as string;
}
