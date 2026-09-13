/**
 * User-project deploy service.
 *
 * The one path by which a user's generated project becomes publicly
 * reachable. It collects the workspace's static output, persists it as an
 * immutable snapshot, publishes it at a public URL, and verifies that URL
 * over HTTP before reporting success.
 *
 * Authorization model — nothing here is taken from the model:
 *
 *   the agent tool passes the WorkspaceTransport it was given, which was
 *   built by createWorkspaceTransport(projectId, userId) →
 *   verifyProjectWorkspace() (project exists, project.userId === userId,
 *   workspace provisioned + ready). The transport's userId / projectId /
 *   workspaceId are readonly and server-resolved.
 *
 *   This service then re-checks that the requested userId and projectId
 *   match the transport's own, so a mismatch is refused rather than
 *   silently deploying the wrong thing.
 *
 * The deployment target is fixed server-side ("litt-static"). There is no
 * provider, account, or service input, so this path cannot be pointed at
 * LiTT's own Railway service — the admin-only /api/deploy/trigger remains
 * the only way to do that, and the agent cannot reach it.
 */

import { createHash } from "node:crypto";

import {
  validateArtifact,
  contentTypeFor,
  describeDeploymentFailure,
  isSafeArtifactPath,
  DEPLOYMENT_LIMITS,
  type ArtifactFile,
  type DeploymentStatus,
} from "./user-deployment";

/** The only deployment target in V1. Never caller-selectable. */
export const DEPLOY_TARGET = "litt-static" as const;

/**
 * The workspace capabilities this service needs.
 *
 * Structurally satisfied by WorkspaceTransport. Declared narrowly so the
 * service can be tested without the server-only transport module.
 */
export interface DeploySourceTransport {
  readonly userId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  listFiles(path: string): Promise<{ entries: Array<{ name: string; type: string }> }>;
  readFile(path: string): Promise<{ content: string; size: number }>;
}

export interface DeploymentRecord {
  id: string;
  userId: string;
  projectId: string;
  workspaceId: string;
  status: DeploymentStatus;
  target: string;
  publicUrl: string | null;
  urlVerified: boolean;
  fileCount: number;
  totalBytes: number;
  contentHash: string | null;
  errorClass: string | null;
  errorMessage: string | null;
}

export interface DeploymentCreateInput {
  userId: string;
  projectId: string;
  workspaceId: string;
  status: DeploymentStatus;
  target: string;
  contentHash?: string | null;
}

export interface DeploymentStore {
  findReadyByContentHash(projectId: string, contentHash: string): Promise<DeploymentRecord | null>;
  create(input: DeploymentCreateInput): Promise<DeploymentRecord>;
  update(id: string, patch: Partial<DeploymentRecord>): Promise<DeploymentRecord>;
  putFiles(
    id: string,
    files: Array<{ path: string; content: string; contentType: string; bytes: number }>,
  ): Promise<void>;
}

export interface DeployRequest {
  /** Authenticated user id. Must match the transport's owner. */
  userId: string;
  /** Project to deploy. Must match the transport's project. */
  projectId: string;
  /** Server-built, already-authorized workspace transport. */
  transport: DeploySourceTransport;
  /** Origin the published site will be served from. */
  publicBaseUrl: string;
}

export interface DeployDeps {
  store: DeploymentStore;
  fetchImpl?: typeof fetch;
}

export type DeployResult =
  | {
      ok: true;
      deploymentId: string;
      status: "ready";
      publicUrl: string;
      urlVerified: true;
      target: string;
      projectId: string;
      workspaceId: string;
      fileCount: number;
      totalBytes: number;
      /** True when an identical deployment already existed and was reused. */
      reused: boolean;
    }
  | {
      ok: false;
      deploymentId: string | null;
      status: "failed";
      publicUrl: null;
      errorClass: string;
      message: string;
      retryable: boolean;
    };

/** Directories and files that must never be published. */
const EXCLUDED_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".vercel",
  ".turbo",
  "coverage",
  ".cache",
]);

/**
 * Collect the workspace's publishable static files.
 *
 * Walks from the workspace root, skipping build/dependency directories and
 * anything `isSafeArtifactPath` rejects (which excludes dotfiles, so a
 * workspace `.env` can never be published).
 */
export async function collectStaticArtifact(
  transport: DeploySourceTransport,
  maxFiles: number = DEPLOYMENT_LIMITS.maxFiles,
): Promise<ArtifactFile[]> {
  const collected: ArtifactFile[] = [];
  const queue: string[] = ["."];

  while (queue.length > 0 && collected.length < maxFiles) {
    const dir = queue.shift()!;
    let entries: Array<{ name: string; type: string }>;
    try {
      ({ entries } = await transport.listFiles(dir));
    } catch {
      // An unreadable directory is skipped rather than failing the deploy;
      // validateArtifact still refuses to publish an artifact with no
      // index.html, so this cannot silently produce a broken "success".
      continue;
    }

    for (const entry of entries) {
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      const path = dir === "." ? entry.name : `${dir}/${entry.name}`;
      if (!isSafeArtifactPath(path)) continue;

      if (entry.type === "directory") {
        queue.push(path);
        continue;
      }
      if (contentTypeFor(path) === "application/octet-stream") {
        // Not a known static web type — skip rather than publish opaque bytes.
        continue;
      }
      try {
        const { content } = await transport.readFile(path);
        collected.push({ path, content });
      } catch {
        // Unreadable file — skip; validation decides whether the result is
        // still publishable.
      }
      if (collected.length >= maxFiles) break;
    }
  }

  return collected;
}

/** Stable content identity for duplicate suppression. */
function hashArtifact(files: ArtifactFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update("\u0000");
    hash.update(file.content);
    hash.update("\u0000");
  }
  return hash.digest("hex");
}

function failure(
  deploymentId: string | null,
  error: unknown,
): Extract<DeployResult, { ok: false }> {
  const described = describeDeploymentFailure(error);
  return {
    ok: false,
    deploymentId,
    status: "failed",
    publicUrl: null,
    errorClass: described.errorClass,
    message: described.message,
    retryable: described.retryable,
  };
}

/**
 * Deploy the user's project and return a verified public URL.
 *
 * Ordering is deliberate: the public URL is fetched BEFORE the deployment is
 * marked ready, so "ready" always means the site actually served.
 */
export async function deployUserProject(
  request: DeployRequest,
  deps: DeployDeps,
): Promise<DeployResult> {
  const { store } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { transport } = request;

  // ── Authorization: the caller must own the transport it passed ──
  const userId = (request.userId ?? "").trim();
  const projectId = (request.projectId ?? "").trim();

  if (!userId) {
    return failure(null, new Error("Forbidden: no authenticated user for deployment."));
  }
  if (!projectId) {
    return failure(null, new Error("Forbidden: no project specified for deployment."));
  }
  if (!transport?.userId || transport.userId !== userId) {
    return failure(null, new Error("Forbidden: deployment user does not own this workspace."));
  }
  if (!transport.projectId || transport.projectId !== projectId) {
    return failure(null, new Error("Forbidden: project mismatch between request and workspace."));
  }
  if (!transport.workspaceId) {
    return failure(null, new Error("Forbidden: workspace mismatch — no workspace bound to this project."));
  }

  // ── Build: collect and validate the artifact ──
  let artifact: ArtifactFile[];
  try {
    artifact = await collectStaticArtifact(transport);
  } catch (err) {
    return failure(null, err);
  }

  const validation = validateArtifact(artifact);
  if (!validation.ok) {
    // Nothing is created or published for an invalid artifact.
    return failure(null, new Error(validation.error));
  }

  const contentHash = hashArtifact(validation.files);

  // ── Duplicate suppression ──
  // Identical content already live for THIS project is reused rather than
  // republished, so a model that calls the tool twice cannot double-deploy.
  const existing = await store.findReadyByContentHash(projectId, contentHash);
  if (existing && existing.publicUrl && existing.urlVerified) {
    return {
      ok: true,
      deploymentId: existing.id,
      status: "ready",
      publicUrl: existing.publicUrl,
      urlVerified: true,
      target: existing.target,
      projectId: existing.projectId,
      workspaceId: existing.workspaceId,
      fileCount: existing.fileCount,
      totalBytes: existing.totalBytes,
      reused: true,
    };
  }

  // ── Create the deployment and store the snapshot ──
  let record: DeploymentRecord;
  try {
    record = await store.create({
      userId,
      projectId,
      workspaceId: transport.workspaceId,
      status: "building",
      target: DEPLOY_TARGET,
      contentHash,
    });
  } catch (err) {
    return failure(null, err);
  }

  try {
    await store.putFiles(
      record.id,
      validation.files.map((file) => ({
        path: file.path,
        content: file.content,
        contentType: contentTypeFor(file.path),
        bytes: Buffer.byteLength(file.content, "utf8"),
      })),
    );

    const publicUrl = buildPublicUrl(request.publicBaseUrl, record.id);

    await store.update(record.id, {
      status: "deploying",
      publicUrl,
      fileCount: validation.files.length,
      totalBytes: validation.totalBytes,
    });

    // ── Verify the live URL before claiming success ──
    let response: Response;
    try {
      response = await fetchImpl(publicUrl, { method: "GET", redirect: "follow" });
    } catch (err) {
      await store.update(record.id, {
        status: "failed",
        urlVerified: false,
        errorClass: "transport",
        errorMessage: describeDeploymentFailure(err).message,
      });
      return failure(record.id, err);
    }

    if (!response.ok) {
      const err = new Error(
        `Deployment verification failed: ${publicUrl} is not reachable (HTTP ${response.status}).`,
      );
      const described = describeDeploymentFailure(err);
      await store.update(record.id, {
        status: "failed",
        urlVerified: false,
        errorClass: described.errorClass,
        errorMessage: described.message,
      });
      return {
        ok: false,
        deploymentId: record.id,
        status: "failed",
        publicUrl: null,
        errorClass: described.errorClass,
        message: described.message,
        // A 5xx may pass on retry; a 4xx will not.
        retryable: response.status >= 500,
      };
    }

    await store.update(record.id, { status: "ready", urlVerified: true });

    return {
      ok: true,
      deploymentId: record.id,
      status: "ready",
      publicUrl,
      urlVerified: true,
      target: DEPLOY_TARGET,
      projectId,
      workspaceId: transport.workspaceId,
      fileCount: validation.files.length,
      totalBytes: validation.totalBytes,
      reused: false,
    };
  } catch (err) {
    const described = describeDeploymentFailure(err);
    await store
      .update(record.id, {
        status: "failed",
        errorClass: described.errorClass,
        errorMessage: described.message,
      })
      .catch(() => {
        // Best-effort status write — the returned result is still truthful.
      });
    return failure(record.id, err);
  }
}

/** The public URL a deployment is served at. */
export function buildPublicUrl(baseUrl: string, deploymentId: string): string {
  const base = (baseUrl || "").replace(/\/+$/, "");
  return `${base}/sites/${deploymentId}/`;
}
