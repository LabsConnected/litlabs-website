/**
 * Quota and usage tracking service for Terminal V1.
 *
 * Enforces per-user limits on:
 * - Concurrent sandboxes
 * - Monthly sandbox hours
 * - Storage usage
 * - Preview port hours
 *
 * Usage is tracked per billing period (YYYY-MM).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─── Quota tiers ─────────────────────────────────────────────────

export interface QuotaTier {
  name: string;
  maxConcurrentSandboxes: number;
  maxMonthlyHours: number;
  maxStorageGB: number;
  maxPreviewPortHours: number;
}

export const QUOTA_TIERS: Record<string, QuotaTier> = {
  free: {
    name: "free",
    maxConcurrentSandboxes: 1,
    maxMonthlyHours: 10,
    maxStorageGB: 1,
    maxPreviewPortHours: 5,
  },
  pro: {
    name: "pro",
    maxConcurrentSandboxes: 3,
    maxMonthlyHours: 100,
    maxStorageGB: 10,
    maxPreviewPortHours: 50,
  },
  team: {
    name: "team",
    maxConcurrentSandboxes: 10,
    maxMonthlyHours: 500,
    maxStorageGB: 50,
    maxPreviewPortHours: 200,
  },
  owner: {
    name: "owner",
    maxConcurrentSandboxes: 20,
    maxMonthlyHours: 9999,
    maxStorageGB: 100,
    maxPreviewPortHours: 9999,
  },
};

export function getQuotaTier(tierName: string): QuotaTier {
  return QUOTA_TIERS[tierName] ?? QUOTA_TIERS.free;
}

// ─── Usage record ────────────────────────────────────────────────

export interface UsageRecord {
  userId: string;
  billingPeriod: string;
  sandboxHours: number;
  storageGbHours: number;
  previewPortHours: number;
  maxConcurrentSandboxes: number;
}

interface UsageRow {
  usage_id: string;
  user_id: string;
  billing_period: string;
  sandbox_hours: number;
  storage_gb_hours: number;
  preview_port_hours: number;
  max_concurrent_sandboxes: number;
  created_at: string;
  updated_at: string;
}

function rowToUsage(row: UsageRow): UsageRecord {
  return {
    userId: row.user_id,
    billingPeriod: row.billing_period,
    sandboxHours: Number(row.sandbox_hours),
    storageGbHours: Number(row.storage_gb_hours),
    previewPortHours: Number(row.preview_port_hours),
    maxConcurrentSandboxes: row.max_concurrent_sandboxes,
  };
}

function currentBillingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Quota service ───────────────────────────────────────────────

export class QuotaService {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client =
      client ??
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
        { auth: { persistSession: false } },
      );
  }

  /**
   * Get the current usage for a user in the current billing period.
   * Creates a record if one doesn't exist.
   */
  async getUsage(userId: string): Promise<UsageRecord> {
    const period = currentBillingPeriod();

    const { data, error } = await this.client
      .from("terminal_usage")
      .select("*")
      .eq("user_id", userId)
      .eq("billing_period", period)
      .maybeSingle();

    if (error) throw new Error(`Failed to get usage: ${error.message}`);

    if (data) {
      return rowToUsage(data as UsageRow);
    }

    // Create new record for this billing period
    const { data: newData, error: insertError } = await this.client
      .from("terminal_usage")
      .insert({
        user_id: userId,
        billing_period: period,
        sandbox_hours: 0,
        storage_gb_hours: 0,
        preview_port_hours: 0,
        max_concurrent_sandboxes: 0,
      })
      .select()
      .single();

    if (insertError) throw new Error(`Failed to create usage record: ${insertError.message}`);
    return rowToUsage(newData as UsageRow);
  }

  /**
   * Check if a user can create a new sandbox.
   * Throws QuotaExceededError if any limit is exceeded.
   */
  async checkCanCreateSandbox(userId: string, tier: string, currentSandboxCount: number): Promise<void> {
    const quota = getQuotaTier(tier);
    const usage = await this.getUsage(userId);

    if (currentSandboxCount >= quota.maxConcurrentSandboxes) {
      throw new QuotaExceededError(
        `Concurrent sandbox limit reached (${quota.maxConcurrentSandboxes})`,
        "CONCURRENT_LIMIT",
      );
    }

    if (usage.sandboxHours >= quota.maxMonthlyHours) {
      throw new QuotaExceededError(
        `Monthly sandbox hour limit reached (${quota.maxMonthlyHours}h)`,
        "MONTHLY_HOURS_LIMIT",
      );
    }
  }

  /**
   * Record sandbox usage (called when a sandbox is stopped).
   */
  async recordSandboxHours(userId: string, hours: number): Promise<void> {
    const period = currentBillingPeriod();
    const usage = await this.getUsage(userId);

    await this.client
      .from("terminal_usage")
      .update({
        sandbox_hours: usage.sandboxHours + hours,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("billing_period", period);
  }

  /**
   * Update the max concurrent sandboxes counter.
   */
  async updateMaxConcurrent(userId: string, count: number): Promise<void> {
    const period = currentBillingPeriod();
    const usage = await this.getUsage(userId);

    if (count > usage.maxConcurrentSandboxes) {
      await this.client
        .from("terminal_usage")
        .update({
          max_concurrent_sandboxes: count,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("billing_period", period);
    }
  }

  /**
   * Record storage usage.
   */
  async recordStorageUsage(userId: string, gbHours: number): Promise<void> {
    const period = currentBillingPeriod();
    const usage = await this.getUsage(userId);

    await this.client
      .from("terminal_usage")
      .update({
        storage_gb_hours: usage.storageGbHours + gbHours,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("billing_period", period);
  }

  /**
   * Record preview port usage.
   */
  async recordPreviewPortHours(userId: string, hours: number): Promise<void> {
    const period = currentBillingPeriod();
    const usage = await this.getUsage(userId);

    await this.client
      .from("terminal_usage")
      .update({
        preview_port_hours: usage.previewPortHours + hours,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("billing_period", period);
  }

  /**
   * Check if a user can expose a new preview port.
   */
  async checkCanExposePreview(userId: string, tier: string): Promise<void> {
    const quota = getQuotaTier(tier);
    const usage = await this.getUsage(userId);

    if (usage.previewPortHours >= quota.maxPreviewPortHours) {
      throw new QuotaExceededError(
        `Preview port hour limit reached (${quota.maxPreviewPortHours}h)`,
        "PREVIEW_PORT_LIMIT",
      );
    }
  }
}

// ─── Error class ─────────────────────────────────────────────────

export class QuotaExceededError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "QuotaExceededError";
    this.code = code;
  }
}
