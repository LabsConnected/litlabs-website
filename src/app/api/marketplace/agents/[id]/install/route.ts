// Agent installation endpoint — server-enforced authorization.
//
// POST   /api/marketplace/agents/[id]/install  — install or re-enable
// DELETE /api/marketplace/agents/[id]/install  — uninstall (remove from dock)
// PATCH  /api/marketplace/agents/[id]/install  — disable or enable
//
// The server — not the Marketplace button — determines the action.
// Authorization is re-checked on every request. The browser cannot
// install a paid agent without an entitlement, even if it sends a
// valid agent ID.
//
// Re-enable (POST when installed+disabled, or PATCH action=enable) requires
// canEnable: installed AND disabled AND public AND listed AND compatible
// version AND not refunded AND (free OR plan-included OR compatible entitlement).
// A lapsed plan, refunded purchase, private agent, or incompatible version
// must not be re-enabled.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  installAgent,
  uninstallAgent,
  disableAgent,
  enableAgent,
  getAgentAuthorization,
} from "@/lib/agent-entitlements";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}

function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 });
}

async function postHandler(
  _req: NextRequest,
  ctx?: { params: Promise<{ id: string }> },
) {
  const { clerkId } = await auth();
  if (!clerkId) return unauthorized();

  if (!ctx?.params) {
    return NextResponse.json({ error: "Missing route params" }, { status: 400 });
  }
  const { id: agentId } = await ctx.params;

  const state = await getAgentAuthorization(clerkId, agentId);

  // Private or unlisted agents return 404 — do not reveal existence.
  if (state.denyReason === "user_not_found") return notFound("User not found");
  if (state.denyReason === "agent_not_found") return notFound("Agent not found");

  if (state.isRefunded) {
    return forbidden("Access revoked — this agent was refunded.");
  }

  // If installed and disabled, attempt re-enable via canEnable.
  if (state.isInstalled && state.isDisabled) {
    if (!state.canEnable) {
      const reason = state.denyReason ?? "not_authorized";
      if (reason === "upgrade_required") {
        return forbidden("Upgrade required to re-enable this agent.");
      }
      if (reason === "payment_required") {
        return forbidden("Active subscription or entitlement required to re-enable.");
      }
      if (reason === "version_unavailable") {
        return forbidden("This agent version is not available.");
      }
      return forbidden("Cannot re-enable this agent.");
    }
    const result = await enableAgent(clerkId, agentId);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ message: "Agent re-enabled", state: "open" });
  }

  if (state.isInstalled) {
    return NextResponse.json({ message: "Already installed", state: "open" });
  }

  const result = await installAgent(clerkId, agentId);
  if (!result.success) {
    if (result.error === "payment_required") {
      return forbidden("Payment required to install this agent.");
    }
    if (result.error === "access_revoked") {
      return forbidden("Access revoked — this agent was refunded.");
    }
    if (result.error === "version_unavailable") {
      return forbidden("This agent version is not available for installation.");
    }
    if (result.error === "upgrade_required") {
      return forbidden("Upgrade required — your entitlement does not cover this version.");
    }
    if (result.error === "agent_not_found") {
      return notFound("Agent not found");
    }
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    message: "Agent installed",
    installationId: result.installationId,
    state: "open",
  });
}

async function deleteHandler(
  _req: NextRequest,
  ctx?: { params: Promise<{ id: string }> },
) {
  const { clerkId } = await auth();
  if (!clerkId) return unauthorized();

  if (!ctx?.params) {
    return NextResponse.json({ error: "Missing route params" }, { status: 400 });
  }
  const { id: agentId } = await ctx.params;

  const result = await uninstallAgent(clerkId, agentId);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ message: "Agent uninstalled", state: "install" });
}

async function patchHandler(
  req: NextRequest,
  ctx?: { params: Promise<{ id: string }> },
) {
  const { clerkId } = await auth();
  if (!clerkId) return unauthorized();

  if (!ctx?.params) {
    return NextResponse.json({ error: "Missing route params" }, { status: 400 });
  }
  const { id: agentId } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  if (action === "disable") {
    const result = await disableAgent(clerkId, agentId);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ message: "Agent disabled", state: "disabled" });
  }

  if (action === "enable") {
    // canEnable is enforced inside enableAgent via getAgentAuthorization.
    const result = await enableAgent(clerkId, agentId);
    if (!result.success) {
      if (result.error === "access_revoked") {
        return forbidden("Access revoked — cannot enable a refunded agent.");
      }
      if (result.error === "upgrade_required") {
        return forbidden("Upgrade required to enable this agent.");
      }
      if (result.error === "payment_required") {
        return forbidden("Active subscription or entitlement required to enable.");
      }
      if (result.error === "agent_not_found") {
        return notFound("Agent not found");
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ message: "Agent enabled", state: "open" });
  }

  return NextResponse.json({ error: "Invalid action. Use 'disable' or 'enable'." }, { status: 400 });
}

export const POST = withRateLimit(postHandler);
export const DELETE = withRateLimit(deleteHandler);
export const PATCH = withRateLimit(patchHandler);
