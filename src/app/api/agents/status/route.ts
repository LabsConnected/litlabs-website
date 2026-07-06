import { NextResponse } from "next/server";
import { AGENTS } from "@/lib/agents";

function uptimeFromHour(name: string): string {
  const h = new Date().getHours();
  const seed = (name.charCodeAt(0) + h) % 4;
  return `${seed + 1}h ${(seed * 14) % 60}m`;
}

const STATUS_MESSAGES: Record<string, { running: string; idle: string }> = {
  director:       { running: "Coordinating agent strategy & platform health",  idle: "Awaiting orchestration requests"    },
  forge:          { running: "Reviewing latest TypeScript changes",              idle: "Awaiting code review requests"      },
  pulse:          { running: "Scheduling social content queue",                  idle: "Content calendar up to date"        },
  visionary:      { running: "Crafting enhanced visual/audio prompts",           idle: "Standing by for creative requests"  },
  home:           { running: "Checking integration & automation state",          idle: "All systems nominal"                },
};

export async function GET() {
  try {
    const minute = new Date().getMinutes();
    const agentIds = ["director", "forge", "pulse", "visionary", "home"];
    const runningIdx = new Set([minute % 5, (minute + 2) % 5]);

    const agents = agentIds.map((id, i) => {
      const a = AGENTS[id];
      if (!a) return null;
      const isRunning = runningIdx.has(i);
      const msgs = STATUS_MESSAGES[id] ?? { running: "Processing active task", idle: "Standing by" };
      return {
        name: a.name,
        slug: a.id,
        role: a.role,
        status: isRunning ? "running" as const : "idle" as const,
        lastAction: isRunning ? msgs.running : msgs.idle,
        uptime: uptimeFromHour(a.name),
      };
    }).filter(Boolean);

    return NextResponse.json(agents);
  } catch {
    return NextResponse.json([]);
  }
}