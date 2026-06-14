// Notifications API — GET (list) / PATCH (mark read)
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

async function getHandler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unread") === "true";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ notifications: [], unread_count: 0, mock: true });
  }

  try {
    const sb = getAdminSupabase();
    const { data: user } = await sb.from("users").select("id").eq("clerk_id", userId).single();
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    let query = sb
      .from("notifications")
      .select("id, type, actor_id, entity_type, entity_id, content, read_at, created_at, users:actor_id(name, username, avatar_url)")
      .eq("recipient_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadOnly) query = query.is("read_at", null);

    const { data, error } = await query;
    if (error) throw error;

    const unread = (data || []).filter((n: any) => !n.read_at).length;
    return NextResponse.json({ notifications: data || [], unread_count: unread });
  } catch {
    return NextResponse.json({ notifications: [], unread_count: 0, mock: true });
  }
}

async function patchHandler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const notificationId = body?.id;
  const markAll = body?.mark_all === true;

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ success: true, mock: true });
  }

  try {
    const sb = getAdminSupabase();
    const { data: user } = await sb.from("users").select("id").eq("clerk_id", userId).single();
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (markAll) {
      const { error } = await sb
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("recipient_id", user.id)
        .is("read_at", null);
      if (error) throw error;
      return NextResponse.json({ success: true, marked_all: true });
    }

    if (!notificationId) {
      return NextResponse.json({ error: "id or mark_all required" }, { status: 400 });
    }

    const { error } = await sb
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId)
      .eq("recipient_id", user.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true, mock: true });
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const PATCH = withRateLimit(patchHandler, 50, 60);
