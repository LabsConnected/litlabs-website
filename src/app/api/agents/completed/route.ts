import { NextResponse } from "next/server";
import fs from "fs";

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
    const dir = "/home/litbit/LiTTreeLabstudios/tasks/completed";
    if (!fs.existsSync(dir)) return NextResponse.json(FALLBACK_COMPLETED);
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
    if (files.length === 0) return NextResponse.json(FALLBACK_COMPLETED);
    const tasks = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf-8"));
        return data.milestone || f;
      } catch { return f; }
    });
    return NextResponse.json(tasks.reverse());
  } catch {
    return NextResponse.json(FALLBACK_COMPLETED);
  }
}
