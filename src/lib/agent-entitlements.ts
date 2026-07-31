import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import type { PlanId } from "@/config/plans";

/**
 * Agent entitlement and authorization helpers.
 *
 * These functions are the single source of truth for whether a user may
 * install or use a premium agent. The Marketplace UI must call the state
 * endpoint to render the correct button, but the installation endpoint
 * re-checks authorization server-side — never trusting UI state.
 *
 * Authorization rules (exactly one must be true):
 *   1. Agent is free (price_cents = 0)
 *   2. Agent is included in the caller's active plan
 *   3. Caller has an active agent entitlement
 *
 * All functions accept the Clerk ID (from auth()) and resolve the internal
 * users.id UUID server-side. The Clerk ID is never used directly as a
 * foreign key in the entitlement or order tables.
 */

export interface AgentAuthorization {
  canInstall: boolean;
  canUse: boolean;
  hasEntitlement: boolean;
  isFree: boolean;
  isIncludedInPlan: boolean;
  isInstalled: boolean;
  isDisabled: boolean;
  hasPendingOrder: boolean;
  isRefunded: boolean;
  versionStatus: string | null;
  agentStatus: string | null;
  denyReason?: string;
}

export async function resolveInternalUserId(clerkId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();
  if (error || !data) return null;
  return data.id;
}

export async function getAgentAuthorization(
  clerkId: string,
  agentId: string,
): Promise<AgentAuthorization> {
  const internalUserId = await resolveInternalUserId(clerkId);
  if (!internalUserId) {
    return {
      canInstall: false, canUse: false, hasEntitlement: false, isFree: false,
      isIncludedInPlan: false, isInstalled: false, isDisabled: false,
      hasPendingOrder: false, isRefunded: false, versionStatus: null,
      agentStatus: null, denyReason: "user_not_found",
    };
  }

  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("id, slug, price_cents, is_public")
    .eq("id", agentId)
    .maybeSingle();

  if (!agent) {
    return {
      canInstall: false, canUse: false, hasEntitlement: false, isFree: false,
      isIncludedInPlan: false, isInstalled: false, isDisabled: false,
      hasPendingOrder: false, isRefunded: false, versionStatus: null,
      agentStatus: null, denyReason: "agent_not_found",
    };
  }

  const isFree = agent.price_cents === 0;

  const { data: version } = await supabaseAdmin
    .from("agent_versions")
    .select("status")
    .eq("agent_id", agentId)
    .eq("status", "published")
    .maybeSingle();

  const versionStatus = version?.status ?? null;

  const { data: entitlement } = await supabaseAdmin
    .from("agent_entitlements")
    .select("id, status")
    .eq("user_id", internalUserId)
    .eq("agent_id", agentId)
    .maybeSingle();

  const hasEntitlement = entitlement?.status === "active";
  const isRefunded = entitlement?.status === "refunded";

  let isIncludedInPlan = false;
  if (!isFree && !hasEntitlement) {
    isIncludedInPlan = await checkPlanInclusion(internalUserId, agentId);
  }

  const { data: installation } = await supabaseAdmin
    .from("user_agents")
    .select("id, is_active")
    .eq("user_id", internalUserId)
    .eq("agent_id", agent.slug)
    .maybeSingle();

  const isInstalled = !!installation;
  const isDisabled = isInstalled && !installation!.is_active;

  const { data: pendingOrders } = await supabaseAdmin
    .from("marketplace_orders")
    .select("id")
    .eq("user_id", internalUserId)
    .eq("status", "pending");

  let hasPendingOrder = false;
  if (pendingOrders && pendingOrders.length > 0) {
    const orderIds = pendingOrders.map((o) => o.id);
    const { data: pendingItem } = await supabaseAdmin
      .from("marketplace_order_items")
      .select("id")
      .in("order_id", orderIds)
      .eq("agent_id", agentId)
      .maybeSingle();
    hasPendingOrder = !!pendingItem;
  }

  const versionBlocked = versionStatus !== "published";
  const canInstall = !isRefunded && !isInstalled && !versionBlocked && (isFree || isIncludedInPlan || hasEntitlement);
  const canUse = isInstalled && !isDisabled && !isRefunded && (isFree || isIncludedInPlan || hasEntitlement);

  let denyReason: string | undefined;
  if (isRefunded) denyReason = "access_revoked";
  else if (versionBlocked) denyReason = "version_unavailable";
  else if (!isFree && !isIncludedInPlan && !hasEntitlement) denyReason = "payment_required";
  else if (isInstalled) denyReason = "already_installed";

  return {
    canInstall, canUse, hasEntitlement, isFree, isIncludedInPlan,
    isInstalled, isDisabled, hasPendingOrder, isRefunded,
    versionStatus, agentStatus: agent.is_public ? "available" : "unavailable",
    denyReason,
  };
}

async function checkPlanInclusion(internalUserId: string, agentId: string): Promise<boolean> {
  const { data: subscription } = await supabaseAdmin
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", internalUserId)
    .maybeSingle();

  if (!subscription || subscription.status !== "active") return false;

  const userPlanId = subscription.plan as PlanId;

  const { data: item } = await supabaseAdmin
    .from("marketplace_items")
    .select("included_plan_ids")
    .eq("agent_id", agentId)
    .eq("item_type", "agent")
    .maybeSingle();

  if (!item || !item.included_plan_ids) return false;
  return (item.included_plan_ids as string[]).includes(userPlanId);
}

export async function installAgent(
  clerkId: string,
  agentId: string,
): Promise<{ success: boolean; error?: string; installationId?: string }> {
  const auth = await getAgentAuthorization(clerkId, agentId);

  if (auth.isRefunded) return { success: false, error: "access_revoked" };

  if (auth.isInstalled) {
    const internalUserId = await resolveInternalUserId(clerkId);
    if (!internalUserId) return { success: false, error: "user_not_found" };
    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("slug")
      .eq("id", agentId)
      .maybeSingle();
    if (!agent) return { success: false, error: "agent_not_found" };
    const { data: existing } = await supabaseAdmin
      .from("user_agents")
      .select("id")
      .eq("user_id", internalUserId)
      .eq("agent_id", agent.slug)
      .maybeSingle();
    return { success: true, installationId: existing?.id };
  }

  if (!auth.canInstall) return { success: false, error: auth.denyReason ?? "not_authorized" };

  const internalUserId = await resolveInternalUserId(clerkId);
  if (!internalUserId) return { success: false, error: "user_not_found" };

  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("slug")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) return { success: false, error: "agent_not_found" };

  const { data: installation, error } = await supabaseAdmin
    .from("user_agents")
    .insert({ user_id: internalUserId, agent_id: agent.slug, is_active: true })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await supabaseAdmin
        .from("user_agents")
        .select("id")
        .eq("user_id", internalUserId)
        .eq("agent_id", agent.slug)
        .maybeSingle();
      return { success: true, installationId: existing?.id };
    }
    return { success: false, error: "install_failed" };
  }

  return { success: true, installationId: installation.id };
}

export async function uninstallAgent(
  clerkId: string,
  agentId: string,
): Promise<{ success: boolean; error?: string }> {
  const internalUserId = await resolveInternalUserId(clerkId);
  if (!internalUserId) return { success: false, error: "user_not_found" };

  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("slug")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) return { success: false, error: "agent_not_found" };

  const { error } = await supabaseAdmin
    .from("user_agents")
    .delete()
    .eq("user_id", internalUserId)
    .eq("agent_id", agent.slug);

  if (error) return { success: false, error: "uninstall_failed" };
  return { success: true };
}

export async function disableAgent(
  clerkId: string,
  agentId: string,
): Promise<{ success: boolean; error?: string }> {
  const internalUserId = await resolveInternalUserId(clerkId);
  if (!internalUserId) return { success: false, error: "user_not_found" };

  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("slug")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) return { success: false, error: "agent_not_found" };

  const { error } = await supabaseAdmin
    .from("user_agents")
    .update({ is_active: false })
    .eq("user_id", internalUserId)
    .eq("agent_id", agent.slug);

  if (error) return { success: false, error: "disable_failed" };
  return { success: true };
}

export async function enableAgent(
  clerkId: string,
  agentId: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await getAgentAuthorization(clerkId, agentId);
  if (auth.isRefunded) return { success: false, error: "access_revoked" };

  const internalUserId = await resolveInternalUserId(clerkId);
  if (!internalUserId) return { success: false, error: "user_not_found" };

  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("slug")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) return { success: false, error: "agent_not_found" };

  const { error } = await supabaseAdmin
    .from("user_agents")
    .update({ is_active: true })
    .eq("user_id", internalUserId)
    .eq("agent_id", agent.slug);

  if (error) return { success: false, error: "enable_failed" };
  return { success: true };
}
