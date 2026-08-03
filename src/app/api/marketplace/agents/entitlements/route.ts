// Agent entitlements — list the caller's active agent entitlements.
//
// GET /api/marketplace/agents/entitlements          — list all entitlements
// GET /api/marketplace/agents/entitlements?slug=nova — get state for one agent
//
// Returns the authenticated user's entitlements with agent metadata.
// Used by the marketplace UI to show "Owned" badges and by the studio to
// gate premium agent access.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getAgentAuthorization } from "@/lib/agent-entitlements";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const slug = req.nextUrl.searchParams.get("slug");

  // Single-agent state lookup
  if (slug) {
    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const state = await getAgentAuthorization(clerkId, agent.id);
    const uiState = deriveUiState(state);
    return NextResponse.json({
      agentId: agent.id,
      state: uiState,
      ...state,
    });
  }

  // Full entitlement list (existing behavior)
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (userError || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { data: entitlements, error } = await supabaseAdmin
    .from("agent_entitlements")
    .select(
      `
      id,
      agent_id,
      purchased_version_id,
      includes_future_updates,
      minimum_version,
      maximum_version,
      order_id,
      status,
      revoked_reason,
      revoked_at,
      created_at,
      updated_at,
      agents (
        id,
        slug,
        display_name,
        description,
        role,
        is_featured,
        price_cents,
        features
      )
    `,
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Unable to fetch entitlements" },
      { status: 500 },
    );
  }

  return NextResponse.json({ entitlements: entitlements ?? [] });
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
