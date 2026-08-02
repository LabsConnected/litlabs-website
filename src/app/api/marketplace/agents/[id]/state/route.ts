// Agent state endpoint — returns the authorization state for a single agent.
//
// GET /api/marketplace/agents/[id]/state
//
// Returns the full authorization state for the authenticated user and the
// specified agent. The Marketplace UI uses this to render the correct
// button (Buy, Processing, Install, Open, Enable, Access revoked, Upgrade required).
//
// This endpoint is READ-ONLY. It never installs, uninstalls, or modifies
// anything. The install endpoint re-checks authorization server-side.
//
// Private or unlisted agents return 404 — they must not reveal product existence.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAgentAuthorization } from "@/lib/agent-entitlements";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

async function handler(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { clerkId } = await auth(_req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ctx?.params) {
    return NextResponse.json({ error: "Missing route params" }, { status: 400 });
  }
  const { id: agentId } = await ctx.params;

  const state = await getAgentAuthorization(clerkId, agentId);

  // Private or unlisted agents return 404 — do not reveal existence.
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
  isPrivate: boolean;
  isListed: boolean;
  versionStatus: string | null;
  hasPendingOrder: boolean;
  isInstalled: boolean;
  isDisabled: boolean;
  isFree: boolean;
  hasEntitlement: boolean;
  isIncludedInPlan: boolean;
  canUse: boolean;
  canEnable: boolean;
  denyReason?: string;
}): string {
  // Private or unlisted agents are "unavailable" to the UI.
  if (state.isPrivate || !state.isListed) return "unavailable";
  if (state.isRefunded) return "revoked";
  if (state.denyReason === "upgrade_required") return "upgrade_required";
  if (state.versionStatus !== "published") return "unavailable";
  if (state.hasPendingOrder) return "processing";
  if (state.isInstalled && state.isDisabled && !state.canEnable) return "revoked";
  if (state.isInstalled && state.isDisabled) return "disabled";
  if (state.isInstalled && state.canUse) return "open";
  if (state.isInstalled && !state.canUse) return "revoked";
  if (state.isFree || state.hasEntitlement || state.isIncludedInPlan) return "install";
  return "buy";
}

export const GET = withRateLimit(handler);
