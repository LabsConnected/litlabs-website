import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import {
  isOwnerClerkId,
  OWNER_TEST_MODE_COOKIE,
  VALID_SIMULATIONS,
  SIMULATION_OPTIONS,
  type SimulatedPlan,
} from "@/lib/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/owner/test-mode
 *
 * Returns the current test-mode simulation state. Owner-only.
 *
 * Response:
 *   { isOwner: boolean, simulation: SimulatedPlan | null, options: [...] }
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isOwnerClerkId(userId)) {
    return NextResponse.json({ error: "Forbidden — owner access required" }, { status: 403 });
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(OWNER_TEST_MODE_COOKIE)?.value;
  const simulation: SimulatedPlan | null =
    raw && VALID_SIMULATIONS.has(raw as SimulatedPlan) ? (raw as SimulatedPlan) : null;

  return NextResponse.json({
    isOwner: true,
    simulation,
    options: SIMULATION_OPTIONS,
  });
}

/**
 * POST /api/owner/test-mode
 *
 * Sets the active test-mode simulation. Owner-only.
 * This sets a cookie that only affects entitlement resolution — it
 * NEVER modifies Stripe, the subscription table, or the wallet.
 *
 * Body: { simulation: "owner" | "starter" | "creator_beta" | "pro_builder_beta" | "zero_bits" }
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isOwnerClerkId(userId)) {
    return NextResponse.json({ error: "Forbidden — owner access required" }, { status: 403 });
  }

  let body: { simulation?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sim = body.simulation;
  if (!sim || !VALID_SIMULATIONS.has(sim as SimulatedPlan)) {
    return NextResponse.json(
      { error: `Invalid simulation. Valid values: ${[...VALID_SIMULATIONS].join(", ")}` },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  if (sim === "owner") {
    // "owner" means no simulation — clear the cookie
    cookieStore.delete(OWNER_TEST_MODE_COOKIE);
  } else {
    cookieStore.set(OWNER_TEST_MODE_COOKIE, sim, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, // 24 hours — testing sessions are short-lived
    });
  }

  return NextResponse.json({
    ok: true,
    simulation: sim === "owner" ? null : (sim as SimulatedPlan),
    isOwner: true,
  });
}

/**
 * DELETE /api/owner/test-mode
 *
 * Clears the test-mode simulation, restoring full owner access. Owner-only.
 */
export async function DELETE(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isOwnerClerkId(userId)) {
    return NextResponse.json({ error: "Forbidden — owner access required" }, { status: 403 });
  }

  const cookieStore = await cookies();
  cookieStore.delete(OWNER_TEST_MODE_COOKIE);

  return NextResponse.json({ ok: true, simulation: null, isOwner: true });
}
