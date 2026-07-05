import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("active_tasks")
      .select("id, status, input, output, created_at, updated_at, agents(display_name, slug)")
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
