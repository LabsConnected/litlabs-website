import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { TerminalCapability } from "@/lib/capabilities/types";

export const runtime = "nodejs";

function getTerminalHttpUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_TERMINAL_HTTP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const ws = process.env.NEXT_PUBLIC_TERMINAL_WS_URL;
  return ws?.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "") || "";
}

async function handler() {
  const { userId } = await auth().catch(() => ({ userId: null }));

  const endpoint = getTerminalHttpUrl();

  const baseCapability: TerminalCapability = {
    id: "project-terminal",
    status: "unavailable",
    terminalStatus: "disconnected",
    sessionId: null,
    projectId: null,
    workspaceId: null,
    lastVerifiedAt: new Date().toISOString(),
    error: null,
  };

  if (!endpoint) {
    return NextResponse.json({
      ...baseCapability,
      status: "not_configured",
      error: "Terminal server URL not configured. Set NEXT_PUBLIC_TERMINAL_WS_URL.",
    });
  }

  if (!userId) {
    return NextResponse.json({
      ...baseCapability,
      error: "Not authenticated.",
    });
  }

  try {
    const response = await fetch(`${endpoint}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      return NextResponse.json({
        ...baseCapability,
        status: "error",
        terminalStatus: "error",
        error: `Terminal server returned ${response.status}`,
      });
    }

    const health = await response.json();

    if (!health.ok) {
      return NextResponse.json({
        ...baseCapability,
        status: "error",
        terminalStatus: "error",
        error: "Terminal server health check failed.",
      });
    }

    // Server is alive — but we can't verify a specific session from server-side
    // without session tracking. Return "connecting" so the client verifies
    // its own WebSocket session.
    return NextResponse.json({
      ...baseCapability,
      status: "connecting",
      terminalStatus: "connecting",
      lastVerifiedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      ...baseCapability,
      status: "unavailable",
      terminalStatus: "disconnected",
      error: endpoint
        ? "Terminal server unreachable. Start pnpm terminal:dev, then connect the PTY."
        : "Terminal server not configured.",
    });
  }
}

export const GET = handler;
