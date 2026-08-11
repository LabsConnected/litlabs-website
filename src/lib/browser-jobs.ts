/**
 * Browser Jobs — pure logic and helpers.
 *
 * Extracted from the API routes so it is unit-testable without spinning
 * up Next.js or external services. The routes in
 * src/app/api/browser/jobs/ wire auth, rate limiting, and I/O around
 * these functions.
 *
 * Architecture:
 *   Vapi / Studio / Cron → POST /api/browser/jobs (enqueue) → browser_jobs table
 *   Worker → executeBrowserJob() → browser-session-manager + Stagehand
 *   Client → GET /api/browser/jobs/:id (poll status)
 *
 * Idempotency:
 *   Every job carries a client-supplied idempotencyKey. If a job with
 *   that key already exists, the existing job is returned instead of
 *   creating a duplicate. This makes retry safe.
 *
 * Risk levels:
 *   low    — read-only (inspect, list, screenshot). Automatic.
 *   medium — create/edit draft (create workflow, edit draft, add field). Automatic + log.
 *   high   — publish, delete, mass send, billing, credentials. Requires approval.
 */

import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

// ─── Constants ──────────────────────────────────────────────────

export const JOB_TYPES = [
  "ghl.workflow.inspect",
  "ghl.workflow.list",
  "ghl.workflow.finish",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const JOB_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
  "approved",
  "completed",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const REQUEST_SOURCES = ["vapi", "studio", "cron", "admin"] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

/** Risk level for each job type — determines whether approval is needed. */
export const DEFAULT_RISK_LEVEL: Record<JobType, RiskLevel> = {
  "ghl.workflow.inspect": "low",
  "ghl.workflow.list": "low",
  "ghl.workflow.finish": "medium",
};

// ─── Types ──────────────────────────────────────────────────────

export interface BrowserJob {
  id: string;
  userId: string;
  jobType: JobType;
  goal: string | null;
  riskLevel: RiskLevel;
  requestedBy: RequestSource;
  idempotencyKey: string;
  status: JobStatus;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  progress: JobProgress;
  browserSessionId: string | null;
  liveViewUrl: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface JobProgress {
  step: number;
  totalSteps: number;
  steps: JobStep[];
}

export interface JobStep {
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  detail?: string;
}

export interface CreateJobInput {
  userId: string;
  jobType: JobType;
  goal?: string;
  riskLevel?: RiskLevel;
  requestedBy: RequestSource;
  idempotencyKey?: string;
  params: Record<string, unknown>;
}

export interface CreateJobResult {
  job: BrowserJob;
  created: boolean; // false if returned existing (idempotency hit)
}

// ─── Validation ─────────────────────────────────────────────────

export function isSafeJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}

export function isSafeRiskLevel(value: string): value is RiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(value);
}

export function isSafeRequestSource(value: string): value is RequestSource {
  return (REQUEST_SOURCES as readonly string[]).includes(value);
}

export function isSafeJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

/**
 * Validate a job type parameter. Only known, safe job types are allowed.
 * Returns an error string if invalid, null if valid.
 */
export function validateJobType(value: string): string | null {
  if (!value || typeof value !== "string") return "job_type is required.";
  if (!isSafeJobType(value)) {
    return `Unknown job_type "${value}". Valid types: ${JOB_TYPES.join(", ")}.`;
  }
  return null;
}

/**
 * Generate an idempotency key if one is not provided.
 * Format: <jobType>:<userId>:<randomUUID>
 */
export function generateIdempotencyKey(jobType: JobType, userId: string): string {
  return `${jobType}:${userId}:${randomUUID()}`;
}

// ─── Row mapping ────────────────────────────────────────────────

function rowToJob(row: Record<string, unknown>): BrowserJob {
  const progress = (row.progress as Record<string, unknown>) ?? {};
  const steps = Array.isArray(progress.steps) ? progress.steps : [];
  return {
    id: row.id as string,
    userId: row.user_id as string,
    jobType: row.job_type as JobType,
    goal: (row.goal as string) ?? null,
    riskLevel: row.risk_level as RiskLevel,
    requestedBy: row.requested_by as RequestSource,
    idempotencyKey: row.idempotency_key as string,
    status: row.status as JobStatus,
    params: (row.params as Record<string, unknown>) ?? {},
    result: (row.result as Record<string, unknown>) ?? null,
    error: (row.error as string) ?? null,
    progress: {
      step: (progress.step as number) ?? 0,
      totalSteps: (progress.totalSteps as number) ?? 0,
      steps: steps as JobStep[],
    },
    browserSessionId: (row.browser_session_id as string) ?? null,
    liveViewUrl: (row.live_view_url as string) ?? null,
    approvedBy: (row.approved_by as string) ?? null,
    approvedAt: (row.approved_at as string) ?? null,
    attempts: (row.attempts as number) ?? 0,
    maxAttempts: (row.max_attempts as number) ?? 3,
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    updatedAt: row.updated_at as string,
  };
}

// ─── Database operations ────────────────────────────────────────

/**
 * Create a browser job with idempotency. If a job with the same
 * idempotency_key already exists, return it instead of creating a duplicate.
 */
export async function createJob(input: CreateJobInput): Promise<CreateJobResult> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("Database unavailable");

  const idempotencyKey = input.idempotencyKey ?? generateIdempotencyKey(input.jobType, input.userId);
  const riskLevel = input.riskLevel ?? DEFAULT_RISK_LEVEL[input.jobType];

  // Check for existing job with same idempotency key
  const { data: existing } = await admin
    .from("browser_jobs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    return { job: rowToJob(existing as Record<string, unknown>), created: false };
  }

  const now = new Date().toISOString();
  const row = {
    user_id: input.userId,
    job_type: input.jobType,
    goal: input.goal ?? null,
    risk_level: riskLevel,
    requested_by: input.requestedBy,
    idempotency_key: idempotencyKey,
    status: "queued" as const,
    params: input.params,
    progress: { step: 0, totalSteps: 0, steps: [] },
    attempts: 0,
    max_attempts: 3,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await admin.from("browser_jobs").insert(row).select("*").single();

  if (error) {
    // Race condition: another request inserted the same idempotency key
    // between our check and insert. Re-read the existing row.
    if (error.code === "23505") {
      const { data: retryExisting } = await admin
        .from("browser_jobs")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (retryExisting) {
        return { job: rowToJob(retryExisting as Record<string, unknown>), created: false };
      }
    }
    throw new Error(`Failed to create browser job: ${error.message}`);
  }

  return { job: rowToJob(data as Record<string, unknown>), created: true };
}

/**
 * Get a browser job by ID. Scoped to the user.
 */
export async function getJob(jobId: string, userId: string): Promise<BrowserJob | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin
    .from("browser_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToJob(data as Record<string, unknown>);
}

/**
 * List browser jobs for a user, optionally filtered by status.
 */
export async function listJobs(
  userId: string,
  options: { status?: JobStatus; limit?: number } = {},
): Promise<BrowserJob[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];

  let query = admin
    .from("browser_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 20);

  if (options.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((row) => rowToJob(row as Record<string, unknown>));
}

/**
 * Atomically claim a queued job for execution. Sets status to "running"
 * and increments attempts. Returns null if the job is no longer queued
 * (already claimed or cancelled).
 */
export async function claimJob(jobId: string): Promise<BrowserJob | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const now = new Date().toISOString();

  // Atomic conditional update — only claims if status is still "queued"
  const { data, error } = await admin
    .from("browser_jobs")
    .update({
      status: "running",
      started_at: now,
      updated_at: now,
      attempts: 1, // Will increment properly when we add atomic increment
    })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
    .single();

  if (error || !data) return null;
  return rowToJob(data as Record<string, unknown>);
}

/**
 * Update job progress (step tracking).
 */
export async function updateJobProgress(
  jobId: string,
  progress: JobProgress,
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  await admin
    .from("browser_jobs")
    .update({ progress, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

/**
 * Update the browser session associated with a job.
 */
export async function updateJobSession(
  jobId: string,
  browserSessionId: string,
  liveViewUrl: string | null,
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  await admin
    .from("browser_jobs")
    .update({
      browser_session_id: browserSessionId,
      live_view_url: liveViewUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

/**
 * Mark a job as completed with a result.
 */
export async function completeJob(
  jobId: string,
  result: Record<string, unknown>,
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  const now = new Date().toISOString();
  await admin
    .from("browser_jobs")
    .update({
      status: "completed",
      result,
      error: null,
      completed_at: now,
      updated_at: now,
    })
    .eq("id", jobId);
}

/**
 * Mark a job as failed with an error message.
 */
export async function failJob(jobId: string, error: string): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  const now = new Date().toISOString();
  await admin
    .from("browser_jobs")
    .update({
      status: "failed",
      error,
      completed_at: now,
      updated_at: now,
    })
    .eq("id", jobId);
}

/**
 * Cancel a job. Only works if the job is still queued or awaiting approval.
 * Running jobs cannot be cancelled via this function — the executor must
 * handle cancellation cooperatively.
 */
export async function cancelJob(jobId: string, userId: string): Promise<BrowserJob | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("browser_jobs")
    .update({
      status: "cancelled",
      completed_at: now,
      updated_at: now,
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .in("status", ["queued", "awaiting_approval"])
    .select("*")
    .single();

  if (error || !data) return null;
  return rowToJob(data as Record<string, unknown>);
}

/**
 * Approve a job that is awaiting approval. Sets status to "approved"
 * so the executor can resume. Records who approved and when.
 */
export async function approveJob(
  jobId: string,
  userId: string,
): Promise<BrowserJob | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("browser_jobs")
    .update({
      status: "approved",
      approved_by: userId,
      approved_at: now,
      updated_at: now,
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("status", "awaiting_approval")
    .select("*")
    .single();

  if (error || !data) return null;
  return rowToJob(data as Record<string, unknown>);
}

/**
 * Mark a job as awaiting approval. Used by the executor when it
 * reaches a high-risk action that needs human sign-off.
 */
export async function markAwaitingApproval(
  jobId: string,
  detail: string,
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  await admin
    .from("browser_jobs")
    .update({
      status: "awaiting_approval",
      error: detail, // Store the approval detail in error field temporarily
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "running");
}

// ─── Audit logging ──────────────────────────────────────────────

export interface BrowserJobAuditEntry {
  jobId: string;
  jobType: string;
  userId: string;
  status: string;
  success: boolean;
  durationMs: number;
  error?: string;
  requestedBy: string;
}

/**
 * Write an audit entry for a browser job to agent_logs.
 *
 * Records: job ID, job type, user ID, status, success, duration, source.
 * NEVER logs job params (may contain sensitive data), results, or credentials.
 * Silent fail — logging never blocks the operation.
 */
export async function auditBrowserJob(entry: BrowserJobAuditEntry): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;

    await admin.from("agent_logs").insert({
      agent_id: null,
      level: entry.success ? "info" : "error",
      message: `[browser:job] ${entry.jobType} (${entry.status})`,
      metadata: {
        _type: "browser_job",
        jobId: entry.jobId,
        jobType: entry.jobType,
        userId: entry.userId,
        status: entry.status,
        success: entry.success,
        durationMs: entry.durationMs,
        requestedBy: entry.requestedBy,
        error: entry.error ?? null,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // Silent fail — audit logging must never break the request
  }
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Build initial progress tracking for a job.
 */
export function buildInitialProgress(steps: string[]): JobProgress {
  return {
    step: 0,
    totalSteps: steps.length,
    steps: steps.map((label) => ({ label, status: "pending" as const })),
  };
}

/**
 * Advance progress to a specific step.
 */
export function advanceProgress(progress: JobProgress, stepIndex: number, status: JobStep["status"], detail?: string): JobProgress {
  const steps = progress.steps.map((s, i) => {
    if (i === stepIndex) return { ...s, status, detail };
    return s;
  });
  return { ...progress, step: stepIndex, steps };
}

/**
 * Check if a job type requires approval before execution.
 * High-risk jobs always require approval. Medium-risk jobs may require
 * approval depending on the action (determined by the executor at runtime).
 */
export function requiresPreApproval(riskLevel: RiskLevel): boolean {
  return riskLevel === "high";
}

/**
 * Serialize a job for API response. Strips internal fields and
 * formats for the client.
 */
export function serializeJob(job: BrowserJob): Record<string, unknown> {
  return {
    jobId: job.id,
    jobType: job.jobType,
    goal: job.goal,
    riskLevel: job.riskLevel,
    requestedBy: job.requestedBy,
    status: job.status,
    params: job.params,
    result: job.result,
    error: job.error,
    progress: job.progress,
    browserSessionId: job.browserSessionId,
    liveViewUrl: job.liveViewUrl,
    approvedBy: job.approvedBy,
    approvedAt: job.approvedAt,
    attempts: job.attempts,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}

// ─── Job Events ────────────────────────────────────────────────

export const JOB_EVENT_TYPES = [
  "job.started",
  "step.started",
  "observation",
  "action",
  "verification",
  "step.completed",
  "retry",
  "approval.required",
  "job.completed",
  "job.failed",
] as const;
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];

export interface AgentJobEvent {
  id: string;
  jobId: string;
  type: JobEventType;
  step: number | null;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface EmitJobEventInput {
  jobId: string;
  type: JobEventType;
  step?: number;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append a job event to the browser_job_events table.
 * Silent fail — event logging never blocks job execution.
 */
export async function emitJobEvent(input: EmitJobEventInput): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;

    await admin.from("browser_job_events").insert({
      job_id: input.jobId,
      type: input.type,
      step: input.step ?? null,
      message: input.message,
      metadata: input.metadata ?? {},
    });
  } catch {
    // Silent fail — event logging must never break job execution
  }
}

/**
 * Fetch job events, optionally since a cursor (event ID).
 * Returns events in ascending order (oldest first).
 */
export async function getJobEvents(
  jobId: string,
  options: { sinceId?: string; limit?: number } = {},
): Promise<AgentJobEvent[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];

  let query = admin
    .from("browser_job_events")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
    .limit(options.limit ?? 200);

  if (options.sinceId) {
    // Fetch events created after the cursor event's created_at
    // We use a range filter: gt created_at of the cursor
    const { data: cursor } = await admin
      .from("browser_job_events")
      .select("created_at")
      .eq("id", options.sinceId)
      .maybeSingle();

    if (cursor) {
      query = query.gt("created_at", cursor.created_at as string);
    }
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    jobId: row.job_id as string,
    type: row.type as JobEventType,
    step: (row.step as number) ?? null,
    message: (row.message as string) ?? "",
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
  }));
}

/**
 * Serialize a job event for API response / SSE.
 */
export function serializeJobEvent(event: AgentJobEvent): Record<string, unknown> {
  return {
    id: event.id,
    jobId: event.jobId,
    type: event.type,
    step: event.step,
    message: event.message,
    metadata: event.metadata,
    createdAt: event.createdAt,
  };
}
