/**
 * File operation audit logging.
 *
 * Every file write/delete through the server-side API is logged to
 * agent_logs for audit. Direct user actions are logged as "approved"
 * (the user explicitly initiated them via the UI). AI-driven actions
 * go through the mission approval flow and are logged when resolved.
 *
 * Silent fail — logging never blocks the operation.
 */
import { getSupabaseAdmin } from "./supabase";

export type FileAction = "write" | "delete" | "read";

export interface FileOperationAuditEntry {
  userId: string;
  projectId: string;
  workspaceId: string;
  action: FileAction;
  path: string;
  contentLength?: number;
  source: "user" | "mission" | "system" | "agent";
  approvalId?: string;
  ok: boolean;
  error?: string;
}

/**
 * Log a file operation to agent_logs for audit trail.
 * Silent fail — never throws.
 */
export async function logFileOperation(entry: FileOperationAuditEntry): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;

    await admin.from("agent_logs").insert({
      agent_id: null,
      level: entry.ok ? "info" : "error",
      message: `[file:${entry.action}] ${entry.path} (${entry.source})`,
      metadata: {
        userId: entry.userId,
        projectId: entry.projectId,
        workspaceId: entry.workspaceId,
        action: entry.action,
        path: entry.path,
        contentLength: entry.contentLength ?? null,
        source: entry.source,
        approvalId: entry.approvalId ?? null,
        ok: entry.ok,
        error: entry.error ?? null,
        _type: "file_operation",
      },
    });
  } catch {
    // Silent fail — audit logging must not block file operations
  }
}
