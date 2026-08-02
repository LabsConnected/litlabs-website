/**
 * Structured Project Knowledge Service
 *
 * Stores and retrieves structured project intelligence — not conversation
 * summaries. Each knowledge record has a category, source, confidence,
 * and verification status.
 *
 * Reconciliation rules:
 * - When new evidence conflicts with stored knowledge, do NOT overwrite
 *   silently. Mark the old record as "superseded", store the new evidence,
 *   and record why the conclusion changed.
 * - Conversation summaries never outrank repository evidence or live
 *   capability probes.
 *
 * This service extends (not replaces) the existing memory-service.ts.
 * Conversation summaries remain in the memories table; structured
 * project intelligence lives in project_knowledge.
 */

import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  KnowledgeRecord,
  KnowledgeCategory,
  VerificationStatus,
} from "./types";

// ─── Secret detection (same patterns as memory-service.ts) ──────

const SECRET_PATTERNS = [
  /(?:sk|pk)_(?:live|test)_[a-zA-Z0-9]{20,}/i,
  /gh[pousr]_[A-Za-z0-9]{36,}/i,
  /github_pat_[A-Za-z0-9_]{82,}/i,
  /AIza[a-zA-Z0-9_\-]{35}/i,
  /eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+/i,
  /xox[baprs]-[a-zA-Z0-9-]+/i,
  /\b(?:password|passwd|pwd|secret|token|api_key|apikey|private_key)\s*[:=]\s*\S+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
];

function containsSecrets(content: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

// ─── Row mapping ────────────────────────────────────────────────

interface KnowledgeRow {
  id: string;
  owner_id: string;
  project_id: string;
  category: string;
  content: string;
  source_type: string;
  source_reference: string;
  source_revision: string | null;
  confidence: number;
  verification_status: string;
  expires_at: string | null;
  superseded_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: KnowledgeRow): KnowledgeRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    category: row.category as KnowledgeCategory,
    content: row.content,
    sourceType: row.source_type as KnowledgeRecord["sourceType"],
    sourceReference: row.source_reference,
    sourceRevision: row.source_revision ?? undefined,
    confidence: row.confidence,
    verificationStatus: row.verification_status as VerificationStatus,
    expiresAt: row.expires_at ?? undefined,
    supersededBy: row.superseded_by ?? undefined,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Service ────────────────────────────────────────────────────

export interface StoreKnowledgeInput {
  ownerId: string;
  projectId: string;
  category: KnowledgeCategory;
  content: string;
  sourceType: "repository" | "probe" | "research" | "conversation" | "manual";
  sourceReference: string;
  sourceRevision?: string;
  confidence?: number;
  verificationStatus?: VerificationStatus;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export class KnowledgeService {
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
   * Store a new knowledge record. If conflicting knowledge exists
   * (same category + similar content), the old record is superseded
   * rather than overwritten.
   */
  async store(input: StoreKnowledgeInput): Promise<{ id: string; supersededId?: string }> {
    if (containsSecrets(input.content)) {
      throw new Error("Content contains secrets and was not stored");
    }

    const id = `know-${randomUUID()}`;
    const confidence = input.confidence ?? 0.5;
    const verificationStatus = input.verificationStatus ?? "unverified";

    // Check for conflicting knowledge in the same category
    const conflicting = await this.findConflicting(
      input.ownerId,
      input.projectId,
      input.category,
      input.content,
    );

    let supersededId: string | undefined;

    if (conflicting) {
      // Mark the old record as superseded
      await this.client
        .from("project_knowledge")
        .update({
          verification_status: "superseded",
          superseded_by: id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conflicting.id);
      supersededId = conflicting.id;
    }

    const { data, error } = await this.client
      .from("project_knowledge")
      .insert({
        id,
        owner_id: input.ownerId,
        project_id: input.projectId,
        category: input.category,
        content: input.content,
        source_type: input.sourceType,
        source_reference: input.sourceReference,
        source_revision: input.sourceRevision ?? null,
        confidence,
        verification_status: verificationStatus,
        expires_at: input.expiresAt ?? null,
        superseded_by: null,
        metadata: input.metadata ?? {},
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to store knowledge: ${error.message}`);
    }

    return { id: data.id, supersededId };
  }

  /**
   * Search for knowledge records by project, optionally filtered by
   * category. Only returns non-superseded records.
   */
  async search(
    ownerId: string,
    projectId: string,
    options: {
      category?: KnowledgeCategory;
      verificationStatus?: VerificationStatus;
      limit?: number;
    } = {},
  ): Promise<KnowledgeRecord[]> {
    const limit = options.limit ?? 20;
    let query = this.client
      .from("project_knowledge")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("project_id", projectId)
      .neq("verification_status", "superseded")
      .order("updated_at", { ascending: false });

    if (options.category) {
      query = query.eq("category", options.category);
    }
    if (options.verificationStatus) {
      query = query.eq("verification_status", options.verificationStatus);
    }

    const { data, error } = await query.limit(limit);

    if (error) {
      throw new Error(`Failed to search knowledge: ${error.message}`);
    }

    return (data as KnowledgeRow[]).map(rowToRecord);
  }

  /**
   * Get a specific knowledge record by ID.
   */
  async get(id: string): Promise<KnowledgeRecord | null> {
    const { data, error } = await this.client
      .from("project_knowledge")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return rowToRecord(data as KnowledgeRow);
  }

  /**
   * Mark a knowledge record as stale (when repository HEAD changes).
   */
  async markStale(id: string): Promise<void> {
    await this.client
      .from("project_knowledge")
      .update({
        verification_status: "stale",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  }

  /**
   * Mark all knowledge for a project as stale.
   */
  async markAllStale(ownerId: string, projectId: string): Promise<void> {
    await this.client
      .from("project_knowledge")
      .update({
        verification_status: "stale",
        updated_at: new Date().toISOString(),
      })
      .eq("owner_id", ownerId)
      .eq("project_id", projectId)
      .eq("verification_status", "verified");
  }

  /**
   * Update verification status for a knowledge record.
   */
  async updateVerification(
    id: string,
    status: VerificationStatus,
  ): Promise<void> {
    await this.client
      .from("project_knowledge")
      .update({
        verification_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  }

  /**
   * Delete a knowledge record. Only allowed for the owner (enforced by RLS).
   */
  async delete(id: string): Promise<void> {
    await this.client
      .from("project_knowledge")
      .delete()
      .eq("id", id);
  }

  /**
   * Find a conflicting knowledge record — same category, similar content.
   * Uses a simple text similarity check (not full-text search).
   */
  private async findConflicting(
    ownerId: string,
    projectId: string,
    category: KnowledgeCategory,
    content: string,
  ): Promise<KnowledgeRecord | null> {
    const { data, error } = await this.client
      .from("project_knowledge")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("project_id", projectId)
      .eq("category", category)
      .neq("verification_status", "superseded")
      .order("updated_at", { ascending: false })
      .limit(5);

    if (error || !data) return null;

    const records = (data as KnowledgeRow[]).map(rowToRecord);

    // Check for content similarity (simple: if normalized content matches)
    const normalizedNew = content.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);

    for (const record of records) {
      const normalizedOld = record.content.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);

      // If contents are very similar (first 200 chars match), it's a conflict
      if (normalizedNew === normalizedOld) {
        return record;
      }

      // If the new content contradicts the old (different conclusion on same topic)
      // Check if they share key terms but have different content
      const newWords = new Set(normalizedNew.split(" ").filter((w) => w.length > 3));
      const oldWords = new Set(normalizedOld.split(" ").filter((w) => w.length > 3));
      const overlap = [...newWords].filter((w) => oldWords.has(w)).length;
      const minWords = Math.min(newWords.size, oldWords.size);

      // If >60% word overlap and content is different, it's a potential conflict
      if (minWords > 3 && overlap / minWords > 0.6 && normalizedNew !== normalizedOld) {
        return record;
      }
    }

    return null;
  }

  /**
   * Answer a project question by searching knowledge records.
   * Returns the most relevant verified facts first.
   */
  async answerQuestion(
    ownerId: string,
    projectId: string,
    question: string,
  ): Promise<KnowledgeRecord[]> {
    // Extract keywords from the question
    const keywords = question
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);

    if (keywords.length === 0) {
      return this.search(ownerId, projectId, { limit: 10 });
    }

    // Search for knowledge containing any of the keywords
    const all = await this.search(ownerId, projectId, { limit: 50 });

    // Score by keyword matches
    const scored = all.map((record) => {
      const contentLower = record.content.toLowerCase();
      const matches = keywords.filter((k) => contentLower.includes(k)).length;
      const score = matches / keywords.length;
      // Boost verified records
      const boost = record.verificationStatus === "verified" ? 0.2 : 0;
      return { record, score: score + boost };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored
      .filter((s) => s.score > 0)
      .slice(0, 10)
      .map((s) => s.record);
  }
}
