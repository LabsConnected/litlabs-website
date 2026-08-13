/**
 * LiTT Growth Engine — shared types.
 *
 * Phase 1a: all providers in MANUAL mode. LiTT prepares platform-native
 * content + a compose URL; the user posts by hand; LiTT records the result.
 *
 * The interface is forward-compatible with API mode (1b+): publish(),
 * reconcile(), delete(), getMetrics() exist on the interface but are
 * optional and not called in manual mode.
 */

import "server-only";

// ─── Provider mode ──────────────────────────────────────────────

export type ProviderMode = "manual" | "api";

// ─── Provider IDs ───────────────────────────────────────────────

export type GrowthProviderId = "x" | "reddit" | "hackernews" | "producthunt";

export const GROWTH_PROVIDER_IDS: readonly GrowthProviderId[] = [
  "x",
  "reddit",
  "hackernews",
  "producthunt",
];

export function isGrowthProviderId(value: string): value is GrowthProviderId {
  return (GROWTH_PROVIDER_IDS as readonly string[]).includes(value);
}

// ─── Status enums (mirror the DB CHECK constraints) ─────────────

export type CampaignStatus = "draft" | "generating" | "active" | "completed" | "cancelled";

export type ContentStatus = "draft" | "approved" | "rejected" | "published" | "archived";

export type PublicationStatus =
  | "draft"
  | "approved"
  | "scheduled"
  | "publishing"
  | "published"
  | "retryable_failed"
  | "permanent_failed"
  | "unknown"
  | "cancelled";

export type AccountStatus = "active" | "expired" | "revoked" | "disconnected" | "needs_reauth";

export type CampaignObjective =
  | "launch"
  | "feature_update"
  | "announcement"
  | "demo"
  | "milestone"
  | "general";

// ─── Provider interface ─────────────────────────────────────────

export interface ProviderHealth {
  healthy: boolean;
  mode: ProviderMode;
  reason?: string;
}

/**
 * Input to prepare() — the approved content + campaign context.
 * In manual mode, prepare() returns the final text + a compose URL
 * the user opens to post by hand.
 */
export interface PrepareInput {
  content: string;
  contentType: "text" | "thread" | "link" | "gallery";
  mediaUrls?: string[];
  campaignName?: string;
  utmUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The output of prepare() — ready-to-post content + a platform compose URL.
 */
export interface PreparedPost {
  provider: GrowthProviderId;
  platformLabel: string;
  text: string;
  composeUrl: string;
  clipboardPayload: string;
  notes?: string;
}

/**
 * Input to publish() — only used in API mode (1b+).
 * In manual mode, publish() is never called.
 */
export interface PublishInput {
  content: string;
  contentType: "text" | "thread" | "link" | "gallery";
  mediaUrls?: string[];
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderRateLimit {
  limit?: number;
  remaining?: number;
  resetAt?: Date;
  retryAfterMs?: number;
}

/**
 * Result of publish() — only returned in API mode (1b+).
 */
export interface PublishResult {
  externalId: string;
  externalUrl?: string;
  rateLimit?: ProviderRateLimit;
  creditsCharged?: number;
}

export interface PostMetrics {
  impressions?: number;
  clicks?: number;
  likes?: number;
  replies?: number;
  reposts?: number;
  raw?: Record<string, unknown>;
}

export interface ReconciliationResult {
  found: boolean;
  externalId?: string;
  externalUrl?: string;
  status?: PublicationStatus;
}

/**
 * Every network implements one interface.
 * In manual mode (1a): only prepare() and validate() are called.
 * In api mode (1b+): publish(), reconcile(), delete(), getMetrics() are called.
 */
export interface GrowthProvider {
  id: GrowthProviderId;
  label: string;
  mode: ProviderMode;
  validate(): Promise<ProviderHealth>;
  prepare(input: PrepareInput): Promise<PreparedPost>;
  publish?(input: PublishInput): Promise<PublishResult>;
  reconcile?(publication: GrowthPublication): Promise<ReconciliationResult>;
  delete?(externalId: string): Promise<void>;
  getMetrics?(externalId: string): Promise<PostMetrics>;
}

// ─── DB row shapes (subset of columns used in app code) ─────────

export interface GrowthAccount {
  id: string;
  user_id: string;
  provider: GrowthProviderId;
  mode: ProviderMode;
  provider_account_id: string | null;
  provider_account_name: string | null;
  status: AccountStatus;
  scopes: string[] | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface GrowthCampaign {
  id: string;
  user_id: string;
  name: string;
  objective: string | null;
  event_summary: string;
  target_providers: GrowthProviderId[];
  status: CampaignStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface GrowthContent {
  id: string;
  campaign_id: string;
  user_id: string;
  provider: GrowthProviderId;
  content: string;
  content_type: "text" | "thread" | "link" | "gallery";
  media_urls: string[] | null;
  status: ContentStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  version: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface GrowthPublication {
  id: string;
  campaign_id: string | null;
  content_id: string | null;
  user_id: string;
  provider: GrowthProviderId;
  provider_account_id: string | null;
  idempotency_key: string;
  status: PublicationStatus;
  mode: ProviderMode;
  scheduled_at: string | null;
  published_at: string | null;
  attempt_count: number;
  external_id: string | null;
  external_url: string | null;
  utm_campaign: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  created_at: string;
  updated_at: string;
}

export interface GrowthRules {
  id: string;
  user_id: string;
  provider: GrowthProviderId;
  daily_post_limit: number;
  min_interval_minutes: number;
  cooldown_minutes: number;
  require_approval: boolean;
  metadata: Record<string, unknown>;
}

// ─── Policy engine result ───────────────────────────────────────

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  dailyCount: number;
  minutesSinceLastPost: number | null;
}
