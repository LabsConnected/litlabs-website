import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  resolveTerminalCommandBase,
  TerminalCommandConfigError,
} from "@/lib/studio/terminal-command-url";
import {
  verifyProjectWorkspace,
  ProjectVerificationError,
} from "@/lib/projects/project-repository";

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
    projectId?: string;
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

  // ─── Establish the caller's own workspace ──────────────────────
  // This is the browser boundary. terminal-server accepts a bare cwd with no
  // workspaceId because the CLI/Termux machine lane needs it — that caller is
  // addressing their own device. A browser is not, so Studio isolation is
  // established HERE and never inherited from that compatibility.
  //
  // The chain is: authenticated user → owned project → provisioned workspace
  // → workspaceId. The workspaceId is DERIVED from the owned project and is
  // never taken from the request, so a caller cannot name a workspace at all.
  if (body.workspaceId !== undefined) {
    return NextResponse.json(
      {
        error:
          "workspaceId is not accepted from the client. Send projectId; the " +
          "workspace is resolved from the project you own.",
        code: "workspace_id_not_accepted",
      },
      { status: 400 },
    );
  }

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return NextResponse.json(
      { error: "Missing 'projectId' field", code: "project_required" },
      { status: 400 },
    );
  }

  let workspaceId: string;
  try {
    const verified = await verifyProjectWorkspace(projectId, session.userId);
    workspaceId = verified.workspaceId;
  } catch (err) {
    // A project owned by someone else and one that does not exist both
    // surface as PROJECT_NOT_FOUND from getProject(projectId, userId), so the
    // response cannot be used to discover which project ids exist.
    const code = err instanceof ProjectVerificationError ? err.code : "PROJECT_NOT_FOUND";
    const status = code === "FORBIDDEN" ? 403 : code === "PROJECT_NOT_FOUND" ? 404 : 409;
    return NextResponse.json(
      {
        error:
          code === "PROJECT_NOT_FOUND" || code === "FORBIDDEN"
            ? "Project not found or not accessible."
            : "Workspace is not ready for commands.",
        code,
      },
      { status },
    );
  }

  // A relative path inside the workspace is the only shape accepted. An
  // absolute path, a Windows drive path, a UNC path, or any traversal segment
  // is refused before dispatch. terminal-server re-checks this against the
  // real root — this is the browser-side half of that contract.
  const requestedCwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (requestedCwd) {
    const isAbsolute = requestedCwd.startsWith("/") || requestedCwd.startsWith("\\");
    const isWindowsDrive = /^[a-zA-Z]:/.test(requestedCwd);
    const hasTraversal = requestedCwd.split(/[\\/]+/).some((segment) => segment === "..");
    if (isAbsolute || isWindowsDrive || hasTraversal) {
      return NextResponse.json(
        {
          error: "The working directory must be a relative path inside the project workspace.",
          code: "cwd_outside_workspace",
        },
        { status: 400 },
      );
    }
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
        // Derived from the project the caller owns — never echoed back from
        // the request body.
        workspaceId,
        cwd: requestedCwd || undefined,
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
