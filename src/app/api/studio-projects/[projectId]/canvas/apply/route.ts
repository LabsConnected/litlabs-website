import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace, getProject } from "@/lib/projects/project-repository";
import { createWorkspaceTransport, type WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { terminalNotConfiguredResponse } from "@/lib/terminal-config";
import { ensureWorkspaceAlive, reprepareWorkspace } from "@/lib/studio/workspace-recovery";
import { logFileOperation } from "@/lib/file-audit";
import {
  CANVAS_DOC_PATH,
  ENTRY_FILE_PATH,
  CAS_ABSENT,
  classifyCanvasState,
  sha256Hex,
  injectCanvasMarker,
  stateAllowsAutoApply,
  type CanvasDocLike,
} from "@/lib/studio/canvas-ssot";
import { canvasToHtml } from "@/app/(app)/studio/components/canvas/builder/canvas-to-html";
import type { CanvasDocument } from "@/app/(app)/studio/components/canvas/builder/types";
import { readWorkspaceTextIfExists } from "@/lib/studio/canvas-publish-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ projectId: string }> };

/**
 * Canvas → index.html materialization — the ONLY write path that turns
 * canvas state into website files. Doing it server-side means the classify
 * read, the decision, and the compare-and-swap writes happen in a single
 * request with no client round-trips in between.
 *
 * GET  — classify current canvas/file state (read-only, for UI polling).
 * POST — body: { resolution?: "keep-files" | "apply-canvas",
 *                expectedCanvasSha?: string }
 *        No resolution: materialize when state is pending/unapplied/clean.
 *        "keep-files": mark the canvas doc superseded (files win).
 *        "apply-canvas": materialize even over a diverged index.html.
 */

async function verifiedTransport(
  projectId: string,
  userId: string,
): Promise<{ transport: WorkspaceTransport; workspaceId: string }> {
  let workspaceId: string;
  try {
    workspaceId = (await verifyProjectWorkspace(projectId, userId)).workspaceId;
  } catch (verifyErr) {
    const code = (verifyErr as { code?: string }).code;
    if (code === "WORKSPACE_NOT_PROVISIONED" || code === "WORKSPACE_NOT_READY") {
      const project = await getProject(projectId, userId);
      if (project?.workspaceId) {
        workspaceId = (await ensureWorkspaceAlive(projectId, userId, project.workspaceId)).workspaceId;
      } else {
        await reprepareWorkspace(projectId, userId);
        workspaceId = (await verifyProjectWorkspace(projectId, userId)).workspaceId;
      }
    } else {
      throw verifyErr;
    }
  }
  const transport = await createWorkspaceTransport(projectId, userId);
  return { transport, workspaceId };
}

function conflictResponse(state: string, detail: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: detail, code: "CANVAS_FILE_CONFLICT", state, ...extra },
    { status: 409 },
  );
}

function revisionConflict(err: unknown) {
  const e = err as { code?: string; currentSha256?: string | null };
  if (e?.code === "REVISION_CONFLICT") {
    return NextResponse.json(
      {
        error: "The file changed between the check and the write — retry.",
        code: "REVISION_CONFLICT",
        currentSha256: e.currentSha256 ?? null,
      },
      { status: 409 },
    );
  }
  return null;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const terminalUnavailable = terminalNotConfiguredResponse();
  if (terminalUnavailable) return terminalUnavailable;

  const { projectId } = await params;
  try {
    const { transport } = await verifiedTransport(projectId, userId);
    const [canvasRaw, indexRaw] = await Promise.all([
      readWorkspaceTextIfExists(transport, CANVAS_DOC_PATH),
      readWorkspaceTextIfExists(transport, ENTRY_FILE_PATH),
    ]);
    const result = await classifyCanvasState({ canvasRaw, indexRaw });
    return NextResponse.json({
      state: result.state,
      detail: result.detail,
      docHash: result.docHash,
      indexHash: result.indexHash,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to evaluate canvas state";
    const code = (err as { code?: string }).code;
    const status =
      code === "PROJECT_NOT_FOUND" ? 404 :
      code === "FORBIDDEN" ? 403 :
      code === "WORKSPACE_NOT_PROVISIONED" || code === "WORKSPACE_NOT_READY" ? 409 :
      500;
    return NextResponse.json({ error: msg, code: code ?? null }, { status });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const terminalUnavailable = terminalNotConfiguredResponse();
  if (terminalUnavailable) return terminalUnavailable;

  const { projectId } = await params;

  let body: { resolution?: "keep-files" | "apply-canvas"; expectedCanvasSha?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.resolution && body.resolution !== "keep-files" && body.resolution !== "apply-canvas") {
    return NextResponse.json({ error: "Invalid resolution" }, { status: 400 });
  }

  let transport: WorkspaceTransport;
  let workspaceId = "unknown";
  try {
    const verified = await verifiedTransport(projectId, userId);
    transport = verified.transport;
    workspaceId = verified.workspaceId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Workspace unavailable";
    const code = (err as { code?: string }).code;
    const status =
      code === "PROJECT_NOT_FOUND" ? 404 :
      code === "FORBIDDEN" ? 403 :
      code === "WORKSPACE_NOT_PROVISIONED" || code === "WORKSPACE_NOT_READY" ? 409 :
      503;
    return NextResponse.json({ error: msg, code: code ?? null }, { status });
  }

  // Read both sides of the truth.
  let canvasRaw: string | null;
  let indexRaw: string | null;
  try {
    [canvasRaw, indexRaw] = await Promise.all([
      readWorkspaceTextIfExists(transport, CANVAS_DOC_PATH),
      readWorkspaceTextIfExists(transport, ENTRY_FILE_PATH),
    ]);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Workspace read failed" },
      { status: 502 },
    );
  }

  // Stale-revision guard for the doc the caller based its decision on.
  if (body.expectedCanvasSha) {
    const currentSha = canvasRaw == null ? null : await sha256Hex(canvasRaw);
    if (currentSha !== body.expectedCanvasSha) {
      return NextResponse.json(
        { error: "canvas.json changed since the caller's revision", code: "REVISION_CONFLICT", currentSha256: currentSha },
        { status: 409 },
      );
    }
  }

  const result = await classifyCanvasState({ canvasRaw, indexRaw });
  const { state, doc, docHash } = result;

  // ── keep-files: the user keeps the workspace files; the canvas doc is
  // stamped superseded (preserved, dormant) via a CAS write so a concurrent
  // canvas save cannot race the resolution away. ──────────────────────────
  if (body.resolution === "keep-files") {
    if (!doc || !docHash) {
      return NextResponse.json({ error: "No canvas document to supersede" }, { status: 400 });
    }
    const superseded: CanvasDocLike = {
      ...doc,
      status: "superseded",
      supersededAt: Date.now(),
      supersededDocHash: docHash,
      supersededFileHash: result.indexHash,
    };
    try {
      await transport.writeFile(CANVAS_DOC_PATH, JSON.stringify(superseded), {
        expectedSha256: await sha256Hex(canvasRaw ?? ""),
      });
    } catch (err) {
      const rc = revisionConflict(err);
      if (rc) return rc;
      throw err;
    }
    await logFileOperation({
      userId, projectId, workspaceId,
      action: "write", path: CANVAS_DOC_PATH,
      contentLength: JSON.stringify(superseded).length,
      source: "user", ok: true,
    });
    return NextResponse.json({ state: "superseded", docHash });
  }

  // ── apply path ─────────────────────────────────────────────────────────
  if (state === "absent") {
    return NextResponse.json({ error: "No canvas document to apply", state }, { status: 400 });
  }
  if (state === "clean") {
    return NextResponse.json({ state: "clean", docHash, indexHash: result.indexHash });
  }
  if (state === "superseded" && body.resolution !== "apply-canvas") {
    return conflictResponse("superseded", "Canvas is superseded — apply explicitly to restore it.");
  }
  if (state === "conflict" && body.resolution !== "apply-canvas") {
    return conflictResponse("conflict", result.detail);
  }
  if (!stateAllowsAutoApply(state) && body.resolution !== "apply-canvas") {
    return conflictResponse(state, result.detail);
  }

  if (!doc || !docHash) {
    // e.g. apply-canvas on an unparseable canvas.json — nothing safe to emit.
    return NextResponse.json({ error: "No parseable canvas document to apply" }, { status: 400 });
  }

  // Materialize: generate index.html from the document, then record the
  // pairing inside canvas.json. Both writes are compare-and-swap:
  //   index.html expected = the bytes we classified (or absent)
  //   canvas.json expected = the bytes we classified
  // A mismatch on either fails closed — the leftover state re-classifies as
  // pending/conflict and is recoverable by applying again.
  const html = injectCanvasMarker(canvasToHtml(doc as unknown as CanvasDocument), docHash);
  const fileHash = await sha256Hex(html);

  try {
    await transport.writeFile(ENTRY_FILE_PATH, html, {
      expectedSha256: result.indexHash ?? CAS_ABSENT,
    });
  } catch (err) {
    const rc = revisionConflict(err);
    if (rc) return rc;
    const msg = err instanceof Error ? err.message : "Failed to write index.html";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  await logFileOperation({
    userId, projectId, workspaceId,
    action: "write", path: ENTRY_FILE_PATH,
    contentLength: html.length, source: "user", ok: true,
  });

  const recorded: CanvasDocLike = {
    ...doc,
    status: undefined,
    supersededAt: undefined,
    supersededDocHash: undefined,
    supersededFileHash: undefined,
    materialization: { docHash, fileHash, materializedAt: Date.now() },
  };
  try {
    await transport.writeFile(CANVAS_DOC_PATH, JSON.stringify(recorded), {
      expectedSha256: await sha256Hex(canvasRaw!),
    });
  } catch (err) {
    const rc = revisionConflict(err);
    // index.html was already regenerated; the canvas record write failing
    // leaves an honestly-detectable divergence (marker present, no record).
    if (rc) return rc;
    const msg = err instanceof Error ? err.message : "Failed to record materialization";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  await logFileOperation({
    userId, projectId, workspaceId,
    action: "write", path: CANVAS_DOC_PATH,
    contentLength: JSON.stringify(recorded).length, source: "user", ok: true,
  });

  return NextResponse.json({ state: "clean", docHash, indexHash: fileHash });
}
