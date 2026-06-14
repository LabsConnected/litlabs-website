// Notifications Unread Count API
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

async function getHandler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ count: 0 });

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ count: 0, mock: true });
  }

  try {
    const sb = getAdminSupabase();
    const { data: user } = await sb.from("users").select("id").eq("clerk_id", userId).single();
    if (!user) return NextResponse.json({ count: 0 });

    const { count, error } = await sb
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", user.id)
      .is("read_at", null);

    if (error) throw error;
    return NextResponse.json({ count: count || 0 });
  } catch {
    return NextResponse.json({ count: 0, mock: true });
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
