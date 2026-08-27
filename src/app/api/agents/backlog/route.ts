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
    if (!userRow) return NextResponse.json(0);

    const { count, error } = await supabaseAdmin
      .from("active_tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userRow.id)
      .eq("status", "pending");

    if (error) return NextResponse.json(0);
    return NextResponse.json(count ?? 0);
  } catch {
    return NextResponse.json(0);
  }
}
