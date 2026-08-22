/**
 * Acceptance Evidence Store
 *
 * Persists AcceptanceEvidence records. Same pattern as the other stores:
 * in-memory for tests, Supabase for production.
 *
 * Phase 9 — Studio Control Plane V1
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import type { AcceptanceEvidence } from "./acceptance-evidence";

// ─── Interface ───────────────────────────────────────────────────

export interface AcceptanceEvidenceStore {
  insert(evidence: AcceptanceEvidence): Promise<void>;
  update(id: string, updates: Partial<AcceptanceEvidence>): Promise<void>;
  getById(id: string): Promise<AcceptanceEvidence | null>;
  listByRun(runId: string): Promise<AcceptanceEvidence[]>;
  listByProject(projectId: string, limit?: number): Promise<AcceptanceEvidence[]>;
  /** Mark all acceptance evidence for a run as stale */
  markStaleByRun(runId: string): Promise<void>;
  /** Check if a criterion already exists for a run (prevents dropping) */
  criterionExists(runId: string, criterion: string): Promise<boolean>;
}

// ─── In-Memory ───────────────────────────────────────────────────

export class InMemoryAcceptanceEvidenceStore implements AcceptanceEvidenceStore {
  private records = new Map<string, AcceptanceEvidence>();

  async insert(evidence: AcceptanceEvidence): Promise<void> {
    this.records.set(evidence.id, { ...evidence });
  }

  async update(id: string, updates: Partial<AcceptanceEvidence>): Promise<void> {
    const existing = this.records.get(id);
    if (!existing) return;
    this.records.set(id, { ...existing, ...updates });
  }

  async getById(id: string): Promise<AcceptanceEvidence | null> {
    return this.records.get(id) ?? null;
  }

  async listByRun(runId: string): Promise<AcceptanceEvidence[]> {
    return Array.from(this.records.values())
      .filter((e) => e.runId === runId)
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  }

  async listByProject(projectId: string, limit = 100): Promise<AcceptanceEvidence[]> {
    return Array.from(this.records.values())
      .filter((e) => e.projectId === projectId)
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

  async criterionExists(runId: string, criterion: string): Promise<boolean> {
    return Array.from(this.records.values()).some(
      (e) => e.runId === runId && e.criterion === criterion,
    );
  }
}

// ─── Supabase ────────────────────────────────────────────────────

class SupabaseAcceptanceEvidenceStore implements AcceptanceEvidenceStore {
  async insert(evidence: AcceptanceEvidence): Promise<void> {
    const client = getSupabaseAdmin();
    if (!client) return;
    const { error } = await client.from("acceptance_evidence").insert({
      id: evidence.id,
      run_id: evidence.runId,
      project_id: evidence.projectId,
      criterion: evidence.criterion,
      required: evidence.required,
      status: evidence.status,
      verification_source: evidence.verificationSource ?? null,
      evidence_refs: evidence.evidenceRefs,
      verification_summary: evidence.verificationSummary ?? null,
      failure_reason: evidence.failureReason ?? null,
      skip_reason: evidence.skipReason ?? null,
      head_sha: evidence.headSha,
      working_tree_diff_hash: evidence.workingTreeDiffHash,
      stale: evidence.stale,
      started_at: evidence.startedAt,
      completed_at: evidence.completedAt ?? null,
      duration_ms: evidence.durationMs ?? null,
    });
    if (error) console.error("[acceptance-store] insert failed:", error.message);
  }

  async update(id: string, updates: Partial<AcceptanceEvidence>): Promise<void> {
    const client = getSupabaseAdmin();
    if (!client) return;
    const updateRecord: Record<string, unknown> = {};
    if (updates.status !== undefined) updateRecord.status = updates.status;
    if (updates.verificationSource !== undefined) updateRecord.verification_source = updates.verificationSource;
    if (updates.evidenceRefs !== undefined) updateRecord.evidence_refs = updates.evidenceRefs;
    if (updates.verificationSummary !== undefined) updateRecord.verification_summary = updates.verificationSummary;
    if (updates.failureReason !== undefined) updateRecord.failure_reason = updates.failureReason;
    if (updates.skipReason !== undefined) updateRecord.skip_reason = updates.skipReason;
    if (updates.stale !== undefined) updateRecord.stale = updates.stale;
    if (updates.completedAt !== undefined) updateRecord.completed_at = updates.completedAt;
    if (updates.durationMs !== undefined) updateRecord.duration_ms = updates.durationMs;
    if (Object.keys(updateRecord).length === 0) return;
    const { error } = await client.from("acceptance_evidence").update(updateRecord).eq("id", id);
    if (error) console.error("[acceptance-store] update failed:", error.message);
  }

  async getById(id: string): Promise<AcceptanceEvidence | null> {
    const client = getSupabaseAdmin();
    if (!client) return null;
    const { data, error } = await client.from("acceptance_evidence").select("*").eq("id", id).maybeSingle();
    if (error || !data) return null;
    return rowToEvidence(data);
  }

  async listByRun(runId: string): Promise<AcceptanceEvidence[]> {
    const client = getSupabaseAdmin();
    if (!client) return [];
    const { data, error } = await client
      .from("acceptance_evidence")
      .select("*")
      .eq("run_id", runId)
      .order("started_at", { ascending: true });
    if (error || !data) return [];
    return data.map(rowToEvidence);
  }

  async listByProject(projectId: string, limit = 100): Promise<AcceptanceEvidence[]> {
    const client = getSupabaseAdmin();
    if (!client) return [];
    const { data, error } = await client
      .from("acceptance_evidence")
      .select("*")
      .eq("project_id", projectId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map(rowToEvidence);
  }

  async markStaleByRun(runId: string): Promise<void> {
    const client = getSupabaseAdmin();
    if (!client) return;
    const { error } = await client
      .from("acceptance_evidence")
      .update({ stale: true })
      .eq("run_id", runId)
      .eq("stale", false);
    if (error) console.error("[acceptance-store] markStale failed:", error.message);
  }

  async criterionExists(runId: string, criterion: string): Promise<boolean> {
    const client = getSupabaseAdmin();
    if (!client) return false;
    const { data, error } = await client
      .from("acceptance_evidence")
      .select("id")
      .eq("run_id", runId)
      .eq("criterion", criterion)
      .limit(1);
    if (error || !data) return false;
    return data.length > 0;
  }
}

function rowToEvidence(row: Record<string, unknown>): AcceptanceEvidence {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    projectId: row.project_id as string,
    criterion: row.criterion as string,
    required: row.required as boolean,
    status: row.status as AcceptanceEvidence["status"],
    verificationSource: (row.verification_source as AcceptanceEvidence["verificationSource"]) ?? undefined,
    evidenceRefs: (row.evidence_refs as string[]) ?? [],
    verificationSummary: (row.verification_summary as string) ?? undefined,
    failureReason: (row.failure_reason as string) ?? undefined,
    skipReason: (row.skip_reason as string) ?? undefined,
    headSha: row.head_sha as string,
    workingTreeDiffHash: row.working_tree_diff_hash as string,
    stale: (row.stale as boolean) ?? false,
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string) ?? undefined,
    durationMs: (row.duration_ms as number) ?? undefined,
  };
}

// ─── Singleton ───────────────────────────────────────────────────

let acceptanceStoreInstance: AcceptanceEvidenceStore | null = null;

export function getAcceptanceEvidenceStore(): AcceptanceEvidenceStore {
  if (!acceptanceStoreInstance) {
    const client = getSupabaseAdmin();
    acceptanceStoreInstance = client ? new SupabaseAcceptanceEvidenceStore() : new InMemoryAcceptanceEvidenceStore();
  }
  return acceptanceStoreInstance;
}

/** Reset — for testing only */
export function resetAcceptanceEvidenceStore(): void {
  acceptanceStoreInstance = new InMemoryAcceptanceEvidenceStore();
}
