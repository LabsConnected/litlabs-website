/**
 * Check Evidence Store
 *
 * Persists CheckEvidence records. Same pattern as evidence-store:
 * in-memory for tests, Supabase for production.
 *
 * Phase 8 — Studio Control Plane V1
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import type { CheckEvidence } from "./check-evidence";

// ─── Interface ───────────────────────────────────────────────────

export interface CheckEvidenceStore {
  insert(check: CheckEvidence): Promise<void>;
  update(id: string, updates: Partial<CheckEvidence>): Promise<void>;
  getById(id: string): Promise<CheckEvidence | null>;
  listByRun(runId: string): Promise<CheckEvidence[]>;
  listByProject(projectId: string, limit?: number): Promise<CheckEvidence[]>;
  /** Mark all checks for a run as stale */
  markStaleByRun(runId: string): Promise<void>;
}

// ─── In-Memory ───────────────────────────────────────────────────

export class InMemoryCheckEvidenceStore implements CheckEvidenceStore {
  private records = new Map<string, CheckEvidence>();

  async insert(check: CheckEvidence): Promise<void> {
    this.records.set(check.id, { ...check });
  }

  async update(id: string, updates: Partial<CheckEvidence>): Promise<void> {
    const existing = this.records.get(id);
    if (!existing) return;
    this.records.set(id, { ...existing, ...updates });
  }

  async getById(id: string): Promise<CheckEvidence | null> {
    return this.records.get(id) ?? null;
  }

  async listByRun(runId: string): Promise<CheckEvidence[]> {
    return Array.from(this.records.values())
      .filter((c) => c.runId === runId)
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  }

  async listByProject(projectId: string, limit = 100): Promise<CheckEvidence[]> {
    return Array.from(this.records.values())
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit);
  }

  async markStaleByRun(runId: string): Promise<void> {
    for (const [id, record] of this.records) {
      if (record.runId === runId) {
        this.records.set(id, { ...record, stale: true });
      }
    }
  }
}

// ─── Supabase ────────────────────────────────────────────────────

class SupabaseCheckEvidenceStore implements CheckEvidenceStore {
  async insert(check: CheckEvidence): Promise<void> {
    const client = getSupabaseAdmin();
    if (!client) return;
    const { error } = await client.from("check_evidence").insert({
      id: check.id,
      run_id: check.runId,
      project_id: check.projectId,
      kind: check.kind,
      command: check.command,
      cwd: check.cwd,
      required: check.required,
      status: check.status,
      exit_code: check.exitCode,
      started_at: check.startedAt,
      completed_at: check.completedAt ?? null,
      duration_ms: check.durationMs ?? null,
      stdout_ref: check.stdoutRef ?? null,
      stderr_ref: check.stderrRef ?? null,
      skip_reason: check.skipReason ?? null,
      failure_reason: check.failureReason ?? null,
      head_sha: check.headSha,
      working_tree_diff_hash: check.workingTreeDiffHash,
      stale: check.stale ?? false,
    });
    if (error) console.error("[check-evidence-store] insert failed:", error.message);
  }

  async update(id: string, updates: Partial<CheckEvidence>): Promise<void> {
    const client = getSupabaseAdmin();
    if (!client) return;
    const updateRecord: Record<string, unknown> = {};
    if (updates.status !== undefined) updateRecord.status = updates.status;
    if (updates.exitCode !== undefined) updateRecord.exit_code = updates.exitCode;
    if (updates.completedAt !== undefined) updateRecord.completed_at = updates.completedAt;
    if (updates.durationMs !== undefined) updateRecord.duration_ms = updates.durationMs;
    if (updates.stdoutRef !== undefined) updateRecord.stdout_ref = updates.stdoutRef;
    if (updates.stderrRef !== undefined) updateRecord.stderr_ref = updates.stderrRef;
    if (updates.skipReason !== undefined) updateRecord.skip_reason = updates.skipReason;
    if (updates.failureReason !== undefined) updateRecord.failure_reason = updates.failureReason;
    if (updates.stale !== undefined) updateRecord.stale = updates.stale;
    if (Object.keys(updateRecord).length === 0) return;
    const { error } = await client.from("check_evidence").update(updateRecord).eq("id", id);
    if (error) console.error("[check-evidence-store] update failed:", error.message);
  }

  async getById(id: string): Promise<CheckEvidence | null> {
    const client = getSupabaseAdmin();
    if (!client) return null;
    const { data, error } = await client.from("check_evidence").select("*").eq("id", id).maybeSingle();
    if (error || !data) return null;
    return rowToCheck(data);
  }

  async listByRun(runId: string): Promise<CheckEvidence[]> {
    const client = getSupabaseAdmin();
    if (!client) return [];
    const { data, error } = await client
      .from("check_evidence")
      .select("*")
      .eq("run_id", runId)
      .order("started_at", { ascending: true });
    if (error || !data) return [];
    return data.map(rowToCheck);
  }

  async listByProject(projectId: string, limit = 100): Promise<CheckEvidence[]> {
    const client = getSupabaseAdmin();
    if (!client) return [];
    const { data, error } = await client
      .from("check_evidence")
      .select("*")
      .eq("project_id", projectId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map(rowToCheck);
  }

  async markStaleByRun(runId: string): Promise<void> {
    const client = getSupabaseAdmin();
    if (!client) return;
    const { error } = await client
      .from("check_evidence")
      .update({ stale: true })
      .eq("run_id", runId)
      .eq("stale", false);
    if (error) console.error("[check-evidence-store] markStale failed:", error.message);
  }
}

function rowToCheck(row: Record<string, unknown>): CheckEvidence {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    projectId: row.project_id as string,
    kind: row.kind as CheckEvidence["kind"],
    command: row.command as string,
    cwd: row.cwd as string,
    required: row.required as boolean,
    status: row.status as CheckEvidence["status"],
    exitCode: (row.exit_code as number) ?? null,
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string) ?? undefined,
    durationMs: (row.duration_ms as number) ?? undefined,
    stdoutRef: (row.stdout_ref as string) ?? undefined,
    stderrRef: (row.stderr_ref as string) ?? undefined,
    skipReason: (row.skip_reason as string) ?? undefined,
    failureReason: (row.failure_reason as string) ?? undefined,
    headSha: row.head_sha as string,
    workingTreeDiffHash: row.working_tree_diff_hash as string,
    stale: (row.stale as boolean) ?? false,
  };
}

// ─── Singleton ───────────────────────────────────────────────────

let checkStoreInstance: CheckEvidenceStore | null = null;

export function getCheckEvidenceStore(): CheckEvidenceStore {
  if (!checkStoreInstance) {
    const client = getSupabaseAdmin();
    checkStoreInstance = client ? new SupabaseCheckEvidenceStore() : new InMemoryCheckEvidenceStore();
  }
  return checkStoreInstance;
}

/** Reset — for testing only */
export function resetCheckEvidenceStore(): void {
  checkStoreInstance = new InMemoryCheckEvidenceStore();
}
