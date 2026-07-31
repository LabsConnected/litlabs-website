// Agent state endpoint — returns the authorization state for a single agent.
//
// GET /api/marketplace/agents/[id]/state
//
// Returns the full authorization state for the authenticated user and the
// specified agent. The Marketplace UI uses this to render the correct
// button (Buy, Processing, Install, Open, Enable, Access revoked).
//
// This endpoint is READ-ONLY. It never installs, uninstalls, or modifies
// anything. The install endpoint re-checks authorization server-side.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAgentAuthorization } from "@/lib/agent-entitlements";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

async function handler(
  _req: NextRequest,
  ctx?: { params: Promise<{ id: string }> },
) {
  const { clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ctx?.params) {
    return NextResponse.json({ error: "Missing route params" }, { status: 400 });
  }
  const { id: agentId } = await ctx.params;

  const state = await getAgentAuthorization(clerkId, agentId);

  if (state.denyReason === "user_not_found") {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (state.denyReason === "agent_not_found") {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const uiState = deriveUiState(state);

  return NextResponse.json({ state: uiState, ...state });
}

function deriveUiState(state: {
  isRefunded: boolean;
  versionStatus: string | null;
  hasPendingOrder: boolean;
  isInstalled: boolean;
  isDisabled: boolean;
  isFree: boolean;
  hasEntitlement: boolean;
  isIncludedInPlan: boolean;
  canUse: boolean;
}): string {
  if (state.isRefunded) return "revoked";
  if (state.versionStatus !== "published") return "unavailable";
  if (state.hasPendingOrder) return "processing";
  if (state.isInstalled && state.isDisabled) return "disabled";
  if (state.isInstalled && state.canUse) return "open";
  if (state.isInstalled && !state.canUse) return "revoked";
  if (state.isFree || state.hasEntitlement || state.isIncludedInPlan) return "install";
  return "buy";
}

export const GET = withRateLimit(handler);
