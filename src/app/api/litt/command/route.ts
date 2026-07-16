import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/roles";

export const runtime = "nodejs";
export const maxDuration = 300;

const execFileAsync = promisify(execFile);
type CheckAction = "typecheck" | "lint" | "test" | "build" | "terminal-build";

function checkCommand(root: string, action: CheckAction) {
  const scripts = {
    typecheck: ["node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"],
    lint: ["node_modules/eslint/bin/eslint.js", "."],
    test: ["node_modules/vitest/vitest.mjs", "run"],
    build: ["node_modules/next/dist/bin/next", "build"],
    "terminal-build": [
      "node_modules/typescript/bin/tsc",
      "-p",
      "terminal-server/tsconfig.json",
    ],
  } satisfies Record<CheckAction, string[]>;
  const [script, ...args] = scripts[action];
  return {
    file: process.execPath,
    args: [path.join(/*turbopackIgnore: true*/ root, script), ...args],
  };
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (process.env.ENABLE_LOCAL_BUILD_API !== "true") {
    return NextResponse.json(
      { error: "Local build checks are disabled on this deployment" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  const action = body?.action;
  const allowed: CheckAction[] = [
    "typecheck",
    "lint",
    "test",
    "build",
    "terminal-build",
  ];
  if (typeof action !== "string" || !allowed.includes(action as CheckAction)) {
    return NextResponse.json(
      { error: `action must be one of: ${allowed.join(", ")}` },
      { status: 400 },
    );
  }

  const root = process.cwd();
  const startedAt = Date.now();
  try {
    const command = checkCommand(root, action as CheckAction);
    const { stdout, stderr } = await execFileAsync(command.file, command.args, {
      cwd: root,
      timeout: 240_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, CI: "true" },
    });
    return NextResponse.json({
      ok: true,
      action,
      durationMs: Date.now() - startedAt,
      output: `${stdout}${stderr}`.trim(),
    });
  } catch (error) {
    const details = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
      code?: number | string;
    };
    return NextResponse.json(
      {
        ok: false,
        action,
        durationMs: Date.now() - startedAt,
        exitCode: details.code ?? 1,
        output: `${details.stdout ?? ""}${details.stderr ?? ""}`.trim(),
        error: details.message ?? "Check failed",
      },
      { status: 422 },
    );
  }
}
