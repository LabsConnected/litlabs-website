import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { execSync } from "child_process";
import {
  hostExecutionDisabledResponse,
  hostExecutionBlockedResponse,
  HOST_EXECUTION_DISABLED_CODE,
} from "@/lib/host-execution-guard";

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Gate 1: a fixed git command, but still host exec reachable by any signed-in user.
  // Default-deny: report history as explicitly unavailable. Never return
  // fabricated fallback data that could be mistaken for real commit history.
  const blocked = hostExecutionBlockedResponse("agents-commits", process.env, req);
  if (blocked) {
    return NextResponse.json(
      { ...hostExecutionDisabledResponse("agents/commits"), commits: [], unavailable: true },
      { status: 503 },
    );
  }
  try {
    const commits = execSync("git log --oneline -10 2>/dev/null", { timeout: 3000 })
      .toString().trim().split("\n").filter(Boolean);
    if (commits.length > 0) return NextResponse.json(commits);
  } catch { /* fall through */ }
  // Trusted-local but git unavailable: say so; no fabricated data.
  return NextResponse.json(
    { error: "Commit history is currently unavailable.", code: HOST_EXECUTION_DISABLED_CODE, commits: [], unavailable: true },
    { status: 503 },
  );
}
