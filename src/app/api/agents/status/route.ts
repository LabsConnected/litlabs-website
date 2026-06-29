import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/* ── Fallback roster if DB is unavailable ── */
const FALLBACK_AGENTS = [
  { name: "Director",         role: "Orchestrator",     runningMsg: "Coordinating agent strategy & platform health", idleMsg: "Awaiting orchestration requests"  },
  { name: "Champion",         role: "General Assistant",runningMsg: "Handling user queries in real-time",            idleMsg: "Standing by for queries"          },
  { name: "Code Champion",    role: "Software Engineer",runningMsg: "Reviewing latest TypeScript changes",           idleMsg: "Awaiting code review requests"    },
  { name: "Social Dominator", role: "Growth & Content", runningMsg: "Scheduling social content queue",              idleMsg: "Content calendar up to date"      },
  { name: "Data Slayer",      role: "Data Scientist",   runningMsg: "Processing telemetry batch",                   idleMsg: "Telemetry stream nominal"         },
  { name: "Writing Coach",    role: "Content Writer",   runningMsg: "Editing active draft",                         idleMsg: "Standing by for content requests" },
  { name: "Music Producer",   role: "Music Generation", runningMsg: "Generating audio from prompt",                 idleMsg: "Waiting for audio prompt"         },
];

function uptimeFromHour(name: string): string {
  const h = new Date().getHours();
  const seed = (name.charCodeAt(0) + h) % 4;
  return `${seed + 1}h ${(seed * 14) % 60}m`;
}

export async function GET() {
  try {
    /* Fetch all core agents */
    const { data: agents, error: agentsErr } = await supabaseAdmin
      .from("agents")
      .select("id, slug, display_name, role")
      .eq("is_core", true)
      .order("created_at", { ascending: true });

    if (agentsErr || !agents?.length) throw new Error("no agents");

    /* Fetch running tasks to determine which agents are busy */
    const { data: runningTasks } = await supabaseAdmin
      .from("active_tasks")
      .select("agent_id, status, input")
      .eq("status", "running");

    const runningSet = new Set((runningTasks || []).map(t => t.agent_id));

    const result = agents.map(a => ({
      name:       a.display_name,
      role:       a.role ?? "assistant",
      status:     runningSet.has(a.id) ? "running" : "idle",
      lastAction: runningSet.has(a.id) ? "Processing active task" : "Standing by",
      uptime:     uptimeFromHour(a.display_name),
    }));

    return NextResponse.json(result);
  } catch {
    /* Fall back to deterministic demo */
    const minute = new Date().getMinutes();
    const runningIdx = new Set([minute % 7, (minute + 2) % 7]);
    const agents = FALLBACK_AGENTS.map((a, i) => ({
      name:       a.name,
      role:       a.role,
      status:     runningIdx.has(i) ? "running" : "idle",
      lastAction: runningIdx.has(i) ? a.runningMsg : a.idleMsg,
      uptime:     uptimeFromHour(a.name),
    }));
    return NextResponse.json(agents);
  }
}
