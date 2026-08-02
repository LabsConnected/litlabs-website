/**
 * Terminal V1 preview port API route.
 *
 * POST /api/terminal-v1/preview — expose a port
 * GET /api/terminal-v1/preview?sandboxId=xxx — list preview ports
 * PATCH /api/terminal-v1/preview — make public/private
 * DELETE /api/terminal-v1/preview?sandboxId=xxx&port=xxx — close preview
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  isTerminalEnabled,
  TERMINAL_DISABLED_RESPONSE,
  TERMINAL_DISABLED_STATUS,
} from "@/lib/terminal-v1/control-plane";
import { PreviewPortManager } from "@/lib/terminal-v1/preview-gateway";

export const runtime = "nodejs";

const manager = new PreviewPortManager();

export async function POST(req: NextRequest) {
  if (!isTerminalEnabled()) {
    return NextResponse.json(TERMINAL_DISABLED_RESPONSE, {
      status: TERMINAL_DISABLED_STATUS,
    });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.sandboxId || !body?.port) {
    return NextResponse.json(
      { error: "sandboxId and port are required" },
      { status: 400 },
    );
  }

  try {
    const endpoint = await manager.expose(body.sandboxId, body.port, {
      state: body.state,
      ttlMinutes: body.ttlMinutes,
    });
    return NextResponse.json(endpoint);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to expose port" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  if (!isTerminalEnabled()) {
    return NextResponse.json(TERMINAL_DISABLED_RESPONSE, {
      status: TERMINAL_DISABLED_STATUS,
    });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sandboxId = req.nextUrl.searchParams.get("sandboxId");
  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId is required" }, { status: 400 });
  }

  const endpoints = manager.listBySandbox(sandboxId);
  return NextResponse.json({ endpoints });
}

export async function PATCH(req: NextRequest) {
  if (!isTerminalEnabled()) {
    return NextResponse.json(TERMINAL_DISABLED_RESPONSE, {
      status: TERMINAL_DISABLED_STATUS,
    });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.sandboxId || !body?.port) {
    return NextResponse.json(
      { error: "sandboxId and port are required" },
      { status: 400 },
    );
  }

  const { sandboxId, port, state } = body;
  if (state === "public") {
    const endpoint = manager.makePublic(sandboxId, port);
    if (!endpoint) {
      return NextResponse.json({ error: "Preview not found" }, { status: 404 });
    }
    return NextResponse.json(endpoint);
  } else if (state === "private") {
    const endpoint = manager.makePrivate(sandboxId, port);
    if (!endpoint) {
      return NextResponse.json({ error: "Preview not found" }, { status: 404 });
    }
    return NextResponse.json(endpoint);
  }

  return NextResponse.json({ error: "Invalid state" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  if (!isTerminalEnabled()) {
    return NextResponse.json(TERMINAL_DISABLED_RESPONSE, {
      status: TERMINAL_DISABLED_STATUS,
    });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sandboxId = req.nextUrl.searchParams.get("sandboxId");
  const portStr = req.nextUrl.searchParams.get("port");
  if (!sandboxId || !portStr) {
    return NextResponse.json(
      { error: "sandboxId and port are required" },
      { status: 400 },
    );
  }

  const port = parseInt(portStr, 10);
  const closed = manager.close(sandboxId, port);
  if (!closed) {
    return NextResponse.json({ error: "Preview not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
