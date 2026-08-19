import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { executeBusinessTool, type BusinessResult, type ToolContext } from "@/lib/business-operations";

export const runtime = "nodejs";

/**
 * POST /api/business/tools/execute
 *
 * Execute a business tool by ID. Enforces the approval gate:
 * mutation tools require an approvalId in the request body.
 *
 * Body:
 *   {
 *     toolId: string,         // e.g. "business.bookings.create"
 *     input: object,          // tool-specific input
 *     approvalId?: string,    // required for mutation tools
 *     conversationId?: string,
 *     projectId?: string,
 *   }
 *
 * Response:
 *   { ok: true, data: ... } | { ok: false, error: string, status: number }
 */
async function handler(req: NextRequest) {
  const { userId, clerkId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return typedError(400, "Invalid JSON body");
  }

  const toolId = body.toolId;
  if (typeof toolId !== "string") return typedError(400, "toolId is required");

  const input = body.input ?? {};
  const approvalId = typeof body.approvalId === "string" ? body.approvalId : undefined;
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  const projectId = typeof body.projectId === "string" ? body.projectId : null;

  const ctx: ToolContext = {
    ownerId: userId,
    clerkId,
    conversationId,
    projectId,
  };

  return toResponse(await executeBusinessTool(toolId, input, ctx, approvalId));
}

export const POST = withRateLimit(handler, 30, 60);

function typedError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

function toResponse<T>(result: BusinessResult<T>): NextResponse {
  if (result.ok) {
    return NextResponse.json({ ok: true, data: result.data });
  }
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
