import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { authorizeVapiRequest, ownerClerkId } from "@/lib/vapi-tools";
import {
  getJob,
  cancelJob,
  approveJob,
  serializeJob,
} from "@/lib/browser-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/browser/jobs/[id]
 *   Returns the status of a browser job. The Studio polls this to
 *   show progress and detect completion.
 *
 * DELETE /api/browser/jobs/[id]
 *   Cancel a queued or awaiting_approval job. Running jobs cannot
 *   be cancelled via this endpoint — the executor handles cancellation
 *   cooperatively.
 *
 * POST /api/browser/jobs/[id]
 *   Approve a job that is awaiting_approval. Sets status to "approved"
 *   so the executor can resume the high-risk action.
 *   Body: { action: "approve" }
 *
 * Auth (dual mode):
 *   1. Bearer token: Authorization: Bearer <LITTLABS_VAPI_TOOL_TOKEN>
 *      → Vapi mode, scoped to LITTLABS_VAPI_OWNER_CLERK_ID
 *   2. Clerk session cookie or Bearer JWT
 *      → Studio mode, scoped to the authenticated user
 */

async function handler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await ctx.params;
  if (!jobId) {
    return NextResponse.json({ error: "Missing job ID" }, { status: 400 });
  }

  // ─── Dual auth ───────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";

  let userId: string | null = null;

  if (authorizeVapiRequest(authHeader)) {
    userId = ownerClerkId();
  } else {
    const authResult = await auth(req);
    userId = authResult.userId;
  }

  if (!userId || userId === "anonymous-dev") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── GET: job status ─────────────────────────────────────────
  if (req.method === "GET") {
    const job = await getJob(jobId, userId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json({ job: serializeJob(job) });
  }

  // ─── DELETE: cancel job ──────────────────────────────────────
  if (req.method === "DELETE") {
    const job = await cancelJob(jobId, userId);
    if (!job) {
      // Job may be running (can't cancel) or not found
      const existing = await getJob(jobId, userId);
      if (!existing) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: `Cannot cancel job in status "${existing.status}". Only queued or awaiting_approval jobs can be cancelled.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ job: serializeJob(job) });
  }

  // ─── POST: approve job ───────────────────────────────────────
  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const action = typeof body.action === "string" ? body.action : "";
    if (action !== "approve") {
      return NextResponse.json(
        { error: `Unknown action "${action}". Valid: "approve".` },
        { status: 400 },
      );
    }

    const job = await approveJob(jobId, userId);
    if (!job) {
      const existing = await getJob(jobId, userId);
      if (!existing) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: `Cannot approve job in status "${existing.status}". Only awaiting_approval jobs can be approved.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ job: serializeJob(job) });
  }

  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export const GET = withRateLimit(handler, 60, 60); // polling-friendly
export const DELETE = withRateLimit(handler, 10, 60);
export const POST = withRateLimit(handler, 10, 60);
