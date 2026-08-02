// Canonical agent-run API — create a controlled run for a paid agent.
//
// POST /api/marketplace/agents/[id]/runs
//
// Request body:
//   {
//     projectId: string,
//     prompt: string,
//     clientRequestId: string
//   }
//
// Server behavior:
//   1. Authenticate user (Clerk)
//   2. Verify project ownership (studio_projects.user_id = caller)
//   3. Verify active agent entitlement (or free agent)
//   4. Resolve the installed published agent version server-side
//   5. Create canonical revenue_agent_run
//   6. Enforce idempotency using clientRequestId
//   7. Calculate allowed tools from agent capability manifest
//   8. Enforce rate limits (max concurrent + daily runs)
//
// The browser can never choose: price, agent system prompt, unrestricted
// tools, ownership, execution limits, or deployment credentials.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createRun } from "@/lib/revenue/agent-runs";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: agentId } = await ctx.params;

  let body: { projectId?: string; prompt?: string; clientRequestId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, prompt, clientRequestId } = body;

  if (!projectId || typeof projectId !== "string") {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
  }
  if (!clientRequestId || typeof clientRequestId !== "string") {
    return NextResponse.json({ error: "Missing clientRequestId" }, { status: 400 });
  }

  const result = await createRun({
    clerkId,
    agentId,
    projectId,
    prompt,
    clientRequestId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.statusCode ?? 500 },
    );
  }

  return NextResponse.json({
    runId: result.runId,
    status: result.status,
  }, { status: 201 });
}

export const POST = withRateLimit(handler, 10, 60);
