import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin, getSupabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/connections/[id]/disconnect
 * Revokes a provider connection for the signed-in user.
 *
 * Currently only GitHub has a server-side connection record
 * (github_installations). Other providers either derive their status
 * (database, terminal) or store API keys in user settings — there is
 * nothing server-side to revoke, so they return 501 rather than
 * pretending to disconnect.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  if (id === "github") {
    if (!getSupabaseAdmin()) {
      return NextResponse.json(
        { error: "Database unavailable — cannot disconnect GitHub." },
        { status: 503 },
      );
    }
    const { error } = await supabaseAdmin
      .from("github_installations")
      .delete()
      .eq("user_id", userId);
    if (error) {
      return NextResponse.json(
        { error: "Failed to disconnect GitHub." },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, provider: "github" });
  }

  return NextResponse.json(
    { error: `Disconnect is not available for "${id}" yet.` },
    { status: 501 },
  );
}

export const dynamic = "force-dynamic";
