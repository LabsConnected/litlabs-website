import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserWallet, updateWalletBalance, claimDailyBonus } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";

/**
 * GET /api/wallet
 * Returns the user's LiTBit Coins wallet balance.
 */
async function getHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const wallet = await getUserWallet(clerkId);
    return NextResponse.json({
      balance: wallet.balance,
      last_claim_date: wallet.last_claim_date,
      updated_at: wallet.updated_at,
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch wallet" }, { status: 500 });
  }
}

/**
 * POST /api/wallet/claim
 * Claims the daily bonus of 50 LiTBit Coins.
 * Body: { type: "daily" }
 */
async function postHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !body.type) {
      return NextResponse.json(
        { error: "Invalid request. Use { type: 'daily' } or { type: 'spend', amount, reason }" },
        { status: 400 }
      );
    }

    /* Spend coins */
    if (body.type === "spend") {
      const amount = typeof body.amount === "number" ? body.amount : 0;
      if (amount <= 0) {
        return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
      }
      const currentWallet = await getUserWallet(clerkId);
      const newBalance = currentWallet.balance - amount;
      if (newBalance < 0) {
        return NextResponse.json(
          { error: "Insufficient balance", balance: currentWallet.balance },
          { status: 400 }
        );
      }
      const wallet = await updateWalletBalance(clerkId, newBalance, { absolute: true });
      return NextResponse.json({
        message: `${amount} LiTBit Coins spent`,
        balance: wallet.balance,
        spent: amount,
        reason: body.reason || "spend",
      });
    }

    if (body.type !== "daily") {
      return NextResponse.json(
        { error: "Invalid type. Use 'daily' or 'spend'" },
        { status: 400 }
      );
    }

    const claimed = await claimDailyBonus(clerkId, 50);
    return NextResponse.json({
      message: "Daily bonus claimed! +50 LiTBit Coins",
      balance: claimed.balance,
      last_claim_date: claimed.last_claim_date,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Daily bonus already claimed") {
      return NextResponse.json(
        { error: "Daily bonus already claimed today" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Failed to claim bonus" }, { status: 500 });
  }
}

/**
 * PUT /api/wallet
 * Updates wallet balance (for purchases, earnings, etc.)
 * Body: { amount: number } - positive for earnings, negative for purchases
 */
async function putHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    
    if (!body || typeof body.amount !== "number") {
      return NextResponse.json(
        { error: "Invalid request. amount (number) is required" },
        { status: 400 }
      );
    }

    const currentWallet = await getUserWallet(clerkId);
    const newBalance = currentWallet.balance + body.amount;
    
    if (newBalance < 0) {
      return NextResponse.json(
        { error: "Insufficient balance", currentBalance: currentWallet.balance },
        { status: 400 }
      );
    }

    const wallet = await updateWalletBalance(clerkId, newBalance, { absolute: true });

    return NextResponse.json({
      message: body.amount > 0 
        ? `+${body.amount} LiTBit Coins added` 
        : `${Math.abs(body.amount)} LiTBit Coins deducted`,
      balance: wallet.balance,
      previousBalance: currentWallet.balance,
      change: body.amount,
    });
  } catch (error) {
    // Error updating wallet:
    return NextResponse.json(
      { error: "Failed to update wallet" },
      { status: 500 }
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 10, 60); // Stricter limit for claiming
export const PUT = withRateLimit(putHandler, 50, 60);
