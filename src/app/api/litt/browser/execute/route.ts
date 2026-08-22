import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";

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
 *   hasApproval?: boolean, // for mutation tools that require approval
 * }
 *
 * Returns: { success, data?, error? }
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
  const hasApproval = body.hasApproval === true;
  const executionMode = body.executionMode as "plan" | "act" | "auto" | undefined;

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

  // Execute via the registry
  const result = await toolRegistry.execute(toolId, fullInputs, { hasApproval, executionMode });

  if (result.ok) {
    return NextResponse.json({ success: true, data: result.result });
  }

  return NextResponse.json({ success: false, error: result.error }, { status: 200 });
}

export const POST = withRateLimit(handler, 30, 60);
