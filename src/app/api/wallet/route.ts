import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserWallet } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";
import { canMutateBalances } from "@/lib/authz";
import { adjustWalletBalance } from "@/lib/wallet-ledger";

/**
 * GET /api/wallet
 * Returns the user's LiTBit Coins wallet balance.
 */
async function getHandler() {
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
    return NextResponse.json(
      { error: "Failed to fetch wallet" },
      { status: 500 },
    );
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
        {
          error:
            "Invalid request. Use { type: 'daily' } or { type: 'spend', amount, reason }",
        },
        { status: 400 },
      );
    }

    /* Credit coins (tier activation, rewards, etc.) */
    if (body.type === "credit") {
      const amount = typeof body.amount === "number" ? body.amount : 0;
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000) {
        return NextResponse.json(
          { error: "amount must be a positive number" },
          { status: 400 },
        );
      }
      if (reason.length < 3) {
        return NextResponse.json(
          { error: "reason is required" },
          { status: 400 },
        );
      }
      const wallet = await adjustWalletBalance({
        clerkId,
        amount,
        type: "earn",
        reason,
        idempotencyKey: `credit:${clerkId}:${reason}:${Date.now()}`,
      });
      return NextResponse.json({
        message: `${amount} LiTBit Coins credited`,
        balance: wallet.balance,
        credited: amount,
        reason,
        replayed: wallet.replayed,
      });
    }

    /* Spend coins */
    if (body.type === "spend") {
      const amount = typeof body.amount === "number" ? body.amount : 0;
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      const idempotencyKey =
        typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000) {
        return NextResponse.json(
          { error: "amount must be a positive number" },
          { status: 400 },
        );
      }
      if (reason.length < 3 || idempotencyKey.length < 8) {
        return NextResponse.json(
          { error: "reason and idempotencyKey are required" },
          { status: 400 },
        );
      }
      const wallet = await adjustWalletBalance({
        clerkId,
        amount: -amount,
        type: "spend",
        reason,
        idempotencyKey,
      });
      return NextResponse.json({
        message: `${amount} LiTBit Coins spent`,
        balance: wallet.balance,
        spent: amount,
        reason,
        replayed: wallet.replayed,
      });
    }

    if (body.type !== "daily") {
      return NextResponse.json(
        { error: "Invalid type. Use 'daily', 'credit', or 'spend'" },
        { status: 400 },
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const claimed = await adjustWalletBalance({
      clerkId,
      amount: 50,
      type: "earn",
      reason: "Daily bonus",
      idempotencyKey: `daily:${clerkId}:${today}`,
    });
    return NextResponse.json({
      message: claimed.replayed
        ? "Daily bonus already claimed today"
        : "Daily bonus claimed! +50 LiTBit Coins",
      balance: claimed.balance,
      last_claim_date: today,
      replayed: claimed.replayed,
    });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message === "Daily bonus already claimed"
    ) {
      return NextResponse.json(
        { error: "Daily bonus already claimed today" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Failed to claim bonus" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/wallet
 * Adjusts a wallet balance for refunds, corrections, or earnings.
 * Only admins and internal services may call this endpoint.
 */
async function putHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await canMutateBalances(req))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);

    if (
      !body ||
      typeof body.amount !== "number" ||
      typeof body.reason !== "string" ||
      !body.reason.trim() ||
      typeof body.idempotencyKey !== "string" ||
      !body.idempotencyKey.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid request. amount (number), reason (string), and idempotencyKey (string) are required",
        },
        { status: 400 },
      );
    }

    const wallet = await adjustWalletBalance({
      clerkId,
      amount: body.amount,
      type: "correction",
      reason: body.reason.trim(),
      idempotencyKey: body.idempotencyKey.trim(),
    });

    return NextResponse.json({
      message:
        body.amount > 0
          ? `+${body.amount} LiTBit Coins added`
          : `${Math.abs(body.amount)} LiTBit Coins deducted`,
      balance: wallet.balance,
      previousBalance: wallet.previousBalance,
      change: body.amount,
      reason: body.reason.trim(),
      idempotencyKey: body.idempotencyKey.trim(),
      replayed: wallet.replayed,
    });
  } catch {
    // Error updating wallet:
    return NextResponse.json(
      { error: "Failed to update wallet" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 10, 60); // Stricter limit for claiming
export const PUT = withRateLimit(putHandler, 50, 60);
