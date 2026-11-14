import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject, updateProjectRuntime } from "@/lib/projects/project-repository";
import { ensureWorkspaceAlive, provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";
import { restoreWorkspaceFromLatestDeployment } from "@/lib/studio/workspace-rehydration";
import { SecretBroker } from "@/lib/terminal-v1/secret-broker";
import { extractClerkEnvFromSecrets } from "@/lib/preview-clerk-env";
import { createTerminalToken } from "@/lib/terminal-auth";
import { requireTerminalBaseUrl } from "@/lib/terminal-config";
import {
  startPreviewInternal,
  getPreviewStatusInternal,
  stopPreviewInternal,
  buildPreviewProxyUrl,
} from "@/lib/terminal-internal-client";
import { collectPreviewAssetManifest } from "@/lib/projects/preview-asset-manifest";
import { createPreviewToken } from "@/lib/projects/preview-token";
import { extractEmbeddedErrorCode, HOST_EXECUTION_DISABLED_CODE, isHostExecutionPermitted } from "@/lib/host-execution-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same signal /workspace-state uses to detect seed content. Duplicated here
// to avoid pulling the terminal-server module into an API route.
const WELCOME_SCREEN_MARKER = "LITT-WELCOME-SCREEN";

/**
 * GET /api/studio-projects/[projectId]/preview
 * Return the current preview status. Does NOT trust DB alone —
 * asks the Railway terminal server for live runtime status.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Wave-4 truth threading: when workspace preparation failed, recover the
  // machine code embedded in the stored error (e.g. the terminal-server's
  // fail-closed HOST_EXECUTION_DISABLED) so the preview pane can render
  // the honest state instead of a generic failure. Null for every other
  // project state.
  //
  // Deterministic fallback (follow-up to #901): settled failure messages
  // can carry no embedded code at all ("Provisioning timed out" from the
  // stale-provisioning settle) — yet a repo-backed project whose prepare
  // settled failed on a deployment where host execution is not permitted
  // can never be prepared there, so the refusal is derivable from the
  // source kind + settled status + the deployment's own execution
  // policy, without parsing free text. Managed projects are excluded: a
  // restart can genuinely succeed for them. (Same derivation the
  // workspace-state route performs for its channel.)
  const workspaceFailureCode =
    project.workspaceStatus === "failed" || project.workspaceStatus === "error"
      ? extractEmbeddedErrorCode(project.workspaceError) ??
        (project.sourceType === "github" && !isHostExecutionPermitted()
          ? HOST_EXECUTION_DISABLED_CODE
          : null)
      : null;

  if (!project.workspaceId) {
    // No workspace was ever provisioned for this project. This is the
    // "not_started" state — distinct from "stopped" (workspace exists but
    // dev server isn't running) and "unreachable" (runtime check failed).
    return NextResponse.json({
      runtimeStatus: "not_started",
      previewUrl: null,
      runtimeError: null,
      runtimeErrorCode: workspaceFailureCode,
      framework: project.framework,
      developmentCommand: project.developmentCommand,
      packageManager: project.packageManager,
      logs: [],
    });
  }

  // Static projects: return ready status with static preview URL.
  // No dev-server health check needed — files are served directly.
  // Verify index.html exists AND carries real content: a workspace whose
  // only entry file is still the seeded welcome screen reports not_started
  // (never "ready" — the preview must not imply generated content exists).
  if (project.framework === "static") {
    const notStarted = (extra?: Record<string, unknown>) =>
      NextResponse.json({
        runtimeStatus: "not_started",
        previewUrl: null,
        runtimeError: null,
        framework: "static",
        developmentCommand: null,
        packageManager: null,
        logs: [],
        ...extra,
      });
    const unreachable = (runtimeError: string) =>
      NextResponse.json({
        runtimeStatus: "unreachable",
        previewUrl: null,
        runtimeError,
        runtimeErrorCode: workspaceFailureCode,
        framework: "static",
        developmentCommand: null,
        packageManager: null,
        logs: [],
      });

    let terminalBase: string;
    try {
      terminalBase = requireTerminalBaseUrl();
    } catch (err) {
      // Terminal not configured at all: a failed runtime CHECK, not
      // evidence the preview was never started.
      return unreachable(err instanceof Error ? err.message : "Preview runtime unreachable");
    }

    // One entry-document read against a workspace. A 404 splits into
    // workspaceMissing (the terminal lost the WHOLE workspace — the
    // exact body the files routes recover from) vs a plain file-level
    // miss (workspace exists, entry file does not).
    const readEntry = async (
      workspaceId: string,
    ): Promise<
      | { kind: "ok"; content: string | null }
      | { kind: "missing"; workspaceMissing: boolean }
      | { kind: "error"; status: number }
      | { kind: "unreachable"; message: string }
    > => {
      try {
        const { token } = createTerminalToken(userId, { workspaceId, projectId });
        const resp = await fetch(`${terminalBase}/ws-files/read`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "X-Workspace-Id": workspaceId,
          },
          body: JSON.stringify({ path: "index.html", encoding: "utf-8" }),
          // 15s, matching the preview serving route's /ws-files/read budget
          // (src/app/api/preview/[projectId]/[[...path]]/route.ts).
          signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) {
          if (resp.status === 404) {
            const body = (await resp.json().catch(() => null)) as { error?: unknown } | null;
            return { kind: "missing", workspaceMissing: body?.error === "Workspace not found" };
          }
          return { kind: "error", status: resp.status };
        }
        const entry = (await resp.json().catch(() => null)) as { content?: unknown } | null;
        return { kind: "ok", content: typeof entry?.content === "string" ? entry.content : null };
      } catch (err) {
        return {
          kind: "unreachable",
          message: err instanceof Error ? err.message : "Preview runtime unreachable",
        };
      }
    };

    let effectiveWorkspaceId = project.workspaceId;
    let restoredFromDeploymentId: string | undefined;
    let recoveryFlags: Record<string, unknown> = {};

    let read = await readEntry(effectiveWorkspaceId);

    // Recovery parity with the files routes: a workspace-level 404
    // means the terminal lost the workspace. Re-prepare — which for a
    // static project also restores the deployed snapshot over the
    // seeded template (ensureWorkspaceAlive) — and read once more,
    // instead of reporting not_started for a workspace that can heal.
    if (read.kind === "missing" && read.workspaceMissing) {
      let recovered: Awaited<ReturnType<typeof ensureWorkspaceAlive>>;
      try {
        recovered = await ensureWorkspaceAlive(projectId, userId, project.workspaceId);
      } catch (err) {
        return unreachable(err instanceof Error ? err.message : "Workspace recovery failed");
      }
      effectiveWorkspaceId = recovered.workspaceId;
      if (recovered.restoredFromDeploymentId) {
        restoredFromDeploymentId = recovered.restoredFromDeploymentId;
        recoveryFlags = { workspaceRestoredFromDeploymentId: recovered.restoredFromDeploymentId };
      } else if (recovered.contentLoss) {
        recoveryFlags = {
          contentLoss: true,
          survivingDeploymentId: recovered.survivingDeploymentId ?? null,
        };
      }
      read = await readEntry(effectiveWorkspaceId);
    }

    if (read.kind === "missing") {
      // The terminal authoritatively reports index.html missing —
      // the workspace is empty and the preview was never started.
      return notStarted(recoveryFlags);
    }
    if (read.kind === "error") {
      // Any other error (5xx, auth, …) means the runtime CHECK failed —
      // it says nothing about whether the preview was started. Report
      // "unreachable", mirroring the dev-server branch below, so clients
      // retry instead of concluding the preview doesn't exist.
      return unreachable(`Terminal file read failed (HTTP ${read.status})`);
    }
    if (read.kind === "unreachable") {
      // The terminal is unreachable or too slow (fetch threw or timed
      // out). A failed runtime CHECK, not evidence the preview was
      // never started.
      return unreachable(read.message);
    }

    let entryHtml = read.content;

    if (entryHtml !== null && entryHtml.includes(WELCOME_SCREEN_MARKER)) {
      // The entry file is still the seeded welcome screen. For a
      // project that has never deployed, that IS its correct state
      // (brand-new — the starter response below is today's behavior).
      // For a project WITH deployments, the scaffold is what a lost
      // workspace was silently re-seeded with: restore the deployed
      // snapshot over it before reporting starter state.
      if (restoredFromDeploymentId || recoveryFlags.contentLoss) {
        // Recovery already ran for THIS request (the workspace was
        // missing and got re-prepared above): its verdict stands —
        // either it restored and the entry STILL reads as scaffold, or
        // it flagged the loss. Report starter state with that verdict
        // attached; never restore twice in one request.
        return NextResponse.json({
          runtimeStatus: "not_started",
          previewUrl: null,
          runtimeError: null,
          starterContent: true,
          framework: "static",
          developmentCommand: null,
          packageManager: null,
          logs: [],
          ...recoveryFlags,
        });
      }
      const outcome = await restoreWorkspaceFromLatestDeployment({
        projectId,
        userId,
        workspaceId: effectiveWorkspaceId,
      });
      if (outcome.kind === "content-loss") {
        return NextResponse.json({
          runtimeStatus: "not_started",
          previewUrl: null,
          runtimeError: null,
          starterContent: true,
          contentLoss: true,
          survivingDeploymentId: outcome.survivingDeploymentId,
          framework: "static",
          developmentCommand: null,
          packageManager: null,
          logs: [],
        });
      }
      if (outcome.kind === "no-deployments") {
        return NextResponse.json({
          runtimeStatus: "not_started",
          previewUrl: null,
          runtimeError: null,
          starterContent: true,
          framework: "static",
          developmentCommand: null,
          packageManager: null,
          logs: [],
        });
      }
      // Restored: re-read the entry document and continue with the
      // REAL content. If it still reads as starter content (or
      // vanished), report starter honestly rather than "ready" over a
      // document that is not the site.
      restoredFromDeploymentId = outcome.deploymentId;
      recoveryFlags = { workspaceRestoredFromDeploymentId: outcome.deploymentId };
      const reread = await readEntry(effectiveWorkspaceId);
      if (
        reread.kind === "ok" &&
        typeof reread.content === "string" &&
        !reread.content.includes(WELCOME_SCREEN_MARKER)
      ) {
        entryHtml = reread.content;
      } else {
        return NextResponse.json({
          runtimeStatus: "not_started",
          previewUrl: null,
          runtimeError: null,
          starterContent: true,
          framework: "static",
          developmentCommand: null,
          packageManager: null,
          logs: [],
          ...recoveryFlags,
        });
      }
    }

    // The capability token must authorize the REAL document's asset
    // closure — scripts, linked pages, and every renderable subresource
    // (images, fonts, media, css url() targets) the opaque-origin iframe
    // will request without a session cookie. Minting from a stub document
    // would sign an empty manifest and 403 every asset.
    const { token: terminalToken } = createTerminalToken(userId, {
      workspaceId: effectiveWorkspaceId,
      projectId,
    });
    const readWorkspaceText = async (path: string): Promise<string | null> => {
      const asset = await fetch(`${terminalBase}/ws-files/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${terminalToken}`, "X-Workspace-Id": effectiveWorkspaceId },
        body: JSON.stringify({ path, encoding: "utf-8" }),
        signal: AbortSignal.timeout(15000),
      });
      if (!asset.ok) return null;
      const payload = (await asset.json().catch(() => null)) as { content?: unknown } | null;
      return typeof payload?.content === "string" ? payload.content : null;
    };
    const manifest = entryHtml !== null
      ? await collectPreviewAssetManifest("index.html", entryHtml, readWorkspaceText)
      : { assets: ["index.html"], complete: true };
    // Fail closed like the serving route: an unverifiable closure means the
    // signed token would 403 assets the page needs — report failed rather
    // than "ready" over a preview that cannot render.
    if (!manifest.complete) {
      return NextResponse.json({
        runtimeStatus: "failed",
        previewUrl: null,
        runtimeError: "Preview asset manifest could not be verified",
        framework: "static",
        developmentCommand: null,
        packageManager: null,
        logs: [],
      });
    }
    const token = createPreviewToken(userId, {
      projectId,
      workspaceId: effectiveWorkspaceId,
      assets: manifest.assets,
    });
    return NextResponse.json({
      runtimeStatus: "ready",
      previewUrl: `/api/preview/${encodeURIComponent(projectId)}/t/${token.token}/index.html`,
      previewToken: token.token,
      previewTokenExpiresAt: token.expiresAt,
      runtimeError: null,
      framework: "static",
      developmentCommand: null,
      packageManager: null,
      logs: [],
      ...(restoredFromDeploymentId
        ? { workspaceRestoredFromDeploymentId: restoredFromDeploymentId }
        : {}),
    });
  }

  try {
    const runtimeStatus = await getPreviewStatusInternal(project.workspaceId, userId);

    if (!runtimeStatus) {
      // Workspace exists in DB but the terminal server returned no status.
      // This is "stopped" — the dev server isn't running, not an error.
      return NextResponse.json({
        runtimeStatus: "stopped",
        previewUrl: null,
        runtimeError: null,
        runtimeErrorCode: workspaceFailureCode,
        framework: project.framework,
        developmentCommand: project.developmentCommand,
        packageManager: project.packageManager,
        logs: [],
      });
    }

    const dbSaidReady = project.runtimeStatus === "ready";
    const actuallyReady = runtimeStatus.status === "ready";
    if (dbSaidReady && !actuallyReady) {
      await updateProjectRuntime(projectId, userId, {
        runtimeStatus: runtimeStatus.status,
        previewUrl: null,
        runtimeError: runtimeStatus.error,
      });
    }

    const previewUrl = actuallyReady
      ? buildPreviewProxyUrl(project.workspaceId)
      : null;

    return NextResponse.json({
      runtimeStatus: runtimeStatus.status,
      previewUrl,
      runtimeError: runtimeStatus.error,
      runtimeErrorCode: runtimeStatus.errorCode ?? workspaceFailureCode,
      framework: runtimeStatus.framework ?? project.framework,
      developmentCommand: runtimeStatus.command ?? project.developmentCommand,
      packageManager: project.packageManager,
      logs: runtimeStatus.logs,
    });
  } catch (err) {
    // The runtime status check itself threw — the terminal server is
    // unreachable or returned an unexpected error. This is "unreachable",
    // NOT "stopped" (which means the dev server simply isn't running).
    return NextResponse.json({
      runtimeStatus: "unreachable",
      previewUrl: null,
      runtimeError: err instanceof Error ? err.message : "Preview runtime unreachable",
      runtimeErrorCode: workspaceFailureCode,
      framework: project.framework,
      developmentCommand: project.developmentCommand,
      packageManager: project.packageManager,
      logs: [],
    });
  }
}

/**
 * POST /api/studio-projects/[projectId]/preview
 * Start (or restart) the preview dev server on the Railway terminal server.
 * Does NOT mark "ready" until the dev server passes an HTTP health probe.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Static projects don't use a dev server. Reject startup attempts at the
  // API boundary (UI checks alone aren't a security boundary).
  if (project.framework === "static") {
    return NextResponse.json(
      { error: "Static projects use the static preview endpoint (/api/preview/[projectId]) and do not require a dev server." },
      { status: 400 }
    );
  }

  // Auto-provision the workspace if it was never prepared. This is the fix
  // for the "Prepare preview" → 409 "Workspace not provisioned" loop: the
  // preview start endpoint now provisions the workspace itself so the user
  // never has to know what a "workspace" or "repository binding" is.
  // GitHub-backed projects always go through provisionWorkspaceForProject so
  // the workspace is re-synced to the latest repo state on every preview
  // start (otherwise the preview serves the stale clone from provisioning).
  let workspaceId = project.workspaceId;
  try {
    if (!workspaceId || !project.workspaceRoot || project.sourceType === "github") {
      workspaceId = await provisionWorkspaceForProject(projectId, userId);
    } else {
      const recovered = await ensureWorkspaceAlive(projectId, userId, workspaceId);
      workspaceId = recovered.workspaceId;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Workspace provisioning failed";
    await updateProjectRuntime(projectId, userId, {
      runtimeStatus: "failed",
      previewUrl: null,
      runtimeError: message,
    });
    const runtimeErrorCode = (err as { code?: string }).code ?? extractEmbeddedErrorCode(message);
    return NextResponse.json({
      error: message,
      runtimeStatus: "failed",
      runtimeError: message,
      runtimeErrorCode,
      // A designed host-execution refusal is a 503, not a 500: the
      // status must match the code the body already carries, or
      // clients and monitoring read a known refusal as breakage.
    }, { status: runtimeErrorCode === HOST_EXECUTION_DISABLED_CODE ? 503 : 500 });
  }

  await updateProjectRuntime(projectId, userId, {
    runtimeStatus: "starting",
    previewUrl: null,
    runtimeError: null,
  });

  try {
    // Resolve the project's configured Clerk keys from its secret store
    // so the preview runtime gets the PROJECT's keys — not the terminal
    // server's container env (which is deliberately isolated since #444).
    // Fail-soft: if the store is unreachable, the preview's own Clerk
    // validation surfaces a structured configuration error.
    let projectEnv: Record<string, string> = {};
    try {
      const broker = new SecretBroker();
      const secrets = await broker.resolveForSandbox(userId, projectId);
      projectEnv = extractClerkEnvFromSecrets(secrets);
    } catch {
      projectEnv = {};
    }

    const result = await startPreviewInternal(workspaceId, userId, {
      framework: project.framework ?? undefined,
      command: project.developmentCommand ?? undefined,
      packageManager: project.packageManager ?? undefined,
      projectEnv,
    });

    const previewUrl = result.status === "ready"
      ? buildPreviewProxyUrl(workspaceId)
      : null;

    await updateProjectRuntime(projectId, userId, {
      runtimeStatus: result.status,
      previewUrl,
      runtimeError: null,
    });

    return NextResponse.json({
      runtimeStatus: result.status,
      previewUrl,
      framework: result.framework,
      developmentCommand: result.command,
      port: result.port,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview start failed";
    const errorCode = (err as { code?: string }).code ?? extractEmbeddedErrorCode(message);
    await updateProjectRuntime(projectId, userId, {
      runtimeStatus: "failed",
      previewUrl: null,
      runtimeError: message,
    });

    return NextResponse.json({
      error: message,
      runtimeStatus: "failed",
      runtimeError: message,
      runtimeErrorCode: errorCode,
      // Same mapping as the provisioning branch above: the designed
      // host-execution refusal is a 503; other failures stay 500.
    }, { status: errorCode === HOST_EXECUTION_DISABLED_CODE ? 503 : 500 });
  }
}

/**
 * DELETE /api/studio-projects/[projectId]/preview
 * Stop the preview dev server.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  if (!project.workspaceId) {
    return NextResponse.json({ runtimeStatus: "stopped" });
  }

  try {
    await stopPreviewInternal(project.workspaceId, userId);
  } catch {
    // Best effort
  }

  await updateProjectRuntime(projectId, userId, {
    runtimeStatus: "stopped",
    previewUrl: null,
    runtimeError: null,
  });

  return NextResponse.json({ runtimeStatus: "stopped" });
}
