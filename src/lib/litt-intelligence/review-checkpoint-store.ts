/**
 * Review Checkpoint Store
 *
 * Persists ReviewCheckpoint records. Same pattern as the other stores.
 *
 * Phase 10 — Studio Control Plane V1
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import type { ReviewCheckpoint } from "./review-checkpoint";

// ─── Interface ───────────────────────────────────────────────────

export interface ReviewCheckpointStore {
  insert(checkpoint: ReviewCheckpoint): Promise<void>;
  update(id: string, updates: Partial<ReviewCheckpoint>): Promise<void>;
  getById(id: string): Promise<ReviewCheckpoint | null>;
  listByRun(runId: string): Promise<ReviewCheckpoint[]>;
  listByProject(projectId: string, limit?: number): Promise<ReviewCheckpoint[]>;
  /** Get the latest checkpoint for a run */
  getLatestForRun(runId: string): Promise<ReviewCheckpoint | null>;
  /** Mark all checkpoints for a run as stale */
  markStaleByRun(runId: string, reason: string): Promise<void>;
}

// ─── In-Memory ───────────────────────────────────────────────────

export class InMemoryReviewCheckpointStore implements ReviewCheckpointStore {
  private records = new Map<string, ReviewCheckpoint>();

  async insert(checkpoint: ReviewCheckpoint): Promise<void> {
    this.records.set(checkpoint.id, { ...checkpoint });
  }

  async update(id: string, updates: Partial<ReviewCheckpoint>): Promise<void> {
    const existing = this.records.get(id);
    if (!existing) return;
    this.records.set(id, { ...existing, ...updates });
  }

  async getById(id: string): Promise<ReviewCheckpoint | null> {
    return this.records.get(id) ?? null;
  }

  async listByRun(runId: string): Promise<ReviewCheckpoint[]> {
    return Array.from(this.records.values())
      .filter((c) => c.runId === runId)
      .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  }

  async listByProject(projectId: string, limit = 50): Promise<ReviewCheckpoint[]> {
    return Array.from(this.records.values())
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
      .slice(0, limit);
  }

  async getLatestForRun(runId: string): Promise<ReviewCheckpoint | null> {
    const all = await this.listByRun(runId);
    return all[all.length - 1] ?? null;
  }

  async markStaleByRun(runId: string, reason: string): Promise<void> {
    for (const [id, record] of this.records) {
      if (record.runId === runId) {
        this.records.set(id, { ...record, stale: true, staleReason: reason, decision: "stale" });
      }
    }
  }
}

// ─── Supabase ────────────────────────────────────────────────────

class SupabaseReviewCheckpointStore implements ReviewCheckpointStore {
  async insert(checkpoint: ReviewCheckpoint): Promise<void> {
    const client = getSupabaseAdmin();
    if (!client) return;
    const { error } = await client.from("review_checkpoints").insert({
      id: checkpoint.id,
      run_id: checkpoint.runId,
      project_id: checkpoint.projectId,
      decision: checkpoint.decision,
      head_sha: checkpoint.headSha,
      working_tree_diff_hash: checkpoint.workingTreeDiffHash,
      mutation_evidence_ids: checkpoint.mutationEvidenceIds,
      check_evidence_ids: checkpoint.checkEvidenceIds,
      acceptance_evidence_ids: checkpoint.acceptanceEvidenceIds,
      reviewer_user_id: checkpoint.reviewerUserId ?? null,
      reviewed_at: checkpoint.reviewedAt ?? null,
      review_comments: checkpoint.reviewComments ?? null,
      blockers: checkpoint.blockers,
      stale: checkpoint.stale,
      stale_reason: checkpoint.staleReason ?? null,
      captured_at: checkpoint.capturedAt,
    });
    if (error) console.error("[review-checkpoint-store] insert failed:", error.message);
  }

  async update(id: string, updates: Partial<ReviewCheckpoint>): Promise<void> {
    const client = getSupabaseAdmin();
    if (!client) return;
    const updateRecord: Record<string, unknown> = {};
    if (updates.decision !== undefined) updateRecord.decision = updates.decision;
    if (updates.reviewerUserId !== undefined) updateRecord.reviewer_user_id = updates.reviewerUserId;
    if (updates.reviewedAt !== undefined) updateRecord.reviewed_at = updates.reviewedAt;
    if (updates.reviewComments !== undefined) updateRecord.review_comments = updates.reviewComments;
    if (updates.stale !== undefined) updateRecord.stale = updates.stale;
    if (updates.staleReason !== undefined) updateRecord.stale_reason = updates.staleReason;
    if (Object.keys(updateRecord).length === 0) return;
    const { error } = await client.from("review_checkpoints").update(updateRecord).eq("id", id);
    if (error) console.error("[review-checkpoint-store] update failed:", error.message);
  }

  async getById(id: string): Promise<ReviewCheckpoint | null> {
    const client = getSupabaseAdmin();
    if (!client) return null;
    const { data, error } = await client.from("review_checkpoints").select("*").eq("id", id).maybeSingle();
    if (error || !data) return null;
    return rowToCheckpoint(data);
  }

  async listByRun(runId: string): Promise<ReviewCheckpoint[]> {
    const client = getSupabaseAdmin();
    if (!client) return [];
    const { data, error } = await client
      .from("review_checkpoints")
      .select("*")
      .eq("run_id", runId)
      .order("captured_at", { ascending: true });
    if (error || !data) return [];
    return data.map(rowToCheckpoint);
  }

  async listByProject(projectId: string, limit = 50): Promise<ReviewCheckpoint[]> {
    const client = getSupabaseAdmin();
    if (!client) return [];
    const { data, error } = await client
      .from("review_checkpoints")
      .select("*")
      .eq("project_id", projectId)
      .order("captured_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map(rowToCheckpoint);
  }

  async getLatestForRun(runId: string): Promise<ReviewCheckpoint | null> {
    const client = getSupabaseAdmin();
    if (!client) return null;
    const { data, error } = await client
      .from("review_checkpoints")
      .select("*")
      .eq("run_id", runId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return rowToCheckpoint(data);
  }

  async markStaleByRun(runId: string, reason: string): Promise<void> {
    const client = getSupabaseAdmin();
    if (!client) return;
    const { error } = await client
      .from("review_checkpoints")
      .update({ stale: true, stale_reason: reason, decision: "stale" })
      .eq("run_id", runId)
      .eq("stale", false);
    if (error) console.error("[review-checkpoint-store] markStale failed:", error.message);
  }
}

function rowToCheckpoint(row: Record<string, unknown>): ReviewCheckpoint {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    projectId: row.project_id as string,
    decision: row.decision as ReviewCheckpoint["decision"],
    headSha: row.head_sha as string,
    workingTreeDiffHash: row.working_tree_diff_hash as string,
    mutationEvidenceIds: (row.mutation_evidence_ids as string[]) ?? [],
    checkEvidenceIds: (row.check_evidence_ids as string[]) ?? [],
    acceptanceEvidenceIds: (row.acceptance_evidence_ids as string[]) ?? [],
    reviewerUserId: (row.reviewer_user_id as string) ?? undefined,
    reviewedAt: (row.reviewed_at as string) ?? undefined,
    reviewComments: (row.review_comments as string) ?? undefined,
    blockers: (row.blockers as string[]) ?? [],
    stale: (row.stale as boolean) ?? false,
    staleReason: (row.stale_reason as string) ?? undefined,
    capturedAt: row.captured_at as string,
  };
}

// ─── Singleton ───────────────────────────────────────────────────

let reviewCheckpointStoreInstance: ReviewCheckpointStore | null = null;

export function getReviewCheckpointStore(): ReviewCheckpointStore {
  if (!reviewCheckpointStoreInstance) {
    const client = getSupabaseAdmin();
    reviewCheckpointStoreInstance = client ? new SupabaseReviewCheckpointStore() : new InMemoryReviewCheckpointStore();
  }
  return reviewCheckpointStoreInstance;
}

/** Reset — for testing only */
export function resetReviewCheckpointStore(): void {
  reviewCheckpointStoreInstance = new InMemoryReviewCheckpointStore();
}
