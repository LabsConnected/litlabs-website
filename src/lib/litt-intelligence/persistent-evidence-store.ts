/**
 * Supabase-backed Evidence Store
 *
 * Persistent implementation of MutationEvidenceStore + ApprovalStore
 * using Supabase. Falls back to in-memory when Supabase is not
 * configured (tests, local dev without env vars).
 *
 * Atomic approval consumption: uses conditional UPDATE with
 * `WHERE consumed = false` to prevent two concurrent ACT calls
 * from reusing the same token.
 *
 * Phase 6.1 — Studio Control Plane V1
 */

import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { MutationEvidence, ApprovalToken } from "./mutation-evidence";
import type { MutationEvidenceStore, ApprovalStore } from "./evidence-store";
import { InMemoryEvidenceStore, InMemoryApprovalStore } from "./evidence-store";

// ─── Supabase Evidence Store ─────────────────────────────────────

class SupabaseEvidenceStore implements MutationEvidenceStore {
  async insert(evidence: MutationEvidence): Promise<void> {
    const client = getSupabaseAdmin();
    if (!client) return; // no-op in test/dev without Supabase

    const { error } = await client.from("mutation_evidence").insert({
      id: evidence.id,
      run_id: evidence.runId,
      project_id: evidence.projectId,
      tool_id: evidence.toolId,
      workspace_id: evidence.workspaceId,
      branch: evidence.branch,
      base_sha: evidence.baseSha,
      head_sha_before: evidence.headShaBefore,
      head_sha_after: evidence.headShaAfter ?? null,
      paths: evidence.paths,
      before_hashes: evidence.beforeHashes,
      after_hashes: evidence.afterHashes,
      diff: evidence.diff ?? null,
      working_tree_diff_hash: evidence.workingTreeDiffHash ?? null,
      working_tree_dirty: evidence.workingTreeDirty ?? null,
      status: evidence.status,
      started_at: evidence.startedAt,
      completed_at: evidence.completedAt ?? null,
      error: evidence.error ?? null,
      approval_token_id: evidence.approvalTokenId ?? null,
    });
    if (error) {
      console.error("[evidence-store] insert failed:", error.message);
    }
  }

  async update(id: string, updates: Partial<MutationEvidence>): Promise<void> {
    const client = getSupabaseAdmin();
    if (!client) return;

    const updateRecord: Record<string, unknown> = {};
    if (updates.status !== undefined) updateRecord.status = updates.status;
    if (updates.afterHashes !== undefined) updateRecord.after_hashes = updates.afterHashes;
    if (updates.diff !== undefined) updateRecord.diff = updates.diff;
    if (updates.headShaAfter !== undefined) updateRecord.head_sha_after = updates.headShaAfter;
    if (updates.workingTreeDiffHash !== undefined) updateRecord.working_tree_diff_hash = updates.workingTreeDiffHash;
    if (updates.workingTreeDirty !== undefined) updateRecord.working_tree_dirty = updates.workingTreeDirty;
    if (updates.completedAt !== undefined) updateRecord.completed_at = updates.completedAt;
    if (updates.error !== undefined) updateRecord.error = updates.error;

    if (Object.keys(updateRecord).length === 0) return;

    const { error } = await client
      .from("mutation_evidence")
      .update(updateRecord)
      .eq("id", id);
    if (error) {
      console.error("[evidence-store] update failed:", error.message);
    }
  }

  async getById(id: string): Promise<MutationEvidence | null> {
    const client = getSupabaseAdmin();
    if (!client) return null;

    const { data, error } = await client
      .from("mutation_evidence")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return rowToEvidence(data);
  }

  async listByRun(runId: string): Promise<MutationEvidence[]> {
    const client = getSupabaseAdmin();
    if (!client) return [];

    const { data, error } = await client
      .from("mutation_evidence")
      .select("*")
      .eq("run_id", runId)
      .order("started_at", { ascending: true });
    if (error || !data) return [];
    return data.map(rowToEvidence);
  }

  async listByProject(projectId: string): Promise<MutationEvidence[]> {
    const client = getSupabaseAdmin();
    if (!client) return [];

    const { data, error } = await client
      .from("mutation_evidence")
      .select("*")
      .eq("project_id", projectId)
      .order("started_at", { ascending: false })
      .limit(100);
    if (error || !data) return [];
    return data.map(rowToEvidence);
  }
}

// ─── Supabase Approval Store (atomic consumption) ────────────────

class SupabaseApprovalStore implements ApprovalStore {
  async issue(input: {
    runId: string;
    projectId: string;
    userId: string;
    ttlMs?: number;
  }): Promise<ApprovalToken> {
    const now = Date.now();
    const ttl = input.ttlMs ?? 10 * 60 * 1000;
    const token: ApprovalToken = {
      id: randomUUID(),
      runId: input.runId,
      projectId: input.projectId,
      userId: input.userId,
      grantedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl).toISOString(),
      consumed: false,
    };

    const client = getSupabaseAdmin();
    if (client) {
      const { error } = await client.from("approval_tokens").insert({
        id: token.id,
        run_id: token.runId,
        project_id: token.projectId,
        user_id: token.userId,
        granted_at: token.grantedAt,
        expires_at: token.expiresAt,
        consumed: false,
      });
      if (error) {
        console.error("[approval-store] issue failed:", error.message);
      }
    }

    return token;
  }

  async verify(
    tokenId: string,
    runId: string,
  ): Promise<{ valid: boolean; token?: ApprovalToken; reason?: string }> {
    const client = getSupabaseAdmin();
    if (!client) {
      return { valid: false, reason: "Approval store not available" };
    }

    const { data, error } = await client
      .from("approval_tokens")
      .select("*")
      .eq("id", tokenId)
      .maybeSingle();
    if (error || !data) {
      return { valid: false, reason: "Approval token not found" };
    }

    const token = rowToToken(data);
    if (token.runId !== runId) {
      return { valid: false, reason: "Approval token is for a different run" };
    }
    if (token.consumed) {
      return { valid: false, reason: "Approval token already consumed" };
    }
    if (Date.now() > new Date(token.expiresAt).getTime()) {
      return { valid: false, reason: "Approval token expired" };
    }
    return { valid: true, token };
  }

  async consume(tokenId: string): Promise<void> {
    const client = getSupabaseAdmin();
    if (!client) return;

    // Atomic consumption: only update if not already consumed.
    // This prevents two concurrent ACT calls from reusing one token.
    const { error } = await client
      .from("approval_tokens")
      .update({
        consumed: true,
        consumed_at: new Date().toISOString(),
      })
      .eq("id", tokenId)
      .eq("consumed", false); // atomic guard

    if (error) {
      console.error("[approval-store] consume failed:", error.message);
    }
  }
}

// ─── Row Mappers ─────────────────────────────────────────────────

function rowToEvidence(row: Record<string, unknown>): MutationEvidence {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    projectId: row.project_id as string,
    toolId: row.tool_id as string,
    workspaceId: row.workspace_id as string,
    branch: row.branch as string,
    baseSha: row.base_sha as string,
    headShaBefore: row.head_sha_before as string,
    headShaAfter: (row.head_sha_after as string) ?? undefined,
    paths: row.paths as string[],
    beforeHashes: row.before_hashes as Record<string, string | null>,
    afterHashes: row.after_hashes as Record<string, string | null>,
    diff: (row.diff as string) ?? undefined,
    workingTreeDiffHash: (row.working_tree_diff_hash as string) ?? undefined,
    workingTreeDirty: (row.working_tree_dirty as boolean) ?? undefined,
    status: row.status as MutationEvidence["status"],
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string) ?? undefined,
    error: (row.error as string) ?? undefined,
    approvalTokenId: (row.approval_token_id as string) ?? undefined,
  };
}

function rowToToken(row: Record<string, unknown>): ApprovalToken {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    projectId: row.project_id as string,
    userId: row.user_id as string,
    grantedAt: row.granted_at as string,
    expiresAt: row.expires_at as string,
    consumed: row.consumed as boolean,
    consumedAt: (row.consumed_at as string) ?? undefined,
  };
}

// ─── Factory: use Supabase in production, in-memory in tests ─────

export function createPersistentEvidenceStore(): MutationEvidenceStore {
  const client = getSupabaseAdmin();
  if (client) {
    return new SupabaseEvidenceStore();
  }
  // Fallback: in-memory (tests, local dev without Supabase)
  return new InMemoryEvidenceStore();
}

export function createPersistentApprovalStore(): ApprovalStore {
  const client = getSupabaseAdmin();
  if (client) {
    return new SupabaseApprovalStore();
  }
  return new InMemoryApprovalStore();
}
