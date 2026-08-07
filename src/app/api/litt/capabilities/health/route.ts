import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { listBusinessToolIds, getBusinessTool } from "@/lib/business-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/litt/capabilities/health
 *
 * Reports the health of all LiTT capabilities and their tools.
 * Each tool reports whether it has a real handler (implemented) or not.
 * Tools without handlers are marked as "unimplemented" and must NOT be
 * advertised as working.
 */
async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Business operations tools — all have handlers
  const businessTools = listBusinessToolIds().map((id) => {
    const tool = getBusinessTool(id);
    return {
      id,
      name: tool?.name ?? id,
      category: "business",
      implemented: !!tool?.handler,
      risk: tool?.risk ?? "unknown",
      approvalRequired: tool?.approvalPolicy !== "none",
    };
  });

  // External capabilities (not yet wired — Phase 5+)
  const externalCapabilities = [
    { id: "github", name: "GitHub Repository", implemented: false, risk: "medium", approvalRequired: true },
    { id: "terminal", name: "Terminal Execution", implemented: false, risk: "high", approvalRequired: true },
    { id: "voice", name: "Voice Transport", implemented: true, risk: "low", approvalRequired: false },
    { id: "deploy", name: "Deployment", implemented: false, risk: "high", approvalRequired: true },
  ];

  return NextResponse.json({
    business: businessTools,
    external: externalCapabilities,
    summary: {
      totalTools: businessTools.length + externalCapabilities.length,
      implemented: businessTools.filter((t) => t.implemented).length + externalCapabilities.filter((t) => t.implemented).length,
      unimplemented: businessTools.filter((t) => !t.implemented).length + externalCapabilities.filter((t) => !t.implemented).length,
    },
  });
}

export const GET = withRateLimit(handler, 30, 60);
