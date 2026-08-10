import "server-only";

/**
 * In-memory video generation job store for server-authoritative billing.
 *
 * Stores the server-determined cost, user, and refund status so that
 * the status/refund route never trusts client-supplied cost.
 *
 * In production this should be backed by a persistent store (Supabase),
 * but the in-memory map is sufficient for the single-instance Vercel
 * Node.js runtime where polling happens within the same invocation context.
 */

export type VideoJob = {
  jobId: string;
  userId: string;
  provider: "veo" | "alibaba";
  providerOperationId: string;
  model: string;
  cost: number;
  status: "pending" | "done" | "failed";
  createdAt: number;
  charged: boolean;
  refunded: boolean;
};

const store = new Map<string, VideoJob>();

export function createVideoJob(job: VideoJob): void {
  store.set(job.jobId, job);
}

export function getVideoJob(jobId: string): VideoJob | undefined {
  return store.get(jobId);
}

export function markVideoJobDone(jobId: string): void {
  const job = store.get(jobId);
  if (job) job.status = "done";
}

export function markVideoJobFailed(jobId: string): void {
  const job = store.get(jobId);
  if (job) job.status = "failed";
}

export function markVideoJobRefunded(jobId: string): boolean {
  const job = store.get(jobId);
  if (!job || job.refunded) return false;
  job.refunded = true;
  return true;
}

/**
 * Find a job by provider operation ID (for Veo polling).
 */
export function findJobByOperationId(operationId: string): VideoJob | undefined {
  for (const job of store.values()) {
    if (job.providerOperationId === operationId) return job;
  }
  return undefined;
}
