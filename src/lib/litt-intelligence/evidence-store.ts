/**
 * Mutation Evidence Store
 *
 * Persists MutationEvidence records. Currently in-memory for testing
 * and development; will be backed by Supabase in production.
 *
 * The store interface is stable — swapping the backend does not
 * change the mutation service or any consumer.
 *
 * Phase 6 — Studio Control Plane V1
 */

import { randomUUID } from "crypto";
import type { MutationEvidence, ApprovalToken } from "./mutation-evidence";

// ─── Evidence Store ──────────────────────────────────────────────

export interface MutationEvidenceStore {
  /** Insert a new evidence record */
  insert(evidence: MutationEvidence): Promise<void>;
  /** Update an existing evidence record by ID */
  update(id: string, updates: Partial<MutationEvidence>): Promise<void>;
  /** Get a single evidence record by ID */
  getById(id: string): Promise<MutationEvidence | null>;
  /** List evidence records for a run */
  listByRun(runId: string): Promise<MutationEvidence[]>;
  /** List evidence records for a project */
  listByProject(projectId: string): Promise<MutationEvidence[]>;
}

// ─── Approval Store ──────────────────────────────────────────────

export interface ApprovalStore {
  /** Issue a new approval token for a run */
  issue(input: {
    runId: string;
    projectId: string;
    userId: string;
    ttlMs?: number;
  }): Promise<ApprovalToken>;
  /** Verify a token is valid, not expired, not consumed, and matches the run */
  verify(tokenId: string, runId: string): Promise<{
    valid: boolean;
    token?: ApprovalToken;
    reason?: string;
  }>;
  /** Mark a token as consumed */
  consume(tokenId: string): Promise<void>;
}

// ─── In-Memory Implementations ───────────────────────────────────

export class InMemoryEvidenceStore implements MutationEvidenceStore {
  private records = new Map<string, MutationEvidence>();

  async insert(evidence: MutationEvidence): Promise<void> {
    this.records.set(evidence.id, { ...evidence });
  }

  async update(id: string, updates: Partial<MutationEvidence>): Promise<void> {
    const existing = this.records.get(id);
    if (!existing) return;
    this.records.set(id, { ...existing, ...updates });
  }

  async getById(id: string): Promise<MutationEvidence | null> {
    return this.records.get(id) ?? null;
  }

  async listByRun(runId: string): Promise<MutationEvidence[]> {
    return Array.from(this.records.values()).filter((e) => e.runId === runId);
  }

  async listByProject(projectId: string): Promise<MutationEvidence[]> {
    return Array.from(this.records.values()).filter((e) => e.projectId === projectId);
  }
}

export class InMemoryApprovalStore implements ApprovalStore {
  private tokens = new Map<string, ApprovalToken>();

  async issue(input: {
    runId: string;
    projectId: string;
    userId: string;
    ttlMs?: number;
  }): Promise<ApprovalToken> {
    const now = Date.now();
    const ttl = input.ttlMs ?? 10 * 60 * 1000; // 10 minutes default
    const token: ApprovalToken = {
      id: randomUUID(),
      runId: input.runId,
      projectId: input.projectId,
      userId: input.userId,
      grantedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl).toISOString(),
      consumed: false,
    };
    this.tokens.set(token.id, token);
    return token;
  }

  async verify(
    tokenId: string,
    runId: string,
  ): Promise<{ valid: boolean; token?: ApprovalToken; reason?: string }> {
    const token = this.tokens.get(tokenId);
    if (!token) {
      return { valid: false, reason: "Approval token not found" };
    }
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
    const token = this.tokens.get(tokenId);
    if (token) {
      this.tokens.set(tokenId, {
        ...token,
        consumed: true,
        consumedAt: new Date().toISOString(),
      });
    }
  }
}

// ─── Singletons ──────────────────────────────────────────────────
//
// In production, these use Supabase-backed persistent stores.
// In tests (resetStores()), these use in-memory stores.
// The mutation-service.ts calls getEvidenceStore()/getApprovalStore()
// which are the canonical entry points.

let evidenceStoreInstance: MutationEvidenceStore | null = null;
let approvalStoreInstance: ApprovalStore | null = null;

export function getEvidenceStore(): MutationEvidenceStore {
  if (!evidenceStoreInstance) {
    // Lazy-load persistent store to avoid circular import at module load
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createPersistentEvidenceStore } = require("./persistent-evidence-store") as {
      createPersistentEvidenceStore: () => MutationEvidenceStore;
    };
    evidenceStoreInstance = createPersistentEvidenceStore();
  }
  return evidenceStoreInstance;
}

export function getApprovalStore(): ApprovalStore {
  if (!approvalStoreInstance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createPersistentApprovalStore } = require("./persistent-evidence-store") as {
      createPersistentApprovalStore: () => ApprovalStore;
    };
    approvalStoreInstance = createPersistentApprovalStore();
  }
  return approvalStoreInstance;
}

/** Reset stores — for testing only. Forces in-memory. */
export function resetStores(): void {
  evidenceStoreInstance = new InMemoryEvidenceStore();
  approvalStoreInstance = new InMemoryApprovalStore();
}
