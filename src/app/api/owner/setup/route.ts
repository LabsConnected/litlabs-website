import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isOwnerClerkId, OWNER_WALLET_TARGET } from "@/lib/owner";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { rateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/owner/setup
 *
 * Returns the owner's current account state: role, plan, wallet balance,
 * project count, and any premium capabilities currently blocked.
 * Owner-only.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isOwnerClerkId(userId)) {
    return NextResponse.json({ error: "Forbidden — owner access required" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  // Resolve user
  const { data: user } = await admin
    .from("users")
    .select("id, clerk_id, email, role, created_at")
    .eq("clerk_id", userId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "Owner user not found in users table" }, { status: 404 });
  }

  // Subscription
  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", user.id)
    .maybeSingle();

  // Wallet
  let balances = { monthly: 0, purchased: 0, betaPromotional: 0, total: 0 };
  try {
    const creditBalances = await getCreditBalances(userId);
    balances = {
      monthly: creditBalances.monthly,
      purchased: creditBalances.purchased,
      betaPromotional: creditBalances.betaPromotional,
      total: creditBalances.total,
    };
  } catch {
    // Ledger not available
  }

  // Project count
  const { count: projectCount } = await admin
    .from("studio_projects")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  const effectivePlan = sub?.status === "active" ? sub.plan : "starter";

  return NextResponse.json({
    user: {
      id: user.id,
      clerkId: user.clerk_id,
      email: user.email,
      dbRole: user.role || "user",
      isOwner: true,
    },
    subscription: {
      plan: effectivePlan,
      status: sub?.status ?? null,
    },
    wallet: {
      ...balances,
      target: OWNER_WALLET_TARGET,
      needsTopUp: balances.total < OWNER_WALLET_TARGET,
      topUpAmount: Math.max(0, OWNER_WALLET_TARGET - balances.total),
    },
    projects: {
      count: projectCount ?? 0,
      limit: 999_999, // owner has effectively unlimited
    },
    capabilities: {
      // All enabled for owner
      github: true,
      terminal: true,
      voice: true,
      premiumModels: true,
      deployment: true,
      beta: true,
      // What would be blocked at the current effective plan (if not owner)
      blockedIfNotOwner: effectivePlan === "starter"
        ? ["github", "terminal", "voice", "premiumModels", "deployment", "multipleProjects"]
        : [],
    },
  });
}

/**
 * POST /api/owner/setup
 *
 * Tops up the owner's wallet to the target balance (250,000 LiTTBits)
 * using the existing audited ledger mechanism. Only grants the difference
 * if the current balance is below target. Owner-only.
 *
 * This does NOT bypass metering — every real operation still deducts
 * normally. It just ensures the owner has enough LiTTBits to test all
 * features without hitting artificial limits.
 */
export async function POST(req: NextRequest) {
  const { success, remaining, resetTime } = await rateLimit(req, 10, 60);
  if (!success) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "Retry-After": String(resetTime),
        "X-RateLimit-Limit": "10",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetTime),
      },
    });
  }

  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isOwnerClerkId(userId)) {
    return NextResponse.json({ error: "Forbidden — owner access required" }, { status: 403 });
  }

  try {
    const balances = await getCreditBalances(userId);
    const currentTotal = balances.total;
    const needed = OWNER_WALLET_TARGET - currentTotal;

    if (needed <= 0) {
      return NextResponse.json({
        ok: true,
        message: "Wallet already at or above target",
        balance: currentTotal,
        target: OWNER_WALLET_TARGET,
        topped: false,
      });
    }

    // Use the audited ledger to grant the difference
    const result = await adjustWalletBalance({
      clerkId: userId,
      amount: needed,
      type: "correction",
      reason: `Owner testing wallet top-up to ${OWNER_WALLET_TARGET}`,
      idempotencyKey: `owner_setup:${userId}:${new Date().toISOString().slice(0, 10)}`,
    });

    const response = NextResponse.json({
      ok: true,
      message: `Wallet topped up by ${needed} LiTTBits`,
      balance: result.balance,
      previousBalance: result.previousBalance,
      topped: needed,
      target: OWNER_WALLET_TARGET,
      replayed: result.replayed,
    });

    response.headers.set("X-RateLimit-Limit", "10");
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    response.headers.set("X-RateLimit-Reset", String(resetTime));

    return response;
  } catch {
    return NextResponse.json(
      { error: "Failed to top up owner wallet" },
      { status: 500 },
    );
  }
}
