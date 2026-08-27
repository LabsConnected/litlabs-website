import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    // Resolve Clerk ID → internal user UUID for tenant isolation.
    // service_role bypasses RLS, so we MUST filter explicitly.
    const { data: userRow } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("clerk_id", userId)
      .single();
    if (!userRow) return NextResponse.json(null);

    const { data, error } = await supabaseAdmin
      .from("active_tasks")
      .select("id, status, input, output, created_at, updated_at, agents(display_name, slug)")
      .eq("user_id", userRow.id)
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return NextResponse.json(null);

    return NextResponse.json({
      id:        data.id,
      status:    data.status,
      agent:     (data.agents as { display_name?: string; slug?: string } | null)?.display_name ?? "Agent",
      agentSlug: (data.agents as { display_name?: string; slug?: string } | null)?.slug ?? "",
      input:     data.input,
      output:    data.output,
      started:   data.created_at,
      updated:   data.updated_at,
    });
  } catch {
    return NextResponse.json(null);
  }
}
