/**
 * Terminal V1 token API route.
 *
 * Issues a hardened project-bound terminal token. This route is
 * server-side only and requires Clerk authentication.
 *
 * When the terminal is disabled, returns 503 with FEATURE_DISABLED.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createTerminalTokenV1 } from "@/lib/terminal-v1/token";
import {
  isTerminalEnabled,
  TERMINAL_DISABLED_RESPONSE,
  TERMINAL_DISABLED_STATUS,
} from "@/lib/terminal-v1/control-plane";
import { WorkspaceService } from "@/lib/terminal-v1/workspace-service";
import { getSandboxProvider } from "@/lib/terminal-v1/providers";

export const runtime = "nodejs";

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
  if (!body?.projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  // Get the workspace for this project
  const workspaceService = new WorkspaceService();
  const workspace = await workspaceService.getByUserAndProject(userId, body.projectId);

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (workspace.state !== "ready") {
    return NextResponse.json(
      { error: "Workspace not ready", state: workspace.state },
      { status: 409 },
    );
  }

  // Get or create sandbox
  let sandboxId = workspace.currentSandboxId;
  if (!sandboxId) {
    // Create a new sandbox
    const provider = getSandboxProvider();
    const sandbox = await provider.create({
      workspaceId: workspace.workspaceId,
      userId,
      projectId: body.projectId,
    });
    sandboxId = sandbox.sandboxId;

    // Link sandbox to workspace
    await workspaceService.update(workspace.workspaceId, {
      currentSandboxId: sandboxId,
    });
  }

  // Issue token
  const { token, expiresAt } = createTerminalTokenV1({
    userId,
    projectId: body.projectId,
    workspaceId: workspace.workspaceId,
    sandboxId,
  });

  return NextResponse.json({
    token,
    expiresAt,
    sandboxId,
    workspaceId: workspace.workspaceId,
  });
}
