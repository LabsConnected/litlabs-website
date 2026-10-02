import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { getTerminalServerUrl } from "@/lib/terminal-url";

/**
 * GET /api/studio-projects/[projectId]/workspace-state
 *
 * Returns the deterministic "welcome vs. active workspace" signals for the
 * Studio center routing (P0-2, Larry's standing welcome-state rule):
 *
 * - `scaffolded`: the starter-scaffolding manifest (.litt/scaffold.json) is
 *   still present — the project is brand-new and untouched.
 * - `starterContent`: the entry file (index.html) still contains the
 *   LITT-WELCOME-SCREEN marker — the project shows the seeded welcome page,
 *   not real user content.
 *
 * The center "Welcome to LiTT" onboarding shows ONLY when `scaffolded` is
 * true. When a project was touched (manifest consumed by the first write)
 * but the entry still carries the welcome marker (e.g. a trivial additive
 * edit to the scaffolding), the center must show the active workspace — not
 * the welcome preview.
 *
 * Source of truth for the marker: terminal-server/workspace/welcome-screen.ts
 * (WELCOME_SCREEN_MARKER). Duplicated here to avoid pulling the agent-loop
 * module into an API route.
 */
const WELCOME_SCREEN_MARKER = "LITT-WELCOME-SCREEN";
const SCAFFOLD_MANIFEST_PATH = ".litt/scaffold.json";
const ENTRY_FILE_PATH = "index.html";

const TERMINAL_BASE = () =>
  process.env.TERMINAL_SERVER_INTERNAL_URL ??
  getTerminalServerUrl();

async function readWorkspaceFile(
  workspaceId: string,
  userId: string,
  path: string,
): Promise<string | null> {
  const { token } = createTerminalToken(userId);
  const resp = await fetch(`${TERMINAL_BASE()}/ws-files/read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": workspaceId,
    },
    body: JSON.stringify({ path, encoding: "utf-8" }),
  });
  if (!resp.ok) return null;
  const payload = (await resp.json().catch(() => null)) as { content?: unknown } | null;
  return typeof payload?.content === "string" ? payload.content : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  try {
    const { workspaceId } = await verifyProjectWorkspace(projectId, userId);

    // Scaffold manifest presence = brand-new untouched project.
    // A missing manifest (or unreadable) means the project was touched.
    const manifest = await readWorkspaceFile(workspaceId, userId, SCAFFOLD_MANIFEST_PATH);
    const scaffolded = manifest !== null;

    // Entry file still carrying the welcome marker = starter content, not a
    // real project. A missing entry file is not starter content.
    const entry = await readWorkspaceFile(workspaceId, userId, ENTRY_FILE_PATH);
    const starterContent = entry !== null && entry.includes(WELCOME_SCREEN_MARKER);

    return NextResponse.json({ scaffolded, starterContent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get workspace state";
    // Fail-soft: the caller treats an error as "unknown" and keeps the
    // default center surface. Never block Studio loading on this check.
    return NextResponse.json({ error: msg, scaffolded: false, starterContent: false }, { status: 500 });
  }
}
