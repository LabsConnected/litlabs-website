import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createTerminalToken } from "@/lib/terminal-auth";

const RUNNER_URL = process.env.TERMINAL_SERVER_URL || "http://localhost:4001";

/**
 * POST /api/studio/workspaces/[workspaceId]/search
 * Body: { query: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspaceId } = await params;
  const body = await request.json();
  if (!body.query) return NextResponse.json({ error: "query is required" }, { status: 400 });

  try {
    const { token } = createTerminalToken(userId);
    const res = await fetch(`${RUNNER_URL}/v1/workspaces/${workspaceId}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: body.query }),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Search failed" }, { status: 500 });
  }
}
