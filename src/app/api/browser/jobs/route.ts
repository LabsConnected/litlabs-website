import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { authorizeVapiRequest, ownerClerkId } from "@/lib/vapi-tools";
import {
  createJob,
  listJobs,
  serializeJob,
  validateJobType,
  isSafeRiskLevel,
  isSafeRequestSource,
  type JobType,
  type JobStatus,
  type RiskLevel,
  type RequestSource,
} from "@/lib/browser-jobs";
import { executeBrowserJob } from "@/lib/browser-job-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/browser/jobs
 *
 * Enqueue a browser job. Returns immediately with the jobId — the
 * actual browser execution happens asynchronously.
 *
 * Auth (dual mode):
 *   1. Bearer token: Authorization: Bearer <LITTLABS_VAPI_TOOL_TOKEN>
 *      → Vapi mode, scoped to LITTLABS_VAPI_OWNER_CLERK_ID
 *   2. Clerk session cookie or Bearer JWT
 *      → Studio mode, scoped to the authenticated user
 *
 * Body:
 *   {
 *     job_type: string,       // e.g. "ghl.workflow.inspect"
 *     goal?: string,          // human-readable goal
 *     risk_level?: string,    // "low" | "medium" | "high" (defaults per job type)
 *     requested_by?: string,  // "vapi" | "studio" | "cron" | "admin"
 *     idempotency_key?: string, // client-supplied, prevents duplicates
 *     params: object,         // job-type-specific parameters
 *   }
 *
 * Response:
 *   { job: { jobId, status, ... }, created: boolean }
 *
 * GET /api/browser/jobs
 *   List recent browser jobs for the authenticated user.
 *   Query: ?status=queued|running|completed|failed|cancelled
 */
async function handler(req: NextRequest) {
  // ─── Dual auth ───────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";

  let userId: string | null = null;
  let requestedByDefault: RequestSource = "studio";

  // Try Vapi bearer token first
  if (authorizeVapiRequest(authHeader)) {
    userId = ownerClerkId();
    requestedByDefault = "vapi";
  } else {
    // Fall back to Clerk auth
    const authResult = await auth(req);
    userId = authResult.userId;
    requestedByDefault = "studio";
  }

  if (!userId || userId === "anonymous-dev") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── GET: list jobs ──────────────────────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? undefined;
    const jobs = await listJobs(userId, { status: status as JobStatus | undefined, limit: 20 });
    return NextResponse.json({ jobs: jobs.map(serializeJob) });
  }

  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ─── POST: enqueue job ───────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate job_type
  const jobType = typeof body.job_type === "string" ? body.job_type : "";
  const typeError = validateJobType(jobType);
  if (typeError) {
    return NextResponse.json({ error: typeError }, { status: 400 });
  }

  // Validate risk_level if provided
  const riskLevelRaw = typeof body.risk_level === "string" ? body.risk_level : undefined;
  if (riskLevelRaw && !isSafeRiskLevel(riskLevelRaw)) {
    return NextResponse.json(
      { error: `Invalid risk_level. Valid: low, medium, high.` },
      { status: 400 },
    );
  }

  // Validate requested_by if provided
  const requestedByRaw = typeof body.requested_by === "string" ? body.requested_by : undefined;
  if (requestedByRaw && !isSafeRequestSource(requestedByRaw)) {
    return NextResponse.json(
      { error: `Invalid requested_by. Valid: vapi, studio, cron, admin.` },
      { status: 400 },
    );
  }

  // Validate params
  const params = (body.params as Record<string, unknown>) ?? {};
  if (typeof params !== "object" || Array.isArray(params)) {
    return NextResponse.json({ error: "params must be an object" }, { status: 400 });
  }

  // Validate idempotency_key if provided
  const idempotencyKey = typeof body.idempotency_key === "string" && body.idempotency_key.length > 0
    ? body.idempotency_key
    : undefined;
  if (idempotencyKey && idempotencyKey.length > 200) {
    return NextResponse.json(
      { error: "idempotency_key must be 200 characters or less" },
      { status: 400 },
    );
  }

  try {
    const { job, created } = await createJob({
      userId,
      jobType: jobType as JobType,
      goal: typeof body.goal === "string" ? body.goal : undefined,
      riskLevel: riskLevelRaw as RiskLevel | undefined,
      requestedBy: (requestedByRaw as RequestSource | undefined) ?? requestedByDefault,
      idempotencyKey,
      params,
    });

    // Trigger async execution only for newly created jobs
    // (idempotent re-submissions don't re-execute)
    if (created && job.status === "queued") {
      after(() => executeBrowserJob(job.id, userId!).catch(() => {}));
    }

    return NextResponse.json(
      { job: serializeJob(job), created },
      { status: created ? 201 : 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create browser job", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(handler, 30, 60);
export const POST = withRateLimit(handler, 10, 60); // stricter for job creation
