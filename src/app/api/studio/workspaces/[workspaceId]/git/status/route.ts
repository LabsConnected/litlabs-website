import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createTerminalToken } from "@/lib/terminal-auth";

const RUNNER_URL = process.env.TERMINAL_SERVER_URL || "http://localhost:4001";

/**
 * GET /api/studio/workspaces/[workspaceId]/git/status
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspaceId } = await params;

  try {
    const { token } = createTerminalToken(userId);
    const res = await fetch(`${RUNNER_URL}/v1/workspaces/${workspaceId}/git/status`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Git status failed" }, { status: 500 });
  }
}
