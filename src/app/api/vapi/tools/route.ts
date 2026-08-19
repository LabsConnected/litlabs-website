import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limiter";
import {
  TOOL_NAMES,
  isSafeToolName,
  parseVapiPayload,
  argsOf,
  serializeToolResult,
  authorizeVapiRequest,
  ownerClerkId,
  auditToolCall,
  type ToolCall,
  type ToolResult,
} from "@/lib/vapi-tools";
import { executeProjectTool } from "@/lib/project-tools/registry";

/**
 * Vapi project-tools endpoint.
 *
 *   POST https://litlabs.net/api/vapi/tools
 *
 * A single server-to-server endpoint that dispatches by tool name to the
 * shared project tool registry. Call lifecycle events are intentionally NOT
 * handled here — those belong on /api/vapi/events.
 *
 * Architecture:
 *   This route is a thin transport layer — auth, rate limiting, payload
 *   parsing, and audit. All tool handler logic lives in the shared registry
 *   at src/lib/project-tools/registry.ts, which is also imported by the LiTT
 *   Voice Runtime. One brain, one set of handlers, one audit trail.
 *
 * Authentication:
 *   Authorization: Bearer <LITTLABS_VAPI_TOOL_TOKEN>
 *
 * The token is a shared secret stored in Vapi's secure credential flow and
 * in the deployment environment as LITTLABS_VAPI_TOOL_TOKEN. It is never
 * read from prompts, frontend code, or client requests.
 *
 * Authorization:
 *   Vapi calls do not carry a Clerk user identity. All operations are scoped
 *   to the site owner configured via LITTLABS_VAPI_OWNER_CLERK_ID. Every
 *   project-scoped tool re-verifies ownership through getProject(projectId,
 *   ownerUserId), so the token alone cannot touch projects the owner does not
 *   own.
 *
 * Production safety:
 *   No tool performs a production deployment. request_deployment_approval is
 *   request-only — it records a pending approval request and returns. A
 *   separate backend deployment endpoint must reject production requests
 *   unless explicit human approval has been recorded out-of-band.
 *
 * Response (Vapi format):
 *   { "results": [{ "toolCallId": "<id>", "result": "<single-line JSON string>" }] }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Dispatch ───────────────────────────────────────────────────

async function dispatch(call: ToolCall, userId: string): Promise<ToolResult> {
  const args = argsOf(call);

  if (!isSafeToolName(call.name)) {
    return fail(`Unknown tool "${call.name}". Valid tools: ${TOOL_NAMES.join(", ")}.`);
  }

  // Delegate to the shared registry — same handlers used by the LiTT Voice Runtime.
  return executeProjectTool(call.name, userId, args);
}

// Re-export fail for the dispatch function (avoid circular import of ok/fail)
function fail(message: string): ToolResult {
  return { success: false, message, projectId: null, data: {} };
}

// ─── Route ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Auth ──
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authorizeVapiRequest(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Owner identity ──
  const userId = ownerClerkId();
  if (!userId) {
    return NextResponse.json({ error: "Owner identity not configured" }, { status: 503 });
  }

  // ── Rate limiting (fail-open) ──
  const rateLimitResult = await rateLimit(req, 60, 60);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter: rateLimitResult.resetTime },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.resetTime),
          "X-RateLimit-Remaining": String(rateLimitResult.remaining),
        },
      },
    );
  }

  // ── Parse payload ──
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const calls = parseVapiPayload(body);
  if (!calls) {
    return NextResponse.json({ error: "Malformed payload: expected message.toolCallList[]" }, { status: 400 });
  }

  // ── Execute + audit each tool call ──
  const results = await Promise.all(
    calls.map(async (call) => {
      const start = Date.now();
      let result: ToolResult;
      try {
        result = await dispatch(call, userId);
      } catch (err) {
        result = fail(err instanceof Error ? err.message : "Tool execution failed");
      }
      const durationMs = Date.now() - start;

      // Audit log — never logs file contents or tokens
      await auditToolCall({
        callId: call.id,
        toolName: call.name,
        projectId: result.projectId,
        success: result.success,
        durationMs,
        error: result.success ? undefined : result.message,
      });

      // Vapi requires result as a single-line string
      return { toolCallId: call.id, result: serializeToolResult(result) };
    }),
  );

  // Always return 200 for handled tool failures (Vapi recommendation)
  return NextResponse.json({ results });
}
