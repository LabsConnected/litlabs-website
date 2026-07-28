import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

async function handler(_req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();

  if (userError || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { data: entitlements, error } = await supabaseAdmin
    .from("agent_entitlements")
    .select(
      "id, agent_version_id, status, created_at, updated_at, agent_versions!inner(agent_id, agents!inner(slug, display_name))",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch entitlements" },
      { status: 500 },
    );
  }

  // Flatten the nested join into a clean response
  const result = (entitlements || []).map((e: Record<string, unknown>) => {
    const version = e.agent_versions as Record<string, unknown> | undefined;
    const agent = version?.agents as Record<string, unknown> | undefined;
    return {
      id: e.id,
      agent_slug: agent?.slug ?? "",
      agent_name: agent?.display_name ?? "",
      agent_version_id: e.agent_version_id,
      status: e.status,
      created_at: e.created_at,
      updated_at: e.updated_at,
    };
  });

  return NextResponse.json({ entitlements: result });
}

export const GET = withRateLimit(handler, 30, 60);
