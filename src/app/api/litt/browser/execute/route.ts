import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";
import { requiresApproval } from "@/lib/litt-intelligence/types";

export const runtime = "nodejs";

/**
 * POST /api/litt/browser/execute
 *
 * Execute a browser tool against an active session.
 * This is the programmatic entry point for browser tool execution
 * outside the agent loop (e.g. for testing or direct UI control).
 *
 * Body: {
 *   sessionId: string,
 *   toolId: string,       // e.g. "browser.navigate", "browser.click"
 *   inputs: Record<string, unknown>,
 *   hasApproval?: boolean, // IGNORED — see below
 * }
 *
 * Returns: { success, data?, error? } for executed tools;
 *          202 { error: "Approval required", toolId, permissionLevel,
 *          requiresApproval: true } for approval-gated tools.
 *
 * Approval semantics mirror /api/litt/tools/execute EXACTLY (Repair
 * R1a-1, Diagnosis E2 S1 / ART-20261020-039): a client-supplied
 * hasApproval flag is NEVER honored as proof of approval. This route
 * previously passed `body.hasApproval === true` straight into
 * toolRegistry.execute, so the MUTATION_APPROVAL browser tools
 * (click/type/select/scroll/press/upload/download) executed on a
 * self-asserted boolean — no pause record, no decision, no audit.
 * Approval-gated tools now record a pending execution and return 202,
 * like tools/execute; real approvals resume through the conversation
 * approvals flow, which binds the decision to an authenticated pause
 * record. Non-gated tools execute with hasApproval:false.
 *
 * Documented deviations from tools/execute, forced by this route's
 * session model:
 *  - The pending record carries run_id/step_id/project_id as null (this
 *    API has none) and includes the target sessionId in `inputs`, since
 *    a browser operation is meaningless without its session.
 *  - Executed tools keep this route's long-standing
 *    { success, data } / { success: false, error } response shape
 *    instead of tools/execute's { toolId, result, status } — only the
 *    approval semantics are mirrored, not the payload contract.
 *  - No post-execution tool_executions row is written for executed
 *    tools: browser executions are already recorded in the action
 *    runtime by the registry's browser-runtime bookkeeping
 *    (session → run association), so a second row would double-record.
 */
async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const sessionId = body.sessionId as string | undefined;
  const toolId = body.toolId as string | undefined;
  const inputs = (body.inputs as Record<string, unknown>) ?? {};
  // body.hasApproval is deliberately NOT read: a client can never
  // approve its own tool call (see header).

  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  if (!toolId) return NextResponse.json({ error: "Missing toolId" }, { status: 400 });

  // Inject sessionId and userId into inputs for the handler
  const fullInputs = { ...inputs, sessionId, userId };

  // Verify the tool is a browser tool
  if (!toolId.startsWith("browser.")) {
    return NextResponse.json({ error: "Not a browser tool" }, { status: 400 });
  }

  const tool = toolRegistry.get(toolId);
  if (!tool) {
    return NextResponse.json({ error: `Tool "${toolId}" not found` }, { status: 404 });
  }

  if (!tool.enabled) {
    return NextResponse.json({ error: `Tool "${toolId}" is disabled` }, { status: 403 });
  }

  // Validate inputs
  const validationError = toolRegistry.validateInputs(toolId, fullInputs);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // Check if approval is required — the same formula as
  // /api/litt/tools/execute. Approval-gated tools never execute from
  // this endpoint; they record a pending execution and return 202.
  const needsApproval =
    requiresApproval(tool.permissionLevel) ||
    (tool.approvalPolicy.requireExplicitForMutations && !tool.readOnly);
  if (needsApproval) {
    // Record the approval request
    if (supabaseAdmin) {
      const { data: user } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("clerk_id", userId)
        .maybeSingle();

      if (user) {
        await supabaseAdmin.from("tool_executions").insert({
          tool_id: toolId,
          run_id: null,
          step_id: null,
          user_id: user.id,
          project_id: null,
          inputs: { ...inputs, sessionId },
          status: "pending",
          started_at: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      error: "Approval required",
      toolId,
      permissionLevel: tool.permissionLevel,
      requiresApproval: true,
    }, { status: 202 });
  }

  // Execute via the registry — hasApproval stays false: approval-gated
  // tools already returned 202 above, and the registry's own approval
  // policy enforces the rest.
  const result = await toolRegistry.execute(toolId, fullInputs, { hasApproval: false });

  if (result.ok) {
    return NextResponse.json({ success: true, data: result.result });
  }

  return NextResponse.json({ success: false, error: result.error }, { status: 200 });
}

export const POST = withRateLimit(handler, 30, 60);
