import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { execSync } from "child_process";
import { isHostExecutionPermitted } from "@/lib/host-execution-guard";

const FALLBACK_COMMITS = [
  "d85ae75 feat: upgrade AgentTool (boardroom, markdown, rich cards)",
  "8226761 feat: remove top controls bar, move theme/CRT to profile card",
  "7f3a219 feat: merge social feed into home page center column",
  "6b1e4c0 feat: responsive design overhaul — fluid typography, safe areas",
  "5d92f8a feat: AnimatedBackground with holo orbs, aurora, particles",
  "4c87e3b fix: social/page.tsx redirect — resolve duplicate export error",
  "3a74d21 feat: gallery Lightbox component with keyboard nav",
  "2f65b10 feat: PageShell wrapper applied to all pages",
  "1e53a09 feat: Pollinations image generation (free, no key)",
  "0d41c97 feat: LiTTBits wallet with Supabase sync",
];

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Gate 1: no host process in a production-like environment (fixed command,
  // but still a host exec reachable by any signed-in user).
  if (!isHostExecutionPermitted()) return NextResponse.json(FALLBACK_COMMITS);
  try {
    const commits = execSync("git log --oneline -10 2>/dev/null", { timeout: 3000 })
      .toString().trim().split("\n").filter(Boolean);
    if (commits.length > 0) return NextResponse.json(commits);
  } catch { /* fall through */ }
  return NextResponse.json(FALLBACK_COMMITS);
}
