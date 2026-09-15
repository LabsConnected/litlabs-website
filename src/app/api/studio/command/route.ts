import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  resolveTerminalCommandBase,
  TerminalCommandConfigError,
} from "@/lib/studio/terminal-command-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/studio/command
 *
 * Authenticated web command bridge into the canonical CommandRouter.
 *
 * Flow:
 *   Studio Web → this route (Clerk auth) → terminal-server /internal/command
 *   → CommandRouter (agent-core) → RuntimeStore → Socket.IO broadcasts
 *
 * Both `/status /diff /check /test /build` slash commands and CLI
 * `--remote` mode hit this same path through terminal-server.
 */
export async function POST(req: NextRequest) {
  // ─── Auth ──────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── Parse body ────────────────────────────────────────────────
  const body = await req.json().catch(() => null) as {
    command?: string;
    args?: Record<string, unknown>;
    workspaceId?: string;
    cwd?: string;
  } | null;

  if (!body?.command || typeof body.command !== "string") {
    return NextResponse.json({ error: "Missing 'command' field" }, { status: 400 });
  }

  const SUPPORTED = [
    "status", "diff", "check", "test", "build", "debug", "ship",
    "log", "branch", "list_files", "read_file", "search", "inspect_package",
  ];
  if (!SUPPORTED.includes(body.command)) {
    return NextResponse.json(
      { error: `Unsupported command: ${body.command}` },
      { status: 400 },
    );
  }

  // ─── Forward to terminal-server ────────────────────────────────
  const internalKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";
  if (internalKey.length < 32) {
    return NextResponse.json(
      { error: "Terminal server not configured" },
      { status: 503 },
    );
  }

  // The bridge is server-side fetch — only http(s) is valid. A missing or
  // websocket (ws/wss) configuration is a loud 503, never a bogus request.
  let terminalBase: string;
  try {
    terminalBase = resolveTerminalCommandBase();
  } catch (err) {
    if (err instanceof TerminalCommandConfigError) {
      return NextResponse.json(
        { error: err.message, code: "TERMINAL_COMMAND_URL_NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    throw err;
  }

  try {
    const response = await fetch(`${terminalBase}/internal/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": internalKey,
      },
      body: JSON.stringify({
        command: body.command,
        args: body.args,
        workspaceId: body.workspaceId,
        cwd: body.cwd,
        userId: session.userId,
      }),
      signal: AbortSignal.timeout(240_000),
    });

    const payload = await response.json().catch(() => null) as {
      ok?: boolean;
      result?: unknown;
      runId?: string;
      timestamp?: number;
      error?: string;
    } | null;

    if (!response.ok) {
      return NextResponse.json(
        { error: payload?.error ?? `Command failed (${response.status})` },
        { status: response.status },
      );
    }

    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reach terminal server";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
