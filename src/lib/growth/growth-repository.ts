/**
 * Growth Engine — database access layer.
 *
 * Mirrors the pattern in src/lib/connectors/connector-repository.ts.
 * All functions take a clerkId (TEXT) and use supabaseAdmin (service role,
 * bypasses RLS). No token values are handled in Phase 1a (manual mode).
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { randomUUID } from "crypto";
import type {
  GrowthAccount,
  GrowthCampaign,
  GrowthContent,
  GrowthPublication,
  GrowthRules,
  GrowthProviderId,
  CampaignStatus,
  ContentStatus,
  PublicationStatus,
} from "./types";

// ─── Accounts ───────────────────────────────────────────────────

export async function getAccount(
  clerkId: string,
  provider: GrowthProviderId,
): Promise<GrowthAccount | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_accounts")
    .select("*")
    .eq("user_id", clerkId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) return null;
  return (data as GrowthAccount) ?? null;
}

export async function listAccounts(clerkId: string): Promise<GrowthAccount[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from("growth_accounts")
    .select("*")
    .eq("user_id", clerkId)
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data as GrowthAccount[]) ?? [];
}

/**
 * Ensure a manual-mode account exists for (user, provider).
 * In Phase 1a, accounts are auto-created on first use in manual mode.
 */
export async function ensureManualAccount(
  clerkId: string,
  provider: GrowthProviderId,
): Promise<GrowthAccount | null> {
  const existing = await getAccount(clerkId, provider);
  if (existing) return existing;
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_accounts")
    .insert({
      user_id: clerkId,
      provider,
      mode: "manual",
      status: "active",
    })
    .select("*")
    .maybeSingle();
  if (error) return null;
  return (data as GrowthAccount) ?? null;
}

// ─── Campaigns ──────────────────────────────────────────────────

export interface CreateCampaignInput {
  name: string;
  objective?: string;
  event_summary: string;
  target_providers: GrowthProviderId[];
}

export async function createCampaign(
  clerkId: string,
  input: CreateCampaignInput,
): Promise<GrowthCampaign | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_campaigns")
    .insert({
      user_id: clerkId,
      name: input.name,
      objective: input.objective ?? null,
      event_summary: input.event_summary,
      target_providers: input.target_providers,
      status: "draft",
    })
    .select("*")
    .maybeSingle();
  if (error) return null;
  return (data as GrowthCampaign) ?? null;
}

export async function getCampaign(
  clerkId: string,
  campaignId: string,
): Promise<GrowthCampaign | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("user_id", clerkId)
    .maybeSingle();
  if (error) return null;
  return (data as GrowthCampaign) ?? null;
}

export async function listCampaigns(
  clerkId: string,
  limit = 20,
): Promise<GrowthCampaign[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from("growth_campaigns")
    .select("*")
    .eq("user_id", clerkId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data as GrowthCampaign[]) ?? [];
}

export async function updateCampaignStatus(
  clerkId: string,
  campaignId: string,
  status: CampaignStatus,
): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from("growth_campaigns")
    .update({ status })
    .eq("id", campaignId)
    .eq("user_id", clerkId);
}

// ─── Content ────────────────────────────────────────────────────

export interface CreateContentInput {
  campaign_id: string;
  provider: GrowthProviderId;
  content: string;
  content_type?: "text" | "thread" | "link" | "gallery";
  media_urls?: string[];
  metadata?: Record<string, unknown>;
}

export async function createContent(
  clerkId: string,
  input: CreateContentInput,
): Promise<GrowthContent | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_content")
    .insert({
      campaign_id: input.campaign_id,
      user_id: clerkId,
      provider: input.provider,
      content: input.content,
      content_type: input.content_type ?? "text",
      media_urls: input.media_urls ?? null,
      status: "draft",
      metadata: input.metadata ?? {},
    })
    .select("*")
    .maybeSingle();
  if (error) return null;
  return (data as GrowthContent) ?? null;
}

export async function getContent(
  clerkId: string,
  contentId: string,
): Promise<GrowthContent | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_content")
    .select("*")
    .eq("id", contentId)
    .eq("user_id", clerkId)
    .maybeSingle();
  if (error) return null;
  return (data as GrowthContent) ?? null;
}

export async function listDrafts(
  clerkId: string,
  opts: {
    campaignId?: string;
    provider?: GrowthProviderId;
    status?: ContentStatus;
    limit?: number;
  } = {},
): Promise<GrowthContent[]> {
  if (!supabaseAdmin) return [];
  let query = supabaseAdmin
    .from("growth_content")
    .select("*")
    .eq("user_id", clerkId);
  if (opts.campaignId) query = query.eq("campaign_id", opts.campaignId);
  if (opts.provider) query = query.eq("provider", opts.provider);
  if (opts.status) query = query.eq("status", opts.status);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (error) return [];
  return (data as GrowthContent[]) ?? [];
}

export async function approveContent(
  clerkId: string,
  contentId: string,
): Promise<GrowthContent | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_content")
    .update({
      status: "approved",
      approved_by: clerkId,
      approved_at: new Date().toISOString(),
      rejected_reason: null,
    })
    .eq("id", contentId)
    .eq("user_id", clerkId)
    .in("status", ["draft", "rejected"])
    .select("*")
    .maybeSingle();
  if (error) return null;
  return (data as GrowthContent) ?? null;
}

export async function rejectContent(
  clerkId: string,
  contentId: string,
  reason?: string,
): Promise<GrowthContent | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_content")
    .update({
      status: "rejected",
      rejected_reason: reason ?? null,
    })
    .eq("id", contentId)
    .eq("user_id", clerkId)
    .eq("status", "draft")
    .select("*")
    .maybeSingle();
  if (error) return null;
  return (data as GrowthContent) ?? null;
}

/**
 * Rewrite a draft — creates a new version (does not mutate the old row).
 * Increments version by reading the current max version for this
 * (campaign_id, provider) lineage.
 */
export async function rewriteContent(
  clerkId: string,
  contentId: string,
  newContent: string,
  metadata?: Record<string, unknown>,
): Promise<GrowthContent | null> {
  const existing = await getContent(clerkId, contentId);
  if (!existing) return null;
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_content")
    .insert({
      campaign_id: existing.campaign_id,
      user_id: clerkId,
      provider: existing.provider,
      content: newContent,
      content_type: existing.content_type,
      media_urls: existing.media_urls,
      status: "draft",
      version: existing.version + 1,
      metadata: metadata ?? existing.metadata,
    })
    .select("*")
    .maybeSingle();
  if (error) return null;
  return (data as GrowthContent) ?? null;
}

// ─── Publications ───────────────────────────────────────────────

export interface CreatePublicationInput {
  campaign_id?: string | null;
  content_id?: string | null;
  provider: GrowthProviderId;
  provider_account_id?: string | null;
  idempotency_key: string;
  mode?: "manual" | "api";
  utm_campaign?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
}

export async function getPublicationByIdempotencyKey(
  idempotencyKey: string,
): Promise<GrowthPublication | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_publications")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) return null;
  return (data as GrowthPublication) ?? null;
}

export async function createPublication(
  clerkId: string,
  input: CreatePublicationInput,
): Promise<{ row: GrowthPublication | null; created: boolean }> {
  // Idempotency: if a row with this key exists, return it without inserting.
  const existing = await getPublicationByIdempotencyKey(input.idempotency_key);
  if (existing) return { row: existing, created: false };
  if (!supabaseAdmin) return { row: null, created: false };
  const { data, error } = await supabaseAdmin
    .from("growth_publications")
    .insert({
      user_id: clerkId,
      campaign_id: input.campaign_id ?? null,
      content_id: input.content_id ?? null,
      provider: input.provider,
      provider_account_id: input.provider_account_id ?? null,
      idempotency_key: input.idempotency_key,
      status: "draft",
      mode: input.mode ?? "manual",
      utm_campaign: input.utm_campaign ?? null,
      utm_source: input.utm_source ?? null,
      utm_medium: input.utm_medium ?? null,
    })
    .select("*")
    .maybeSingle();
  if (error) return { row: null, created: false };
  return { row: (data as GrowthPublication) ?? null, created: true };
}

export async function markPublished(
  clerkId: string,
  publicationId: string,
  externalUrl: string,
  externalId?: string | null,
): Promise<GrowthPublication | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_publications")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      external_url: externalUrl,
      external_id: externalId ?? null,
      attempt_count: 1,
    })
    .eq("id", publicationId)
    .eq("user_id", clerkId)
    .select("*")
    .maybeSingle();
  if (error) return null;
  return (data as GrowthPublication) ?? null;
}

export async function markFailed(
  clerkId: string,
  publicationId: string,
  errorCode: string,
  errorMessage: string,
  retryable: boolean,
): Promise<GrowthPublication | null> {
  if (!supabaseAdmin) return null;
  const status: PublicationStatus = retryable ? "retryable_failed" : "permanent_failed";
  const { data, error } = await supabaseAdmin
    .from("growth_publications")
    .update({
      status,
      last_error: errorMessage.slice(0, 1000),
      last_error_code: errorCode,
      attempt_count: 1,
    })
    .eq("id", publicationId)
    .eq("user_id", clerkId)
    .select("*")
    .maybeSingle();
  if (error) return null;
  return (data as GrowthPublication) ?? null;
}

export async function getPublication(
  clerkId: string,
  publicationId: string,
): Promise<GrowthPublication | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_publications")
    .select("*")
    .eq("id", publicationId)
    .eq("user_id", clerkId)
    .maybeSingle();
  if (error) return null;
  return (data as GrowthPublication) ?? null;
}

/**
 * Count publications published today for a (user, provider) —
 * used by the policy engine to enforce daily_post_limit.
 */
export async function countPublishedToday(
  clerkId: string,
  provider: GrowthProviderId,
): Promise<number> {
  if (!supabaseAdmin) return 0;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count, error } = await supabaseAdmin
    .from("growth_publications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", clerkId)
    .eq("provider", provider)
    .eq("status", "published")
    .gte("published_at", startOfDay.toISOString());
  if (error) return 0;
  return count ?? 0;
}

/**
 * Get the most recent published publication for a (user, provider) —
 * used by the policy engine to enforce min_interval_minutes.
 */
export async function getLastPublished(
  clerkId: string,
  provider: GrowthProviderId,
): Promise<GrowthPublication | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_publications")
    .select("*")
    .eq("user_id", clerkId)
    .eq("provider", provider)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as GrowthPublication) ?? null;
}

// ─── Rules ──────────────────────────────────────────────────────

export async function getRules(
  clerkId: string,
  provider: GrowthProviderId,
): Promise<GrowthRules | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_rules")
    .select("*")
    .eq("user_id", clerkId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) return null;
  return (data as GrowthRules) ?? null;
}

/**
 * Get rules or sensible defaults if no row exists yet.
 */
export async function getRulesOrDefault(
  clerkId: string,
  provider: GrowthProviderId,
): Promise<GrowthRules> {
  const existing = await getRules(clerkId, provider);
  if (existing) return existing;
  return {
    id: "",
    user_id: clerkId,
    provider,
    daily_post_limit: 3,
    min_interval_minutes: 60,
    cooldown_minutes: 0,
    require_approval: true,
    metadata: {},
  };
}

export async function upsertRules(
  clerkId: string,
  provider: GrowthProviderId,
  patch: Partial<Pick<GrowthRules, "daily_post_limit" | "min_interval_minutes" | "cooldown_minutes" | "require_approval" | "metadata">>,
): Promise<GrowthRules | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("growth_rules")
    .upsert(
      {
        user_id: clerkId,
        provider,
        daily_post_limit: patch.daily_post_limit ?? 3,
        min_interval_minutes: patch.min_interval_minutes ?? 60,
        cooldown_minutes: patch.cooldown_minutes ?? 0,
        require_approval: patch.require_approval ?? true,
        metadata: patch.metadata ?? {},
      },
      { onConflict: "user_id,provider" },
    )
    .select("*")
    .maybeSingle();
  if (error) return null;
  return (data as GrowthRules) ?? null;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Generate a fresh idempotency key for a new publication. */
export function newIdempotencyKey(): string {
  return randomUUID();
}
