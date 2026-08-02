// Agent entitlements — list the caller's active agent entitlements.
//
// GET /api/marketplace/agents/entitlements
//
// Returns the authenticated user's entitlements with agent metadata.
// Used by the marketplace UI to show "Owned" badges and by the studio to
// gate premium agent access.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  const { clerkId } = await auth(_req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (userError || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { data: entitlements, error } = await supabaseAdmin
    .from("agent_entitlements")
    .select(
      `
      id,
      agent_id,
      purchased_version_id,
      includes_future_updates,
      minimum_version,
      maximum_version,
      order_id,
      status,
      revoked_reason,
      revoked_at,
      created_at,
      updated_at,
      agents (
        id,
        slug,
        display_name,
        description,
        role,
        is_featured,
        price_cents,
        features
      )
    `,
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Unable to fetch entitlements" },
      { status: 500 },
    );
  }

  return NextResponse.json({ entitlements: entitlements ?? [] });
}
