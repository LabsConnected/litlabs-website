/**
 * Growth Engine audit logging.
 *
 * Writes to the existing agent_logs table with metadata._type
 * discriminator, matching the pattern used by all project tools.
 * Silent-fail — audit logging never blocks the operation.
 * Never logs token values or full content bodies (only content_id
 * reference + length).
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase";

export interface GrowthAuditEntry {
  userId: string;
  action: string;
  campaignId?: string | null;
  contentId?: string | null;
  publicationId?: string | null;
  provider?: string | null;
  success: boolean;
  error?: string | null;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Write a growth audit entry to agent_logs.
 * Silent-fail — never throws.
 */
export async function auditGrowthAction(entry: GrowthAuditEntry): Promise<void> {
  try {
    if (!supabaseAdmin) return;
    await supabaseAdmin.from("agent_logs").insert({
      agent_id: null,
      level: entry.success ? "info" : "error",
      message: `[growth:${entry.action}] ${entry.provider ?? "unknown"} (${entry.success ? "ok" : "failed"})`,
      metadata: {
        _type: `growth_${entry.action}`,
        userId: entry.userId,
        campaignId: entry.campaignId ?? null,
        contentId: entry.contentId ?? null,
        publicationId: entry.publicationId ?? null,
        provider: entry.provider ?? null,
        success: entry.success,
        error: entry.error ?? null,
        durationMs: entry.durationMs ?? null,
        timestamp: new Date().toISOString(),
        ...(entry.metadata ?? {}),
      },
    });
  } catch {
    // Silent fail — audit logging must never break the request
  }
}
