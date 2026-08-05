/**
 * GDPR-compliant audit event helper.
 *
 * The audit_events table has ip_address and user_agent columns, but per
 * GDPR data minimization (Article 5(1)(c)), we only capture IP and user
 * agent for security-critical events. Routine operational events (tool
 * calls, model calls, approvals) do NOT record IP or user agent.
 *
 * SECURITY-CRITICAL events (IP + user_agent captured):
 *   - error, rate_limited, approval_denied, fallback_used, file_delete,
 *     git_push, deployment, connection_removed, config_changed
 *
 * ROUTINE events (no IP or user_agent):
 *   - model_call, tool_call, approval_requested, approval_granted,
 *     credit_reserved, credit_settled, credit_refunded, connection_added,
 *     external_message, custom
 */

import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const SECURITY_CRITICAL_EVENTS = new Set([
  "error",
  "rate_limited",
  "approval_denied",
  "fallback_used",
  "file_delete",
  "git_push",
  "deployment",
  "connection_removed",
  "config_changed",
]);

export interface AuditEventInput {
  userId: string;
  eventType: string;
  eventCategory?: "info" | "warning" | "error" | "critical";
  description?: string;
  metadata?: Record<string, unknown>;
  relatedId?: string;
  relatedType?: string;
  projectId?: string;
  runId?: string;
  /** The incoming request — used to extract IP/user_agent for security events only. */
  request?: NextRequest;
}

/**
 * Insert an audit event with GDPR-compliant IP/user_agent capture.
 * IP and user_agent are ONLY recorded for security-critical event types.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  const isSecurityCritical = SECURITY_CRITICAL_EVENTS.has(input.eventType);

  let ipAddress: string | null = null;
  let userAgent: string | null = null;

  if (isSecurityCritical && input.request) {
    ipAddress =
      input.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      input.request.headers.get("x-real-ip") ||
      null;
    userAgent = input.request.headers.get("user-agent") || null;
  }

  try {
    await supabaseAdmin.from("audit_events").insert({
      user_id: input.userId,
      event_type: input.eventType,
      event_category: input.eventCategory ?? "info",
      description: input.description,
      metadata: input.metadata ?? {},
      related_id: input.relatedId,
      related_type: input.relatedType,
      project_id: input.projectId,
      run_id: input.runId,
      ip_address: ipAddress,
      user_agent: userAgent,
    });
  } catch {
    // Audit logging is best-effort — don't fail the request if logging fails
  }
}
