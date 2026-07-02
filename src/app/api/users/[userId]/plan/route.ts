import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;

  const ADMIN_CLERK_IDS = (process.env.ADMIN_CLERK_IDS || "")
    .split(",")
    .filter(Boolean);
  if (clerkId !== userId && !ADMIN_CLERK_IDS.includes(clerkId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;

  const ADMIN_CLERK_IDS = (process.env.ADMIN_CLERK_IDS || "")
    .split(",")
    .filter(Boolean);
  if (clerkId !== userId && !ADMIN_CLERK_IDS.includes(clerkId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const plan = body.plan || "free";

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
          plan,
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id", ignoreDuplicates: false },
      );
    }
  }

  return NextResponse.json({ ok: true, plan });
}
