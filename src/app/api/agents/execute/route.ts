/**
 * POST /api/agents/execute
 * Admin-only endpoint to run allowlisted shell commands.
 * Requires: ENABLE_AGENT_COMMANDS=true env var.
 * Rate-limited to 30 req / 60 s per admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { executeCommand } from "@/lib/command-executor";
import { logCommandExecution } from "@/lib/agent-logger";

/* ------------------------------------------------------------------ */
/*  Admin guard                                                        */
/* ------------------------------------------------------------------ */

function getAdminIds(): string[] {
  const env = process.env.ADMIN_USER_IDS ?? process.env.ADMIN_USER_ID ?? "";
  return env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const admins = getAdminIds();
  if (admins.length === 0) return false;
  return admins.includes(userId);
}

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */

async function handler(req: NextRequest): Promise<NextResponse> {
  // Feature gate
  if (process.env.ENABLE_AGENT_COMMANDS !== "true") {
    return NextResponse.json(
      { error: "Agent command execution is disabled. Set ENABLE_AGENT_COMMANDS=true to enable." },
      { status: 403 },
    );
  }

  // Auth
  const { userId } = await auth();
  if (!isAdmin(userId)) {
    return NextResponse.json(
      { error: "Access denied. Admin only." },
      { status: 403 },
    );
  }

  // Parse body
  let body: {
    command?: unknown;
    args?: unknown;
    cwd?: unknown;
    timeout?: unknown;
    requestId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { command, args, cwd, timeout, requestId } = body;

  if (!command || typeof command !== "string") {
    return NextResponse.json({ error: "command is required and must be a string" }, { status: 400 });
  }

  const resolvedArgs: string[] = Array.isArray(args)
    ? args.map(String)
    : [];

  const resolvedCwd = typeof cwd === "string" ? cwd : undefined;
  const resolvedTimeout = typeof timeout === "number" && timeout > 0 ? timeout : undefined;

  // Execute
  const result = await executeCommand({
    command,
    args: resolvedArgs,
    cwd: resolvedCwd,
    timeoutMs: resolvedTimeout,
  });

  // Audit log (fire and forget — never block the response)
  void logCommandExecution({
    agentSlug: "admin-terminal",
    userId: userId!,
    command,
    args: resolvedArgs,
    cwd: resolvedCwd,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    outputLength: result.stdout.length + result.stderr.length,
    truncated: result.truncated,
    allowed: result.ok || !result.error?.includes("not on the allowlist"),
    ok: result.ok,
    error: result.error,
  });

  return NextResponse.json({
    ...result,
    requestId: requestId ?? null,
  });
}

export const POST = withRateLimit(handler, 30, 60);
