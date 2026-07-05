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
  "pixel-forge":  { running: "Crafting enhanced visual prompts",                 idle: "Standing by for creative requests"  },
  home:           { running: "Checking integration & automation state",          idle: "All systems nominal"                },
  "data-slayer":  { running: "Processing telemetry batch",                       idle: "Telemetry stream nominal"           },
  "writing-coach":{ running: "Editing active draft",                            idle: "Standing by for content requests"    },
  "music-producer":{ running: "Generating audio from prompt",                    idle: "Waiting for audio prompt"           },
  "security-chief":{ running: "Running security audit",                          idle: "Monitoring for threats"             },
};

export async function GET() {
  try {
    const minute = new Date().getMinutes();
    const runningIdx = new Set([minute % 9, (minute + 3) % 9, (minute + 5) % 9]);

    const agents = Object.values(AGENTS).map((a, i) => {
      const isRunning = runningIdx.has(i);
      const msgs = STATUS_MESSAGES[a.id] ?? { running: "Processing active task", idle: "Standing by" };
      return {
        name: a.name,
        slug: a.id,
        role: a.role,
        status: isRunning ? "running" as const : "idle" as const,
        lastAction: isRunning ? msgs.running : msgs.idle,
        uptime: uptimeFromHour(a.name),
      };
    });

    return NextResponse.json(agents);
  } catch {
    return NextResponse.json([]);
  }
}