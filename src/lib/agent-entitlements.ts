// Agent Entitlement Resolver — server-side authorization for agent runs.
//
// This is the single authority that decides whether a user may run a given
// agent. It is called by every agent execution endpoint (/api/chat,
// /api/chat/unified, and any future agent run route) BEFORE the model is
// invoked. UI hiding is not authorization — this function is.
//
// Access is granted when ANY of the following is true:
//   1. The agent's minimumPlan is covered by the user's active subscription
//      (status active or trialing). Founder counts as Creator-level.
//   2. The user has an active agent_entitlements row for that agent
//      (individually purchased — survives plan downgrade until revoked).
//
// Access is denied when:
//   - The user is not authenticated (caller must check first).
//   - The subscription is past_due, unpaid, canceled, or incomplete_expired.
//   - The entitlement is revoked or the agent is disabled.
//
// Billing (LiTTBits) is handled separately by chargeAgentRun() — charges
// happen atomically and idempotently only after a successful run, and
// never on validation failure.

import "server-only";
import { getSupabaseAdmin, supabaseAdmin } from "@/lib/supabase";
import { getAgentDefinition } from "@/lib/agent-registry";
import { hasPlanAccess, type PlanId } from "@/config/plans";

/** Subscription statuses that grant plan-based agent access. */
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

/** Subscription statuses that deny plan-based agent access. */
const DENIED_SUBSCRIPTION_STATUSES = new Set([
  "past_due",
  "unpaid",
  "canceled",
  "incomplete_expired",
  "incomplete",
]);

export interface EntitlementInput {
  /** Clerk user ID (from auth().clerkId). */
  clerkId: string;
  /** Agent slug (from the registry / URL / request body). */
  agentSlug: string;
}

export interface EntitlementResult {
  allowed: boolean;
  /** The internal Supabase user UUID (resolved from clerkId). */
  internalUserId: string | null;
  /** The user's current effective plan. */
  plan: PlanId;
  /** Subscription status, if any. */
  subscriptionStatus: string | null;
  /** Why access was denied — only present when allowed is false. */
  reason?: "agent_not_found" | "agent_disabled" | "plan_required" | "no_subscription" | "entitlement_revoked";
  /** The plan the user would need to unlock this agent. */
  requiredPlan?: PlanId;
  /** True if the user has a separate purchased entitlement for this agent. */
  hasPurchasedEntitlement: boolean;
}

/**
 * Resolve whether a user may run a given agent.
 *
 * Never trusts client-supplied plan, entitlement, price, cost, or agent
 * configuration — all are loaded server-side from the database and the
 * canonical registry.
 */
export async function resolveAgentEntitlement(
  input: EntitlementInput,
): Promise<EntitlementResult> {
  const { clerkId, agentSlug } = input;

  // 1. Resolve the agent from the canonical registry.
  const agent = getAgentDefinition(agentSlug);
  if (!agent) {
    return denied("agent_not_found", { hasPurchasedEntitlement: false });
  }
  if (!agent.enabled) {
    return denied("agent_disabled", { hasPurchasedEntitlement: false, requiredPlan: agent.minimumPlan });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    // No DB configured — deny in production, but allow free agents in dev
    // so local development works without Supabase.
    if (agent.billingModel === "free" && process.env.NODE_ENV !== "production") {
      return {
        allowed: true,
        internalUserId: null,
        plan: "starter",
        subscriptionStatus: null,
        hasPurchasedEntitlement: false,
      };
    }
    return denied("no_subscription", { hasPurchasedEntitlement: false, requiredPlan: agent.minimumPlan });
  }

  // 2. Resolve the internal user from clerk_id.
  const { data: user, error: userError } = await admin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (userError || !user) {
    return denied("no_subscription", { hasPurchasedEntitlement: false, requiredPlan: agent.minimumPlan });
  }
  const internalUserId = user.id as string;

  // 3. Load the user's active subscription.
  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", internalUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let plan: PlanId = "starter";
  let subscriptionStatus: string | null = sub?.status ?? null;

  if (sub && ACTIVE_SUBSCRIPTION_STATUSES.has(sub.status)) {
    plan = (sub.plan as PlanId) ?? "starter";
    if (!isValidPlan(plan)) plan = "starter";
  } else if (sub && DENIED_SUBSCRIPTION_STATUSES.has(sub.status)) {
    // Subscription exists but is in a denied state — do not fall back to
    // starter; the user had a plan and lost it. They keep purchased
    // entitlements (checked below) but not plan-based access.
    plan = "starter";
    subscriptionStatus = sub.status;
  }

  // 4. Check plan-based access first.
  if (hasPlanAccess(plan, agent.minimumPlan)) {
    return {
      allowed: true,
      internalUserId,
      plan,
      subscriptionStatus,
      hasPurchasedEntitlement: false,
    };
  }

  // 5. Check for an individually purchased agent entitlement.
  // agent_entitlements.agent_id is a UUID FK to agents(id), so resolve
  // the slug → id first, then look up the entitlement.
  let hasPurchasedEntitlement = false;
  const { data: agentRow } = await admin
    .from("agents")
    .select("id")
    .eq("slug", agentSlug)
    .maybeSingle();
  if (agentRow) {
    const { data: entitlement } = await admin
      .from("agent_entitlements")
      .select("status")
      .eq("user_id", internalUserId)
      .eq("agent_id", agentRow.id)
      .maybeSingle();
    if (entitlement && entitlement.status === "active") {
      hasPurchasedEntitlement = true;
    }
  }

  if (hasPurchasedEntitlement) {
    return {
      allowed: true,
      internalUserId,
      plan,
      subscriptionStatus,
      hasPurchasedEntitlement: true,
    };
  }

  // 6. Denied — plan does not cover the agent and no active entitlement.
  return denied("plan_required", {
    internalUserId,
    plan,
    subscriptionStatus,
    hasPurchasedEntitlement: false,
    requiredPlan: agent.minimumPlan,
  });
}

function isValidPlan(p: string): p is PlanId {
  return ["starter", "creator_beta", "pro_builder_beta", "founder"].includes(p);
}

function denied(
  reason: NonNullable<EntitlementResult["reason"]>,
  overrides: Partial<EntitlementResult> = {},
): EntitlementResult {
  return {
    allowed: false,
    internalUserId: null,
    plan: "starter",
    subscriptionStatus: null,
    hasPurchasedEntitlement: false,
    reason,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Billing — atomic, idempotent LiTTBit charge for agent runs         */
/* ------------------------------------------------------------------ */

export interface ChargeResult {
  charged: boolean;
  /** True if this idempotency key was already used — no double charge. */
  replayed: boolean;
  /** Remaining total balance after the charge. */
  balance: number;
  /** Error message if the charge failed (e.g. insufficient balance). */
  error?: string;
}

/**
 * Charge LiTTBits for an agent run. Atomic and idempotent via the
 * debit_credits RPC — a duplicate call with the same idempotency key
 * does not double-charge.
 *
 * Returns charged=false with an error if the balance is insufficient.
 * The caller must NOT run the model if the charge fails.
 */
export async function chargeAgentRun(params: {
  clerkId: string;
  agentSlug: string;
  /** Unique per-run key — prevents double-charging on retry/replay. */
  idempotencyKey: string;
}): Promise<ChargeResult> {
  const agent = getAgentDefinition(params.agentSlug);
  if (!agent) {
    return { charged: false, replayed: false, balance: 0, error: "Unknown agent" };
  }
  // Free agents (LiTT, Spark) cost nothing.
  if (agent.cost.perRun === 0 && agent.cost.per1kTokens === 0) {
    return { charged: false, replayed: false, balance: 0 };
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    // No DB in dev — don't block free-tier testing.
    if (process.env.NODE_ENV !== "production") {
      return { charged: false, replayed: false, balance: 0 };
    }
    return { charged: false, replayed: false, balance: 0, error: "Billing service unavailable" };
  }

  const { data: user } = await admin
    .from("users")
    .select("id")
    .eq("clerk_id", params.clerkId)
    .maybeSingle();
  if (!user) {
    return { charged: false, replayed: false, balance: 0, error: "User not found" };
  }

  const amount = agent.cost.perRun;
  const { data, error } = await admin.rpc("debit_credits", {
    p_user_id: user.id,
    p_amount: amount,
    p_category: "usage",
    p_description: `Agent run: ${agent.name}`,
    p_idempotency_key: params.idempotencyKey,
  });

  if (error) {
    return { charged: false, replayed: false, balance: 0, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const balance = Number(row?.remaining ?? row?.total_after ?? 0);
  const replayed = row?.success === false && balance > 0;

  // success === false with zero balance means insufficient funds.
  if (row?.success === false && balance < amount) {
    return { charged: false, replayed: false, balance, error: "Insufficient LiTTBits" };
  }

  return { charged: true, replayed, balance };
}

/* ------------------------------------------------------------------ */
/*  Marketplace authorization — install/enable/use for purchased agents */
/* ------------------------------------------------------------------ */
//
// These functions are the single source of truth for whether a user may
// install, enable, or use a premium agent via the marketplace. The
// Marketplace UI calls the state endpoint to render the correct button,
// but the installation endpoint re-checks authorization server-side.
//
// This is distinct from resolveAgentEntitlement above, which authorizes
// runtime agent runs against the user's plan or purchased entitlement.

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
  /** The private user_agents.id for this user's installed instance, if installed. */
  agentInstanceId: string | null;
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

// ── Core marketplace authorization ───────────────────────────────────────

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
      agentInstanceId: null,
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
      agentInstanceId: null,
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
  const agentInstanceId = isInstalled ? installation!.id : null;

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
    selectedVersionId, agentInstanceId, denyReason,
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

  // Load the agent template and its latest published version to populate
  // the private instance with the correct version and display name.
  const { data: agentTemplate } = await supabaseAdmin
    .from("agents")
    .select("id, display_name, slug")
    .eq("id", agentId)
    .maybeSingle();

  const { data: latestVersion } = await supabaseAdmin
    .from("agent_versions")
    .select("id")
    .eq("agent_id", agentId)
    .eq("version_status", "published")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: installation, error } = await supabaseAdmin
    .from("user_agents")
    .insert({
      user_id: internalUserId,
      agent_id: agentId,
      agent_version_id: latestVersion?.id ?? null,
      name: agentTemplate?.display_name || "Agent",
      is_active: true,
      status: "active",
      approval_mode: "supervised",
      enabled_tools: [],
    })
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
