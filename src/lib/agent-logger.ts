import { getSupabaseAdmin } from "./supabase";

export type LogLevel = "info" | "warn" | "error" | "success";

/* ------------------------------------------------------------------ */
/*  Command execution log entry                                        */
/* ------------------------------------------------------------------ */

export interface CommandLogEntry {
  agentSlug: string;
  userId: string;
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number | null;
  durationMs: number;
  outputLength: number;
  truncated: boolean;
  allowed: boolean;
  ok: boolean;
  error?: string;
}

/**
 * Write a command execution audit entry to agent_logs.
 * Silent fail — never throws.
 */
export async function logCommandExecution(entry: CommandLogEntry): Promise<void> {
  try {
    const admin = getSupabaseAdmin();

    const { data: agent } = await admin
      .from("agents")
      .select("id")
      .eq("slug", entry.agentSlug)
      .single();

    const agentId = agent?.id ?? null;

    await admin.from("agent_logs").insert({
      agent_id: agentId,
      level: entry.ok ? "info" : "error",
      message: `[cmd] ${entry.command} ${entry.args.join(" ")}`.trim(),
      metadata: {
        userId: entry.userId,
        command: entry.command,
        args: entry.args,
        cwd: entry.cwd ?? null,
        exitCode: entry.exitCode,
        durationMs: entry.durationMs,
        outputLength: entry.outputLength,
        truncated: entry.truncated,
        allowed: entry.allowed,
        ok: entry.ok,
        error: entry.error ?? null,
        _type: "command_execution",
      },
    });
  } catch {
    // Silent fail
  }
}

/**
 * Fetch recent command execution logs for the admin terminal sidebar.
 */
export async function getRecentCommandLogs(limit = 50): Promise<Array<{
  id: string;
  timestamp: string;
  agent: string;
  level: LogLevel;
  message: string;
  metadata: Record<string, unknown> | null;
}>> {
  try {
    const admin = getSupabaseAdmin();
    const { data: rows, error } = await admin
      .from("agent_logs")
      .select("id, level, message, metadata, created_at, agent_id, agents(display_name)")
      .filter("metadata->_type", "eq", "command_execution")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !rows) return [];

    return rows.map((r) => ({
      id: r.id,
      timestamp: new Date(r.created_at).toISOString(),
      agent: (r.agents as { display_name?: string } | null)?.display_name ?? "System",
      level: (r.level ?? "info") as LogLevel,
      message: r.message ?? "",
      metadata: (r.metadata as Record<string, unknown>) ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Write a real log entry to the agent_logs table.
 * Silent fail — never throws, so callers are never interrupted.
 */
export async function logAgentEvent(
  agentSlug: string,
  level: LogLevel,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    
    // Check if admin client is valid
    if (!admin || typeof admin.from !== "function") return;

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
