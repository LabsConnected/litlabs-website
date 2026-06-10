import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
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
