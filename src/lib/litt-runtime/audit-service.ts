/**
 * LiTT Runtime — Audit Service
 *
 * Records run events for audit and observability. Uses the existing
 * studio logger and the agent_logs table. Server-side only — never logs
 * secrets or full prompt contents.
 */

import { studioLog } from "@/lib/studio/logger";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { LiTTMode } from "./types";

export interface AuditRunEvent {
  userId: string | null;
  conversationId: string | null;
  projectId: string | null;
  mode: LiTTMode;
  agentSlug?: string;
  agentInstanceId?: string;
  provider: string;
  model: string;
  latencyMs: number;
  status: "completed" | "failed";
  errorClass?: string;
}

/**
 * Record a run event. Non-blocking — audit failures must never break a run.
 */
export function auditRun(event: AuditRunEvent): void {
  try {
    studioLog(`run:${event.status}:${event.mode}`, {
      conversationId: event.conversationId ?? undefined,
      projectId: event.projectId ?? undefined,
      userId: event.userId ?? undefined,
      agentSlug: event.agentSlug,
      agentInstanceId: event.agentInstanceId,
      provider: event.provider,
      latencyMs: event.latencyMs,
      errorClass: event.errorClass,
    });
  } catch {
    // audit logging is best-effort
  }
}

/**
 * Persist a legacy agent_logs row for backward compatibility with the
 * pre-runtime chat routes. Non-blocking.
 */
export function logLegacyAgentChat(
  agentId: string,
  userId: string | null,
  userMessage: string,
  responseText: string,
): void {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;
    void admin.from("agent_logs").insert({
      agent_id: agentId,
      level: "info",
      message: "Agent chat",
      metadata: {
        userId,
        userMessage,
        responseText,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // best-effort
  }
}
