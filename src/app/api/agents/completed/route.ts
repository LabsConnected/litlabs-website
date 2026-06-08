import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const FALLBACK_COMPLETED = [
  "Merge social feed into Home page",
  "Upgrade AgentTool with boardroom + markdown",
  "Rebuild Hive Mind command center",
  "Remove debug toolbar from dashboard",
  "Responsive design overhaul — all breakpoints",
  "AnimatedBackground with aurora & particles",
  "Pollinations free image generation",
  "LiTBit Coins wallet — Supabase sync",
  "PageShell applied to all pages",
  "Gallery Lightbox with keyboard nav",
];

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("active_tasks")
      .select("output, updated_at, agents(display_name)")
      .eq("status", "completed")
      .order("updated_at", { ascending: false })
      .limit(20);

    if (!error && data && data.length > 0) {
      const tasks = data.map(t => {
        const output = t.output as Record<string, string> | null;
        const agentName = (t.agents as { display_name?: string } | null)?.display_name ?? "Agent";
        return output?.milestone ?? output?.summary ?? `${agentName} — task completed`;
      });
      return NextResponse.json(tasks);
    }
  } catch { /* fall through */ }

  return NextResponse.json(FALLBACK_COMPLETED);
}
