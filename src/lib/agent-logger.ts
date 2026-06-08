import { getSupabaseAdmin } from "@/lib/supabase";

export type LogLevel = "info" | "warn" | "error" | "success";

/**
 * Write a real log entry to the agent_logs table.
 * Silent fail — never throws, so callers are never interrupted.
 */
export async function logAgentEvent(
  agentSlug: string,
  level: LogLevel,
  message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();

    const { data: agent } = await admin
      .from("agents")
      .select("id")
      .eq("slug", agentSlug)
      .single();

    if (!agent) return;

    await admin.from("agent_logs").insert({
      agent_id: agent.id,
      level,
      message,
      metadata: metadata ?? null,
    });
  } catch {
    // Silent fail — logging must never break the caller
  }
}

/**
 * Convenience wrappers
 */
export const agentLog = {
  info:    (slug: string, msg: string, meta?: Record<string, unknown>) => logAgentEvent(slug, "info",    msg, meta),
  warn:    (slug: string, msg: string, meta?: Record<string, unknown>) => logAgentEvent(slug, "warn",    msg, meta),
  error:   (slug: string, msg: string, meta?: Record<string, unknown>) => logAgentEvent(slug, "error",   msg, meta),
  success: (slug: string, msg: string, meta?: Record<string, unknown>) => logAgentEvent(slug, "success", msg, meta),
};
