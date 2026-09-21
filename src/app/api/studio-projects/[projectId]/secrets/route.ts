import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { SecretBroker } from "@/lib/terminal-v1/secret-broker";
import { extractClerkEnvFromSecrets } from "@/lib/preview-clerk-env";
import { ensurePreviewEnvInternal } from "@/lib/terminal-internal-client";
import { rateLimit } from "@/lib/rate-limiter";
import {
  validateSecretInput,
  fingerprintSecretValue,
  maskFingerprint,
  MAX_SECRETS_PER_PROJECT,
} from "@/lib/project-secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Nudge the running preview (if any) to pick up the new secret set.
 * The terminal server restarts the preview ONLY when the resolved Clerk
 * env actually changed — a no-op save never disrupts a running dev server.
 * Fail-soft: secrets are saved regardless; the preview's own start path
 * re-resolves them on the next restart.
 */
async function nudgePreviewEnv(
  projectId: string,
  userId: string,
  workspaceId: string | null | undefined,
): Promise<boolean> {
  if (!workspaceId) return false;
  try {
    const broker = new SecretBroker();
    const secrets = await broker.resolveForSandbox(userId, projectId);
    const projectEnv = extractClerkEnvFromSecrets(secrets);
    const result = await ensurePreviewEnvInternal(workspaceId, userId, projectEnv);
    return result.restarted === true;
  } catch {
    return false;
  }
}

/**
 * GET /api/studio-projects/[projectId]/secrets
 * List this project's secrets — metadata only (name, fingerprint,
 * updated-at). Values are NEVER returned.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const broker = new SecretBroker();
    const metas = await broker.listProjectSecrets(userId, projectId);
    const secrets = await Promise.all(
      metas.map(async (m) => {
        // Fingerprint lets the UI show "set ••••a1b2" and detect rotation
        // without the value ever leaving the server.
        const value = await broker.decryptValue(m.secretId, userId).catch(() => null);
        return {
          secretId: m.secretId,
          name: m.name,
          updatedAt: m.updatedAt,
          fingerprint: value ? maskFingerprint(fingerprintSecretValue(value)) : null,
        };
      }),
    );
    return NextResponse.json({ secrets });
  } catch {
    // Never leak internals (or values) in the error surface.
    return NextResponse.json(
      { error: "Could not load project secrets. Try again." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/studio-projects/[projectId]/secrets
 * Create or replace a project secret. Body: { name, value, description? }.
 * Values are encrypted at rest (AES-256-GCM) and never echoed back.
 * Rate-limited: 30 writes/hour per caller.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const rl = await rateLimit(request, 30, 3600);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many secret updates. Try again later." },
      { status: 429 },
    );
  }

  let body: { name?: unknown; value?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateSecretInput(body.name, body.value);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const description =
    typeof body.description === "string" ? body.description.slice(0, 280) : undefined;

  try {
    const broker = new SecretBroker();

    const existing = await broker.listProjectSecrets(userId, projectId);
    const isNew = !existing.some((m) => m.name === validated.name);
    if (isNew && existing.length >= MAX_SECRETS_PER_PROJECT) {
      return NextResponse.json(
        { error: `Too many secrets (max ${MAX_SECRETS_PER_PROJECT} per project).` },
        { status: 400 },
      );
    }

    const meta = await broker.upsertProjectSecret({
      userId,
      projectId,
      name: validated.name,
      value: validated.value,
      description,
    });

    const previewRestarted = await nudgePreviewEnv(projectId, userId, project.workspaceId);

    return NextResponse.json({
      secret: {
        secretId: meta.secretId,
        name: meta.name,
        updatedAt: meta.updatedAt,
        fingerprint: maskFingerprint(fingerprintSecretValue(validated.value)),
      },
      previewRestarted,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not save the secret. Try again." },
      { status: 500 },
    );
  }
}
