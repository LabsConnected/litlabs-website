import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserWallet, updateWalletBalance } from "@/lib/user-db";
import { supabase } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limiter";
import { sanitizeIdentifier } from "@/lib/sanitize";

async function resolveDbUserId(clerkId: string): Promise<string | null> {
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  return user?.id ?? null;
}

/**
 * POST /api/users/[userId]/credits
 * Updates user credits (LiTBit Coins) - Admin or system use
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  // Rate limiting
  const { success, remaining, resetTime } = await rateLimit(req, 50, 60);
  if (!success) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "Retry-After": String(resetTime),
        "X-RateLimit-Limit": "50",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetTime),
      },
    });
  }

  try {
    // Verify authentication
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await params;
    const safeUserId = sanitizeIdentifier(userId);

    // Resolve the target user's DB ID (userId param could be clerk_id or uuid)
    const { data: targetUser } = await supabase
      .from("users")
      .select("id, clerk_id")
      .or(`id.eq.${safeUserId},clerk_id.eq.${safeUserId}`)
      .single();

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Only the user themselves or an admin can modify credits
    const ADMIN_CLERK_IDS = (process.env.ADMIN_CLERK_IDS || "")
      .split(",")
      .filter(Boolean);
    const isSelf = clerkId === userId;
    const isAdmin = ADMIN_CLERK_IDS.includes(clerkId);
    if (!isSelf && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const amount = Number(body.amount) || 0;

    // Get current wallet
    const wallet = await getUserWallet(targetUser.clerk_id);
    const newBalance = wallet.balance + amount;
    if (newBalance < 0) {
      return NextResponse.json(
        { error: "Insufficient balance", currentBalance: wallet.balance },
        { status: 400 },
      );
    }

    const updated = await updateWalletBalance(targetUser.clerk_id, newBalance);

    const response = NextResponse.json({
      ok: true,
      credits: updated.balance,
      previousBalance: wallet.balance,
      change: amount,
    });

    response.headers.set("X-RateLimit-Limit", "50");
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    response.headers.set("X-RateLimit-Reset", String(resetTime));

    return response;
  } catch {
    // Error updating credits:
    return NextResponse.json(
      { error: "Failed to update credits" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/users/[userId]/credits
 * Get user credits (LiTBit Coins)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  // Rate limiting
  const { success, resetTime } = await rateLimit(req, 100, 60);
  if (!success) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "Retry-After": String(resetTime),
        "X-RateLimit-Limit": "100",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetTime),
      },
    });
  }

  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await params;
    const safeUserId = sanitizeIdentifier(userId);

    // Resolve the target user — param could be clerk_id or uuid
    const { data: targetUser } = await supabase
      .from("users")
      .select("id, clerk_id")
      .or(`id.eq.${safeUserId},clerk_id.eq.${safeUserId}`)
      .single();

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Only the user themselves or an admin can view credits
    const ADMIN_CLERK_IDS = (process.env.ADMIN_CLERK_IDS || "").split(",").filter(Boolean);
    const isSelf = clerkId === targetUser.clerk_id;
    const isAdmin = ADMIN_CLERK_IDS.includes(clerkId);
    if (!isSelf && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const wallet = await getUserWallet(targetUser.clerk_id);
    return NextResponse.json({ credits: wallet.balance });
  } catch {
    // Error fetching credits:
    return NextResponse.json(
      { error: "Failed to fetch credits" },
      { status: 500 },
    );
  }
}
