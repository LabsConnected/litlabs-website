import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject, verifyProjectWorkspace, ProjectVerificationError } from "@/lib/projects/project-repository";
import {
  extractEmbeddedErrorCode,
  HOST_EXECUTION_DISABLED_CODE,
  isHostExecutionPermitted,
} from "@/lib/host-execution-guard";
import { createTerminalToken } from "@/lib/terminal-auth";
import { requireTerminalBaseUrl, terminalNotConfiguredResponse } from "@/lib/terminal-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/studio-projects/[projectId]/workspace-state
 *
 * Returns the deterministic "welcome vs. active workspace" signals for the
 * Studio center routing (P0-2, Larry's standing welcome-state rule):
 *
 * - `scaffolded`: the starter-scaffolding manifest (.litt/scaffold.json) is
 *   still present — the project is brand-new and untouched.
 * - `touched`: the workspace shows evidence of build/edit activity beyond
 *   the seed. The managed workspace is `git init`-ed with a single seed
 *   commit, and every mutation checkpoint commits — so more than one
 *   commit means the first build/edit landed. Falls back to the root file
 *   listing (any file beyond `.git/` + the seeded entry) when git is
 *   unavailable.
 * - `starterContent`: the entry file (index.html) still contains the
 *   LITT-WELCOME-SCREEN marker — the project shows the seeded welcome page,
 *   not real user content.
 *
 * The center "Welcome to LiTT" onboarding shows ONLY for a brand-new
 * untouched project. When a project was touched (manifest consumed by the
 * first write, or a second git commit landed) but the entry still carries
 * the welcome marker (e.g. a trivial additive edit to the scaffolding),
 * the center must show the active workspace — not the welcome preview.
 *
 * Source of truth for the marker: terminal-server/workspace/welcome-screen.ts
 * (WELCOME_SCREEN_MARKER). Duplicated here to avoid pulling the agent-loop
 * module into an API route.
 */
const WELCOME_SCREEN_MARKER = "LITT-WELCOME-SCREEN";
const SCAFFOLD_MANIFEST_PATH = ".litt/scaffold.json";
const ENTRY_FILE_PATH = "index.html";

const TERMINAL_BASE = () => requireTerminalBaseUrl();

function internalServiceKey(): string {
  return process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";
}

/** Run a git command inside the workspace via the terminal server. */
async function execInWorkspace(
  workspaceId: string,
  userId: string,
  command: string,
): Promise<{ exitCode: number; stdout: string }> {
  const resp = await fetch(`${TERMINAL_BASE()}/internal/workspace/${workspaceId}/exec`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": internalServiceKey(),
    },
    body: JSON.stringify({ command, userId }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Workspace exec failed (${resp.status})`);
  const data = (await resp.json().catch(() => null)) as {
    exitCode?: number;
    exit_code?: number;
    stdout?: string;
  } | null;
  return {
    exitCode: data?.exitCode ?? data?.exit_code ?? 1,
    stdout: data?.stdout ?? "",
  };
}

/** Read a workspace file through the terminal server's /ws-files API. */
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
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  const payload = (await resp.json().catch(() => null)) as { content?: unknown } | null;
  return typeof payload?.content === "string" ? payload.content : null;
}

/** List the workspace root through the terminal server's /ws-files API. */
async function listRootFiles(
  workspaceId: string,
  userId: string,
): Promise<Array<{ name: string; type: string }> | null> {
  const { token } = createTerminalToken(userId);
  const resp = await fetch(`${TERMINAL_BASE()}/ws-files?path=${encodeURIComponent(".")}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": workspaceId,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  const payload = (await resp.json().catch(() => null)) as {
    entries?: Array<{ name: string; type: string }>;
  } | null;
  return Array.isArray(payload?.entries) ? payload.entries : null;
}

/**
 * Has the workspace been touched by a build/edit? The managed workspace is
 * seeded with a single git commit; every mutation checkpoint commits, so a
 * second commit proves the first build/edit landed — even a trivial
 * additive edit that kept the welcome-screen marker. Falls back to the
 * root file listing when git is unavailable.
 */
async function isTouched(workspaceId: string, userId: string): Promise<boolean> {
  try {
    const result = await execInWorkspace(workspaceId, userId, "git rev-list --count HEAD");
    if (result.exitCode === 0) {
      const count = parseInt(result.stdout.trim(), 10);
      if (Number.isFinite(count)) return count > 1;
    }
  } catch {
    // Fall through to the file-listing heuristic.
  }
  // Fallback: meaningful files beyond the seed set (.git/ + the seeded
  // entry file). "Files written, not just .git/index.html."
  const entries = await listRootFiles(workspaceId, userId).catch(() => null);
  if (!entries) return false;
  return entries.some((entry) => {
    const name = String(entry.name || "");
    if (!name || name === "." || name === "..") return false;
    if (name === ".git" || name === ENTRY_FILE_PATH) return false;
    return true;
  });
}

/**
 * The refusal code a failed workspace carries, if any. Two sources, in
 * order:
 *  1. The machine code embedded in the stored workspaceError text (the
 *     terminal-server's fail-closed 503 survives storage only as
 *     serialized JSON — see extractEmbeddedErrorCode).
 *  2. Deterministic derivation: a repo-backed (github) project whose
 *     workspace preparation settled failed/error on a deployment where
 *     host execution is not permitted can NEVER be prepared there —
 *     prepareWorkspace for a git source asserts host execution on the
 *     terminal server, which fails closed on every hosted deployment.
 *     Settled stored messages that carry no embedded code (e.g.
 *     "Provisioning timed out" from the stale-provisioning settle) must
 *     not hide that: the refusal is a fact about the deployment and the
 *     source kind, not about the stored text. Managed projects are
 *     excluded — their workspaces prepare through a different path and
 *     a restart can genuinely succeed.
 */
function deriveWorkspaceRefusalCode(project: {
  workspaceError?: string | null;
  workspaceStatus?: string | null;
  sourceType?: string | null;
}): string | null {
  const embedded = extractEmbeddedErrorCode(project.workspaceError);
  if (embedded) return embedded;
  if (
    project.sourceType === "github" &&
    (project.workspaceStatus === "failed" || project.workspaceStatus === "error") &&
    !isHostExecutionPermitted()
  ) {
    return HOST_EXECUTION_DISABLED_CODE;
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  // Read the project record FIRST (DB-only, failure-tolerant): the
  // refusal truth below must not be hostage to the terminal-config gate
  // or to which error verifyProjectWorkspace happens to throw. #901's
  // recovery sat behind both, and on a deployment without a configured
  // terminal base URL the pane never learned the refusal at all.
  let project: Awaited<ReturnType<typeof getProject>> = null;
  try {
    project = await getProject(projectId, userId);
  } catch {
    project = null;
  }
  const storedRefusalCode = project ? deriveWorkspaceRefusalCode(project) : null;

  const terminalUnavailable = terminalNotConfiguredResponse();
  if (terminalUnavailable) {
    // No terminal probing is possible — but a derivable refusal is
    // still the truthful state of this workspace, and the preview pane
    // needs it to suppress a Restart that can never succeed. Report it
    // in the same fail-soft coded-200 shape the verify-error branch
    // uses; only a project with no derivable refusal keeps the 503.
    if (storedRefusalCode) {
      return NextResponse.json(
        {
          code: HOST_EXECUTION_DISABLED_CODE,
          workspaceErrorCode: storedRefusalCode,
          scaffolded: false,
          touched: false,
          starterContent: false,
        },
        { status: 200 },
      );
    }
    return terminalUnavailable;
  }

  try {
    const { workspaceId } = await verifyProjectWorkspace(projectId, userId);

    const [manifest, entry, touched] = await Promise.all([
      readWorkspaceFile(workspaceId, userId, SCAFFOLD_MANIFEST_PATH).catch(() => null),
      readWorkspaceFile(workspaceId, userId, ENTRY_FILE_PATH).catch(() => null),
      isTouched(workspaceId, userId).catch(() => false),
    ]);

    // Scaffold manifest presence = brand-new untouched project.
    // A missing manifest (or unreadable) means the project was touched.
    const scaffolded = manifest !== null;

    // Entry file still carrying the welcome marker = starter content, not a
    // real project. A missing entry file is not starter content.
    const starterContent = entry !== null && entry.includes(WELCOME_SCREEN_MARKER);

    return NextResponse.json({ scaffolded, touched, starterContent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get workspace state";
    // "No workspace yet" is an EXPECTED state for a project whose
    // prepare never succeeded — not a server fault. It used to return
    // 500 by design (code discarded), logging as a console error on
    // every Studio mount. Return the same fail-soft fallback body
    // with a 200 and the code attached; only unexpected throws 500.
    if (
      err instanceof ProjectVerificationError &&
      (err.code === "WORKSPACE_NOT_PROVISIONED" || err.code === "WORKSPACE_NOT_READY")
    ) {
      // Also name the underlying refusal (storedRefusalCode, derived
      // from the project record read at the top of this handler): the
      // stored workspaceError carries the terminal-server's machine
      // code only as embedded JSON text, and settled failure messages
      // may carry no code at all — deriveWorkspaceRefusalCode covers
      // both. Naming it here gives the preview pane a reliable second
      // channel: the preview payload threads the code only when the
      // stored status/error still carry it, and settles code-less on
      // real paths. A failed lookup must not break the fail-soft 200:
      // the code is simply null then.
      return NextResponse.json(
        {
          code: err.code,
          workspaceErrorCode: storedRefusalCode,
          scaffolded: false,
          touched: false,
          starterContent: false,
        },
        { status: 200 },
      );
    }
    // Fail-soft: the caller treats an error as "unknown" and keeps the
    // default center surface. Never block Studio loading on this check.
    return NextResponse.json(
      { error: msg, scaffolded: false, touched: false, starterContent: false },
      { status: 500 },
    );
  }
}
