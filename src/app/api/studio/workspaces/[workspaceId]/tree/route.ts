import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createTerminalToken } from "@/lib/terminal-auth";

const RUNNER_URL = process.env.TERMINAL_SERVER_URL || "http://localhost:4001";

async function proxyToRunner(
  path: string,
  method: string,
  userId: string,
  body?: unknown,
) {
  const { token } = createTerminalToken(userId);
  const url = `${RUNNER_URL}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return fetch(url, init);
}

/**
 * GET /api/studio/workspaces/[workspaceId]/tree?path=&depth=
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspaceId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const path = searchParams.get("path") || ".";
  const depth = searchParams.get("depth") || "3";

  try {
    const res = await proxyToRunner(
      `/v1/workspaces/${workspaceId}/tree?path=${encodeURIComponent(path)}&depth=${depth}`,
      "GET",
      userId,
    );
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to fetch tree" }, { status: 500 });
  }
}
