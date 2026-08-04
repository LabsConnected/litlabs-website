import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/dashboard/layout
 *
 * Persists the user's dashboard widget layout per breakpoint.
 * Stored in the dashboard_layouts table (user_id + breakpoint unique).
 * Falls back gracefully if the table doesn't exist yet.
 */
export async function PUT(request: NextRequest) {
  const { userId } = await auth(request).catch(() => ({ userId: null }));
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { breakpoint: string; placements: unknown[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.breakpoint || !body.placements || !Array.isArray(body.placements)) {
    return NextResponse.json({ error: "Missing breakpoint or placements" }, { status: 400 });
  }

  // Persist to Supabase if configured
  if (isAdminSupabaseConfigured()) {
    try {
      const client = getAdminSupabase();
      await client
        .from("dashboard_layouts")
        .upsert({
          user_id: userId,
          breakpoint: body.breakpoint,
          placements: body.placements,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,breakpoint" });
    } catch {
      // Non-fatal — localStorage is the primary store
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * GET /api/dashboard/layout
 *
 * Returns the user's saved dashboard layout for the current breakpoint.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth(request).catch(() => ({ userId: null }));
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const breakpoint = request.nextUrl.searchParams.get("breakpoint") ?? "desktop";

  if (isAdminSupabaseConfigured()) {
    try {
      const client = getAdminSupabase();
      const { data } = await client
        .from("dashboard_layouts")
        .select("placements")
        .eq("user_id", userId)
        .eq("breakpoint", breakpoint)
        .maybeSingle();

      if (data?.placements) {
        return NextResponse.json({ placements: data.placements, breakpoint });
      }
    } catch {
      // Fall through to empty response
    }
  }

  return NextResponse.json({ placements: null, breakpoint });
}
