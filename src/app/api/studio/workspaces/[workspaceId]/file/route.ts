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
 * GET /api/studio/workspaces/[workspaceId]/file?path=
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspaceId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const filePath = searchParams.get("path");
  if (!filePath) return NextResponse.json({ error: "path is required" }, { status: 400 });

  try {
    const res = await proxyToRunner(
      `/v1/workspaces/${workspaceId}/file?path=${encodeURIComponent(filePath)}`,
      "GET",
      userId,
    );
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to read file" }, { status: 500 });
  }
}

/**
 * PUT /api/studio/workspaces/[workspaceId]/file
 * Body: { path: string, content: string, expectedVersion?: string }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspaceId } = await params;
  const body = await request.json();
  if (!body.path) return NextResponse.json({ error: "path is required" }, { status: 400 });

  try {
    const res = await proxyToRunner(
      `/v1/workspaces/${workspaceId}/file`,
      "PUT",
      userId,
      body,
    );
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to write file" }, { status: 500 });
  }
}
