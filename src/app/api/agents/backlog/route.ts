import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { count, error } = await supabaseAdmin
      .from("active_tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    if (error) return NextResponse.json(0);
    return NextResponse.json(count ?? 0);
  } catch {
    return NextResponse.json(0);
  }
}
