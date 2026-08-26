import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isOwnerClerkId, OWNER_BILLING_EXEMPT, OWNER_SPEND_CEILING_USD } from "@/lib/owner";
import { getCreditBalances } from "@/lib/wallet-ledger";
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
      // Owner is billing-exempt — display "DEV ∞" instead of a numeric target.
      // The wallet balance is irrelevant for authorization; usage is metered
      // but never debited. The spend ceiling is in USD, not BITS.
      billingExempt: OWNER_BILLING_EXEMPT,
      displayBalance: "DEV ∞",
      spendCeilingUsd: OWNER_SPEND_CEILING_USD,
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
 * Deprecated: the owner is now billing-exempt (OWNER_BILLING_EXEMPT).
 * No wallet top-up is needed — usage is metered but the wallet is never
 * debited. This endpoint remains for backward compatibility but is a
 * no-op that returns the current billing-exempt status.
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

  const response = NextResponse.json({
    ok: true,
    message: "Owner is billing-exempt — no top-up needed. Usage is metered but never debited.",
    billingExempt: OWNER_BILLING_EXEMPT,
    displayBalance: "DEV ∞",
    spendCeilingUsd: OWNER_SPEND_CEILING_USD,
    topped: false,
  });

  response.headers.set("X-RateLimit-Limit", "10");
  response.headers.set("X-RateLimit-Remaining", String(remaining));
  response.headers.set("X-RateLimit-Reset", String(resetTime));

  return response;
}
