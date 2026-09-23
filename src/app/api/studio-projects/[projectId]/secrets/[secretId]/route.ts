import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { SecretBroker } from "@/lib/terminal-v1/secret-broker";
import { extractClerkEnvFromSecrets } from "@/lib/preview-clerk-env";
import { ensurePreviewEnvInternal } from "@/lib/terminal-internal-client";
import { rateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/studio-projects/[projectId]/secrets/[secretId]
 * Delete one project secret. The secret must belong to this user AND this
 * project — a secretId from another project is a 404, not a delete.
 * After deletion the running preview (if any) is nudged so a removed key
 * stops being injected; the nudge is fail-soft.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; secretId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, secretId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const rl = await rateLimit(request, 30, 3600);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many secret updates. Try again later." },
      { status: 429 },
    );
  }

  try {
    const broker = new SecretBroker();
    const meta = await broker.getById(secretId, userId);
    // Ownership + project scoping: never let one project's UI delete
    // another project's (or a user-scoped) secret.
    if (!meta || meta.projectId !== projectId) {
      return NextResponse.json({ error: "Secret not found" }, { status: 404 });
    }

    await broker.delete(secretId, userId);

    let previewRestarted = false;
    if (project.workspaceId) {
      try {
        const secrets = await broker.resolveForSandbox(userId, projectId);
        const projectEnv = extractClerkEnvFromSecrets(secrets);
        const result = await ensurePreviewEnvInternal(project.workspaceId, userId, projectEnv);
        previewRestarted = result.restarted === true;
      } catch {
        previewRestarted = false;
      }
    }

    return NextResponse.json({ deleted: true, previewRestarted });
  } catch {
    return NextResponse.json(
      { error: "Could not delete the secret. Try again." },
      { status: 500 },
    );
  }
}
