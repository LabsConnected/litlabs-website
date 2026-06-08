import { NextResponse } from "next/server";

/* ── Core agent roster — always present ── */
const CORE_AGENTS = [
  { name: "Director",         role: "Orchestrator",     runningMsg: "Coordinating agent strategy & platform health", idleMsg: "Awaiting orchestration requests"          },
  { name: "Champion",         role: "General Assistant",runningMsg: "Handling user queries in real-time",            idleMsg: "Standing by for queries"                  },
  { name: "Code Champion",    role: "Software Engineer",runningMsg: "Reviewing latest TypeScript changes",           idleMsg: "Awaiting code review requests"            },
  { name: "Social Dominator", role: "Growth & Content", runningMsg: "Scheduling social content queue",              idleMsg: "Content calendar up to date"              },
  { name: "Data Slayer",      role: "Data Scientist",   runningMsg: "Processing telemetry batch",                   idleMsg: "Telemetry stream nominal"                 },
  { name: "Writing Coach",    role: "Content Writer",   runningMsg: "Editing active draft",                         idleMsg: "Standing by for content requests"         },
  { name: "Music Producer",   role: "Music Generation", runningMsg: "Generating audio from prompt",                 idleMsg: "Waiting for audio prompt"                 },
];

/* Deterministic "uptime" based on current hour so it doesn't flicker */
function uptimeFromHour(name: string): string {
  const h = new Date().getHours();
  const seed = (name.charCodeAt(0) + h) % 4;
  return `${seed + 1}h ${(seed * 14) % 60}m`;
}

export async function GET() {
  /* Simulate 2 agents running at any time, rotated by minute */
  const minute = new Date().getMinutes();
  const runningIdx = new Set([minute % 7, (minute + 2) % 7]);

  const agents = CORE_AGENTS.map((a, i) => {
    const isRunning = runningIdx.has(i);
    return {
      name:       a.name,
      role:       a.role,
      status:     isRunning ? "running" : "idle",
      lastAction: isRunning ? a.runningMsg : a.idleMsg,
      uptime:     uptimeFromHour(a.name),
    };
  });

  return NextResponse.json(agents);
}
