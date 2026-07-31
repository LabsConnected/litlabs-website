import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import type { PlanId } from "@/config/plans";

/**
 * Agent entitlement and authorization helpers.
 *
 * These functions are the single source of truth for whether a user may
 * install, enable, or use a premium agent. The Marketplace UI must call the
 * state endpoint to render the correct button, but the installation endpoint
 * re-checks authorization server-side — never trusting UI state.
 *
 * Authorization rules (exactly one must be true for installation):
 *   1. Agent is free (agent_versions.price_cents = 0 for the selected version)
 *   2. Agent is included in the caller's active plan
 *   3. Caller has an active agent entitlement for a compatible version
 *
 * Key principles:
 *   - Price and free status are derived from the immutable agent_versions row,
 *     NOT the mutable agents row.
 *   - The published version is selected deterministically: latest published_at.
 *   - Entitlements enforce version policy: minimum_version, maximum_version,
 *     and includes_future_updates. Semantic version comparison, not string.
 *   - Private agents (is_public = false) and unlisted marketplace items return
 *     404 — they must not reveal product existence.
 *   - user_agents.agent_id stores the agent UUID (not the slug).
 *   - Pending orders must not be expired (expires_at > now()).
 */

export interface AgentAuthorization {
  canInstall: boolean;
  canUse: boolean;
  canEnable: boolean;
  hasEntitlement: boolean;
  isFree: boolean;
  isIncludedInPlan: boolean;
  isInstalled: boolean;
  isDisabled: boolean;
  hasPendingOrder: boolean;
  isRefunded: boolean;
  isPrivate: boolean;
  isListed: boolean;
  versionStatus: string | null;
  agentStatus: string | null;
  selectedVersionId: string | null;
  denyReason?: string;
}

// ── Semantic version comparison ──────────────────────────────────────────

function parseSemver(v: string): number[] {
  const parts = v.replace(/^[^0-9]*/, "").split(/[.-]/).map((p) => parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function isVersionInRange(
  version: string,
  minimum: string,
  maximum: string | null,
): boolean {
  if (compareSemver(version, minimum) < 0) return false;
  if (maximum && compareSemver(version, maximum) > 0) return false;
  return true;
}

// ── User resolution ──────────────────────────────────────────────────────

export async function resolveInternalUserId(clerkId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();
  if (error || !data) return null;
  return data.id;
}

// ── Core authorization ───────────────────────────────────────────────────

export async function getAgentAuthorization(
  clerkId: string,
  agentId: string,
): Promise<AgentAuthorization> {
  const internalUserId = await resolveInternalUserId(clerkId);
  if (!internalUserId) {
    return {
      canInstall: false, canUse: false, canEnable: false, hasEntitlement: false,
      isFree: false, isIncludedInPlan: false, isInstalled: false, isDisabled: false,
      hasPendingOrder: false, isRefunded: false, isPrivate: false, isListed: false,
      versionStatus: null, agentStatus: null, selectedVersionId: null,
      denyReason: "user_not_found",
    };
  }

  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("id, slug, is_public")
    .eq("id", agentId)
    .maybeSingle();

  if (!agent) {
    return {
      canInstall: false, canUse: false, canEnable: false, hasEntitlement: false,
      isFree: false, isIncludedInPlan: false, isInstalled: false, isDisabled: false,
      hasPendingOrder: false, isRefunded: false, isPrivate: false, isListed: false,
      versionStatus: null, agentStatus: null, selectedVersionId: null,
      denyReason: "agent_not_found",
    };
  }

  const isPrivate = !agent.is_public;

  const { data: listing } = await supabaseAdmin
    .from("marketplace_items")
    .select("status, item_type, included_plan_ids, billing_model")
    .eq("agent_id", agentId)
    .eq("item_type", "agent")
    .maybeSingle();

  const isListed =
    !!listing &&
    (listing.status === "available" || listing.status === "beta");

  const { data: latestVersion } = await supabaseAdmin
    .from("agent_versions")
    .select("id, version, price_cents, currency, status, published_at")
    .eq("agent_id", agentId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const versionStatus = latestVersion?.status ?? null;
  const selectedVersionId = latestVersion?.id ?? null;
  const isFree = latestVersion ? latestVersion.price_cents === 0 : false;

  const { data: entitlement } = await supabaseAdmin
    .from("agent_entitlements")
    .select(
      "id, status, purchased_version_id, minimum_version, maximum_version, includes_future_updates",
    )
    .eq("user_id", internalUserId)
    .eq("agent_id", agentId)
    .maybeSingle();

  const hasEntitlement = entitlement?.status === "active";
  const isRefunded = entitlement?.status === "refunded";

  let hasCompatibleEntitlement = false;
  let upgradeRequired = false;
  if (hasEntitlement && latestVersion) {
    if (entitlement!.includes_future_updates) {
      hasCompatibleEntitlement = isVersionInRange(
        latestVersion.version,
        entitlement!.minimum_version,
        entitlement!.maximum_version,
      );
    } else {
      hasCompatibleEntitlement =
        entitlement!.purchased_version_id === latestVersion.id;
    }
    if (!hasCompatibleEntitlement) {
      upgradeRequired = true;
    }
  }

  let isIncludedInPlan = false;
  if (!isFree && !hasCompatibleEntitlement) {
    isIncludedInPlan = await checkPlanInclusion(internalUserId, agentId, listing);
  }

  const { data: installation } = await supabaseAdmin
    .from("user_agents")
    .select("id, is_active")
    .eq("user_id", internalUserId)
    .eq("agent_id", agentId)
    .maybeSingle();

  const isInstalled = !!installation;
  const isDisabled = isInstalled && !installation!.is_active;

  let hasPendingOrder = false;
  if (!isInstalled) {
    const nowIso = new Date().toISOString();
    const { data: pendingOrders } = await supabaseAdmin
      .from("marketplace_orders")
      .select("id")
      .eq("user_id", internalUserId)
      .eq("status", "pending")
      .gt("expires_at", nowIso);

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
  }

  const agentIsPublic = !isPrivate;
  const versionIsAllowed = versionStatus === "published";
  const listingAvailable = isListed;

  const canInstall =
    agentIsPublic &&
    listingAvailable &&
    versionIsAllowed &&
    !isRefunded &&
    !isInstalled &&
    !hasPendingOrder &&
    !upgradeRequired &&
    (isFree || isIncludedInPlan || hasCompatibleEntitlement);

  const canUse =
    isInstalled &&
    !isDisabled &&
    agentIsPublic &&
    !isRefunded &&
    (isFree || isIncludedInPlan || hasCompatibleEntitlement);

  const canEnable =
    isInstalled &&
    isDisabled &&
    agentIsPublic &&
    listingAvailable &&
    versionIsAllowed &&
    !isRefunded &&
    !upgradeRequired &&
    (isFree || isIncludedInPlan || hasCompatibleEntitlement);

  let denyReason: string | undefined;
  if (isPrivate || !listingAvailable) denyReason = "agent_not_found";
  else if (isRefunded) denyReason = "access_revoked";
  else if (upgradeRequired) denyReason = "upgrade_required";
  else if (!versionIsAllowed) denyReason = "version_unavailable";
  else if (!isFree && !isIncludedInPlan && !hasCompatibleEntitlement)
    denyReason = "payment_required";
  else if (isInstalled && !isDisabled) denyReason = "already_installed";

  return {
    canInstall, canUse, canEnable, hasEntitlement: hasCompatibleEntitlement,
    isFree, isIncludedInPlan, isInstalled, isDisabled,
    hasPendingOrder, isRefunded, isPrivate, isListed,
    versionStatus, agentStatus: agentIsPublic ? (listingAvailable ? "available" : "unlisted") : "private",
    selectedVersionId, denyReason,
  };
}

async function checkPlanInclusion(
  internalUserId: string,
  agentId: string,
  listing?: { included_plan_ids: string[] | null } | null,
): Promise<boolean> {
  const { data: subscription } = await supabaseAdmin
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", internalUserId)
    .in("status", ["active", "trialing"])
    .maybeSingle();

  if (!subscription) return false;

  const userPlanId = subscription.plan as PlanId;

  let item = listing;
  if (!item) {
    const { data: loaded } = await supabaseAdmin
      .from("marketplace_items")
      .select("included_plan_ids")
      .eq("agent_id", agentId)
      .eq("item_type", "agent")
      .maybeSingle();
    item = loaded;
  }

  if (!item || !item.included_plan_ids) return false;
  return (item.included_plan_ids as string[]).includes(userPlanId);
}

export async function installAgent(
  clerkId: string,
  agentId: string,
): Promise<{ success: boolean; error?: string; installationId?: string }> {
  const auth = await getAgentAuthorization(clerkId, agentId);

  if (auth.denyReason === "agent_not_found" || auth.denyReason === "user_not_found") {
    return { success: false, error: auth.denyReason };
  }

  if (auth.isRefunded) return { success: false, error: "access_revoked" };

  if (auth.isInstalled && auth.isDisabled) {
    if (!auth.canEnable) return { success: false, error: auth.denyReason ?? "not_authorized" };
    return enableAgent(clerkId, agentId);
  }

  if (auth.isInstalled) {
    const internalUserId = await resolveInternalUserId(clerkId);
    if (!internalUserId) return { success: false, error: "user_not_found" };
    const { data: existing } = await supabaseAdmin
      .from("user_agents")
      .select("id")
      .eq("user_id", internalUserId)
      .eq("agent_id", agentId)
      .maybeSingle();
    return { success: true, installationId: existing?.id };
  }

  if (!auth.canInstall) return { success: false, error: auth.denyReason ?? "not_authorized" };

  const internalUserId = await resolveInternalUserId(clerkId);
  if (!internalUserId) return { success: false, error: "user_not_found" };

  const { data: installation, error } = await supabaseAdmin
    .from("user_agents")
    .insert({ user_id: internalUserId, agent_id: agentId, is_active: true })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await supabaseAdmin
        .from("user_agents")
        .select("id")
        .eq("user_id", internalUserId)
        .eq("agent_id", agentId)
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

  const { error } = await supabaseAdmin
    .from("user_agents")
    .delete()
    .eq("user_id", internalUserId)
    .eq("agent_id", agentId);

  if (error) return { success: false, error: "uninstall_failed" };
  return { success: true };
}

export async function disableAgent(
  clerkId: string,
  agentId: string,
): Promise<{ success: boolean; error?: string }> {
  const internalUserId = await resolveInternalUserId(clerkId);
  if (!internalUserId) return { success: false, error: "user_not_found" };

  const { error } = await supabaseAdmin
    .from("user_agents")
    .update({ is_active: false })
    .eq("user_id", internalUserId)
    .eq("agent_id", agentId);

  if (error) return { success: false, error: "disable_failed" };
  return { success: true };
}

export async function enableAgent(
  clerkId: string,
  agentId: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await getAgentAuthorization(clerkId, agentId);

  if (!auth.canEnable) {
    return { success: false, error: auth.denyReason ?? "not_authorized" };
  }

  const internalUserId = await resolveInternalUserId(clerkId);
  if (!internalUserId) return { success: false, error: "user_not_found" };

  const { error } = await supabaseAdmin
    .from("user_agents")
    .update({ is_active: true })
    .eq("user_id", internalUserId)
    .eq("agent_id", agentId);

  if (error) return { success: false, error: "enable_failed" };
  return { success: true };
}
