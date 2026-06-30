import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/jarvis/notifications?limit=20&unread=true
 * Returns notification history for the current user.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ notifications: [], unreadCount: 0 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "30", 10), 100);
  const unreadOnly = searchParams.get("unread") === "true";

  let query = admin
    .from("notifications")
    .select("id, type, priority, title, body, data, channels, read, created_at")
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.eq("read", false);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ notifications: [], unreadCount: 0 });
  }

  const { count } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .or(`user_id.eq.${userId},user_id.is.null`)
    .eq("read", false);

  return NextResponse.json({
    notifications: data || [],
    unreadCount: count || 0,
  });
}

/**
 * PATCH /api/jarvis/notifications
 * Mark notifications as read.
 * Body: { ids: string[] } or { markAll: true }
 */
export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ success: false });
  }

  const body = await req.json();
  const { ids, markAll } = body;

  if (markAll) {
    await admin
      .from("notifications")
      .update({ read: true })
      .or(`user_id.eq.${userId},user_id.is.null`)
      .eq("read", false);
  } else if (ids && Array.isArray(ids)) {
    await admin
      .from("notifications")
      .update({ read: true })
      .in("id", ids);
  }

  return NextResponse.json({ success: true });
}
