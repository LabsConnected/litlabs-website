/**
 * Audit log service for Terminal V1.
 *
 * Records all terminal actions for security audit, compliance, and
 * debugging. Logs are write-once and immutable.
 *
 * Privacy: Audit logs never contain secret values, command output,
 * or file contents. They only record metadata (action type, timestamps,
 * sandbox/workspace IDs).
 */

import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─── Action types ────────────────────────────────────────────────

export type AuditAction =
  | "sandbox.create"
  | "sandbox.start"
  | "sandbox.stop"
  | "sandbox.destroy"
  | "terminal.connect"
  | "terminal.disconnect"
  | "terminal.resize"
  | "command.execute"
  | "preview.expose"
  | "preview.close"
  | "workspace.create"
  | "workspace.delete"
  | "workspace.restore"
  | "secret.create"
  | "secret.delete"
  | "secret.resolve"
  | "quota.exceeded";

// ─── Audit entry ─────────────────────────────────────────────────

export interface AuditEntry {
  auditId: string;
  userId: string;
  workspaceId: string | null;
  sandboxId: string | null;
  action: AuditAction;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

interface AuditRow {
  audit_id: string;
  user_id: string;
  workspace_id: string | null;
  sandbox_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

function rowToEntry(row: AuditRow): AuditEntry {
  return {
    auditId: row.audit_id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    sandboxId: row.sandbox_id,
    action: row.action as AuditAction,
    details: row.details,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
  };
}

// ─── Audit service ───────────────────────────────────────────────

export interface LogActionInput {
  userId: string;
  workspaceId?: string;
  sandboxId?: string;
  action: AuditAction;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

export class AuditService {
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
   * Log an audit action. Fire-and-forget — errors are swallowed
   * to never block the primary operation.
   */
  async log(input: LogActionInput): Promise<void> {
    const auditId = `audit-${randomUUID()}`;

    try {
      await this.client.from("terminal_audit_log").insert({
        audit_id: auditId,
        user_id: input.userId,
        workspace_id: input.workspaceId ?? null,
        sandbox_id: input.sandboxId ?? null,
        action: input.action,
        details: input.details ?? null,
        ip_address: input.ipAddress ?? null,
      });
    } catch {
      // Audit logging is best-effort — never throw
    }
  }

  /**
   * Get audit entries for a user (most recent first).
   */
  async listByUser(userId: string, limit = 50): Promise<AuditEntry[]> {
    const { data, error } = await this.client
      .from("terminal_audit_log")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to list audit entries: ${error.message}`);
    return (data as AuditRow[]).map(rowToEntry);
  }

  /**
   * Get audit entries for a specific sandbox.
   */
  async listBySandbox(sandboxId: string, limit = 50): Promise<AuditEntry[]> {
    const { data, error } = await this.client
      .from("terminal_audit_log")
      .select("*")
      .eq("sandbox_id", sandboxId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to list sandbox audit entries: ${error.message}`);
    return (data as AuditRow[]).map(rowToEntry);
  }

  /**
   * Get audit entries for a specific workspace.
   */
  async listByWorkspace(workspaceId: string, limit = 50): Promise<AuditEntry[]> {
    const { data, error } = await this.client
      .from("terminal_audit_log")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to list workspace audit entries: ${error.message}`);
    return (data as AuditRow[]).map(rowToEntry);
  }

  /**
   * Get audit entries by action type (for admin dashboards).
   */
  async listByAction(action: AuditAction, limit = 100): Promise<AuditEntry[]> {
    const { data, error } = await this.client
      .from("terminal_audit_log")
      .select("*")
      .eq("action", action)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to list audit entries by action: ${error.message}`);
    return (data as AuditRow[]).map(rowToEntry);
  }
}

// ─── Workspace snapshot (for recovery) ───────────────────────────

export interface WorkspaceSnapshot {
  workspaceId: string;
  userId: string;
  projectId: string;
  gitSource: string;
  gitOwner: string | null;
  gitRepo: string | null;
  gitBranch: string | null;
  lastCommitSha: string | null;
  state: string;
  snapshotAt: string;
}

/**
 * Create a recovery snapshot of a workspace's metadata.
 * This does NOT snapshot file contents — it records the workspace
 * state so it can be recreated if the database record is lost.
 */
export async function createWorkspaceSnapshot(
  workspace: {
    workspaceId: string;
    userId: string;
    projectId: string;
    gitSource: string;
    gitOwner: string | null;
    gitRepo: string | null;
    gitBranch: string | null;
    lastCommitSha: string | null;
    state: string;
  },
): Promise<WorkspaceSnapshot> {
  return {
    ...workspace,
    snapshotAt: new Date().toISOString(),
  };
}
