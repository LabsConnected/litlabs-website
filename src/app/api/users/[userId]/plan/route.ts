import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { PLANS, type PlanId } from "@/config/plans";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;

  const ADMIN_CLERK_IDS = (process.env.ADMIN_CLERK_IDS || "")
    .split(",")
    .filter(Boolean);
  const isOwnerOrAdmin =
    clerkId === userId &&
    (ADMIN_CLERK_IDS.includes(clerkId) || (await isAdmin()));
  if (clerkId !== userId && !ADMIN_CLERK_IDS.includes(clerkId) && !(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (isOwnerOrAdmin) {
    return NextResponse.json({
      plan: "pro_builder_beta",
      status: "active",
      current_period_end: null,
      is_admin: true,
    });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ plan: "free" });
  }

  const sb = getAdminSupabase();
  const { data: user } = await sb
    .from("users")
    .select("id")
    .eq("clerk_id", userId)
    .single();

  if (!user) {
    return NextResponse.json({ plan: "free" });
  }

  const { data: sub } = await sb
    .from("subscriptions")
    .select("plan, status, current_period_end")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({
    plan: sub?.plan || "free",
    status: sub?.status || "active",
    current_period_end: sub?.current_period_end || null,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;

  const ADMIN_CLERK_IDS = (process.env.ADMIN_CLERK_IDS || "")
    .split(",")
    .filter(Boolean);
  // Plan mutations are administrative billing operations. A normal user may
  // read their own plan, but must never be able to grant themselves access.
  if (!ADMIN_CLERK_IDS.includes(clerkId) && !(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const plan = typeof body.plan === "string" ? body.plan : "";
  if (!Object.prototype.hasOwnProperty.call(PLANS, plan)) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }
  const planId = plan as PlanId;

  if (isAdminSupabaseConfigured()) {
    const sb = getAdminSupabase();
    const { data: user } = await sb
      .from("users")
      .select("id")
      .eq("clerk_id", userId)
      .single();

    if (user) {
      await sb.from("subscriptions").upsert(
        {
          user_id: user.id,
          plan: planId,
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id", ignoreDuplicates: false },
      );
    }
  }

  return NextResponse.json({ ok: true, plan: planId });
}
