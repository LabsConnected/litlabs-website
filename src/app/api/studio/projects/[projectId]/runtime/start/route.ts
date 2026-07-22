import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createTerminalToken } from "@/lib/terminal-auth";

const RUNNER_URL = process.env.TERMINAL_SERVER_URL || "http://localhost:4001";

/**
 * POST /api/studio/projects/[projectId]/runtime/start
 * Starts the development server in the prepared workspace via the terminal-server.
 * Requires workspace_status = ready.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  try {
    const { projectId } = await params;

    const { data: project, error: fetchError } = await sb
      .from("studio_projects")
      .select("workspace_status, user_id, workspace_id, development_command, install_command, package_manager")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.workspace_status !== "ready") {
      return NextResponse.json(
        { error: "Workspace must be ready before starting runtime" },
        { status: 400 },
      );
    }

    if (!project.workspace_id) {
      return NextResponse.json(
        { error: "Workspace ID missing — reprepare the workspace" },
        { status: 400 },
      );
    }

    await sb
      .from("studio_projects")
      .update({
        runtime_status: "starting",
        runtime_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", userId);

    const devCommand = project.development_command || "pnpm dev";
    const installCommand = project.install_command || "pnpm install";

    try {
      const { token } = createTerminalToken(userId);
      const runnerRes = await fetch(`${RUNNER_URL}/v1/workspaces/${project.workspace_id}/runtime/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          installCommand,
          devCommand,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!runnerRes.ok) {
        const err = await runnerRes.json().catch(() => ({ error: "Runner error" }));
        throw new Error(err.error ?? `Runner returned ${runnerRes.status}`);
      }

      const runtimeData = await runnerRes.json();
      const previewUrl = runtimeData.previewUrl ?? null;

      await sb
        .from("studio_projects")
        .update({
          runtime_status: "ready",
          preview_url: previewUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId)
        .eq("user_id", userId);

      return NextResponse.json({
        runtime: {
          status: "ready",
          previewUrl,
        },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Runtime start failed";
      await sb
        .from("studio_projects")
        .update({
          runtime_status: "failed",
          runtime_error: errorMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId)
        .eq("user_id", userId);

      return NextResponse.json({ error: errorMsg }, { status: 502 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Runtime start failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
