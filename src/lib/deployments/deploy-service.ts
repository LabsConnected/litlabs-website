/**
 * User-project deploy service.
 *
 * The one path by which a user's generated project becomes publicly
 * reachable. It collects the workspace's static output, persists it as an
 * immutable snapshot, publishes it on LiTT Hosting, and verifies the live
 * URL over HTTP before reporting success.
 *
 * The publishing model knows ONLY "LiTT Hosting" (deploy target
 * "litt-static"). The real public URL is resolved from the actual
 * infrastructure at publish time through the HostingBackend abstraction
 * (./litt-hosting) — never from caller input, never from a guess, and
 * never naming an infrastructure provider. Infrastructure can change
 * without touching this service.
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
 */

import { createHash, randomBytes } from "node:crypto";

import {
  validateArtifact,
  artifactBytes,
  contentTypeFor,
  isBinaryContentType,
  describeDeploymentFailure,
  isSafeArtifactPath,
  DEPLOYMENT_LIMITS,
  type ArtifactFile,
  type DeploymentStatus,
} from "./user-deployment";
import { runPublishGates } from "../publish/publish-gates";
import {
  HOSTING_TARGET,
  getHostingBackend,
  type HostingBackend,
} from "./litt-hosting";

/**
 * The only deployment target in V1 — LiTT Hosting's static tier.
 * Formalized here (not replaced): the publishing model targets LiTT
 * Hosting, and infrastructure stays behind the HostingBackend abstraction.
 * Never caller-selectable, and no provider/account/service input exists,
 * so this path cannot be pointed at anything but LiTT Hosting.
 */
export const DEPLOY_TARGET = HOSTING_TARGET;

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
  /**
   * Read a binary file, content returned base64-encoded. Optional: a
   * transport without it simply cannot ship binary assets — the artifact
   * validator then fails the deploy on the missing reference rather than
   * publishing a broken site.
   */
  readBinaryFile?(path: string): Promise<{ content: string; size: number }>;
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
  /**
   * Per-publish verification token. While the deployment is `deploying`,
   * the serving read answers only requests carrying this token, so the
   * deploy service can verify the live URL BEFORE the row is marked
   * ready. Optional — absent on records built before the column existed.
   */
  verificationToken?: string | null;
  /**
   * External provider's site identifier for non-LiTT targets (e.g. the
   * Netlify site id when target is "netlify"). Null for LiTT Hosting
   * deployments. Lets a re-deploy update the SAME external site instead
   * of creating a new one.
   */
  externalSiteId?: string | null;
  /** Row timestamps (Kimi wiring item 5: deployment history). Optional —
   *  absent on records built in memory before persistence. */
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface DeploymentCreateInput {
  userId: string;
  projectId: string;
  workspaceId: string;
  status: DeploymentStatus;
  target: string;
  contentHash?: string | null;
  externalSiteId?: string | null;
  verificationToken?: string | null;
}

export interface DeploymentStore {
  findReadyByContentHash(projectId: string, contentHash: string): Promise<DeploymentRecord | null>;
  /**
   * Newest deployment for this project+content still building/deploying.
   * Used to attach a concurrent duplicate deploy to the in-flight one
   * instead of publishing twice.
   */
  findInFlightByContentHash(projectId: string, contentHash: string): Promise<DeploymentRecord | null>;
  /**
   * Newest FAILED deployment for this project+content. Optional: stores
   * that implement it let a same-content retry REPAIR the failed row
   * instead of minting a second row for the same logical publish.
   */
  findFailedByContentHash?(projectId: string, contentHash: string): Promise<DeploymentRecord | null>;
  /**
   * Read one file of a deployment's stored snapshot through the same
   * gate the public serving route uses. Optional: when present, the
   * deploy service verifies the artifact reads back from storage (with
   * the verification token while `deploying`) before it verifies the
   * public URL. Stores without it get HTTP verification only.
   */
  readPublishedFile?(
    deploymentId: string,
    path: string,
    options?: { verificationToken?: string | null },
  ): Promise<{ content: string; contentType: string; encoding?: string | null } | null>;
  findById(id: string): Promise<DeploymentRecord | null>;
  create(input: DeploymentCreateInput): Promise<DeploymentRecord>;
  update(id: string, patch: Partial<DeploymentRecord>): Promise<DeploymentRecord>;
  putFiles(
    id: string,
    files: Array<{
      path: string;
      content: string;
      contentType: string;
      encoding: "utf-8" | "base64";
      bytes: number;
    }>,
  ): Promise<void>;
}

export interface DeployRequest {
  /** Authenticated user id. Must match the transport's owner. */
  userId: string;
  /** Project to deploy. Must match the transport's project. */
  projectId: string;
  /** Server-built, already-authorized workspace transport. */
  transport: DeploySourceTransport;
  /**
   * LiTT Hosting backend. Defaults to the canonical backend, which
   * resolves the live URL from the actual infrastructure. Tests inject a
   * fake. There is intentionally no base-URL input: the public URL is
   * never caller-supplied.
   */
  hosting?: HostingBackend;
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

      // Workspace transports disagree on the directory label ("directory"
      // vs "folder") — accept either or nested assets are silently dropped.
      if (entry.type === "directory" || entry.type === "folder") {
        queue.push(path);
        continue;
      }
      const contentType = contentTypeFor(path);
      if (contentType === "application/octet-stream") {
        // Not a known static web type — skip rather than publish opaque bytes.
        continue;
      }
      try {
        if (isBinaryContentType(contentType)) {
          if (!transport.readBinaryFile) continue;
          const { content } = await transport.readBinaryFile(path);
          collected.push({ path, content, encoding: "base64" });
        } else {
          const { content } = await transport.readFile(path);
          collected.push({ path, content });
        }
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
export function hashArtifact(files: ArtifactFile[]): string {
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

const deploySleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll a deployment row until it leaves building/deploying, or the timeout
 * elapses. Returns the latest observed record (possibly still in-flight, or
 * null when the row vanished).
 */
export async function waitForDeploymentResolved(
  store: DeploymentStore,
  deploymentId: string,
  timeoutMs: number,
): Promise<DeploymentRecord | null> {
  const deadline = Date.now() + timeoutMs;
  let latest: DeploymentRecord | null = null;
  for (;;) {
    try {
      latest = await store.findById(deploymentId);
    } catch {
      // A transient store error shouldn't abort the wait; keep polling.
    }
    if (!latest || (latest.status !== "building" && latest.status !== "deploying")) {
      return latest;
    }
    if (Date.now() >= deadline) return latest;
    await deploySleep(2_000);
  }
}

/** Header carrying the per-publish verification token to the serving route. */
export const DEPLOY_VERIFICATION_HEADER = "x-litt-deploy-verification";

// Bounded verification retries with backoff. The old flow verified with
// ONE fetch issued immediately after the status flip: any transient
// 404/503 — a file row or status not yet visible to the serving
// process — permanently failed a deployment whose artifact was fully
// stored (the six 2026-09-13 publishes). Six attempts over ~15 s ride
// out the propagation window; only a failure that outlives the whole
// window is recorded, classified temporary ("unavailable") or
// permanent according to what actually failed (see the classifier).
const VERIFY_DELAYS_MS = [500, 1000, 2000, 4000, 8000] as const;

// LITT_DEPLOY_VERIFY_DELAYS_MS (comma-separated ms) substitutes the
// ladder — for tests that must exercise the full retry path without
// sleeping for real seconds. Production uses the ladder above.
function verificationDelays(): readonly number[] {
  const raw = process.env.LITT_DEPLOY_VERIFY_DELAYS_MS;
  if (!raw) return VERIFY_DELAYS_MS;
  const parsed = raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length > 0 ? parsed : VERIFY_DELAYS_MS;
}

type VerificationOutcome =
  | { ok: true }
  | { ok: false; errorClass: string; message: string; retryable: boolean };

/**
 * Verify a `deploying` deployment is actually servable, with bounded
 * retries. Two phases per attempt:
 *
 *   1. Artifact read-back — the stored index.html must read back
 *      through the serving gate (token-authorized while `deploying`).
 *      This is the "actual artifact" half of verification: it proves
 *      the snapshot persisted, not just that some URL answers.
 *   2. Serving check — the public URL must answer 2xx to a request
 *      carrying the verification token. The serving route answers a
 *      `deploying` deployment ONLY to that token, so the deployment is
 *      never publicly servable as `ready` before it is verified, and
 *      the row flips to `ready` only after this returns ok.
 *
 * A store read that still finds no artifact on the FINAL attempt is a
 * permanent failure (the write did not land — class "validation",
 * not retryable, never "unknown"). Serving failures that outlive the
 * window keep their described class ("unavailable" for a URL that
 * never answered, transport for network errors) and stay retryable:
 * the artifact exists, so a later publish attempt can succeed — and
 * now repairs this same row instead of minting a second one.
 */
async function verifyDeploymentServing(args: {
  store: DeploymentStore;
  deploymentId: string;
  publicUrl: string;
  fetchImpl: typeof fetch;
  verificationToken: string;
}): Promise<VerificationOutcome> {
  const { store, deploymentId, publicUrl, fetchImpl, verificationToken } = args;
  const delays = verificationDelays();
  let lastFailure: VerificationOutcome & { ok: false } = {
    ok: false,
    errorClass: "unavailable",
    message: `Deployment verification failed: ${publicUrl} is not reachable.`,
    retryable: true,
  };

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await deploySleep(delays[attempt - 1]);

    // Phase 1 — artifact read-back (when the store supports it).
    if (store.readPublishedFile) {
      let stored: Awaited<ReturnType<NonNullable<DeploymentStore["readPublishedFile"]>>>;
      try {
        stored = await store.readPublishedFile(deploymentId, "index.html", { verificationToken });
      } catch (err) {
        const described = describeDeploymentFailure(err);
        lastFailure = { ok: false, ...described };
        continue;
      }
      if (!stored) {
        lastFailure = {
          ok: false,
          errorClass: "validation",
          message:
            "Deployment verification failed: the published files could not be read back " +
            "from storage, so the deployment cannot be served.",
          retryable: false,
        };
        continue;
      }
    }

    // Phase 2 — serving check over HTTP, token-gated.
    let response: Response;
    try {
      response = await fetchImpl(publicUrl, {
        method: "GET",
        redirect: "follow",
        headers: { [DEPLOY_VERIFICATION_HEADER]: verificationToken },
      });
    } catch (err) {
      const described = describeDeploymentFailure(err);
      lastFailure = { ok: false, ...described };
      continue;
    }
    if (response.ok) return { ok: true };

    const described = describeDeploymentFailure(
      new Error(
        `Deployment verification failed: ${publicUrl} is not reachable (HTTP ${response.status}).`,
      ),
    );
    lastFailure = { ok: false, ...described };
  }

  return lastFailure;
}

/**
 * Deploy the user's project and return a verified public URL.
 *
 * Ordering is deliberate, and each step exists because of a recorded
 * production failure:
 *
 *   1. Everything fallible that does not need the deployment row —
 *      hosting configuration, artifact validation, publish gates, and
 *      the hosting base-URL resolution (a live infrastructure call) —
 *      completes BEFORE any write. A resolution failure (the
 *      2026-11-04 "Not Authorized" publishes) therefore leaves no
 *      deployment row and no stored files behind, instead of a failed
 *      row claiming file_count 0 over files that were in fact stored.
 *   2. Files are stored and the row moves to `deploying` with its
 *      public URL and true file counts.
 *   3. The deployment is verified WHILE `deploying`: the serving route
 *      answers it only to this publish's verification token, so
 *      unverified content is never publicly servable as `ready`, and
 *      verification runs with bounded retries instead of one immediate
 *      fetch (the 2026-09-13 race).
 *   4. Only a verified deployment flips to `ready` (+ urlVerified).
 */
/**
 * Record a dedupe-reused publish as the project's newest publish
 * event by restamping the reused deployment's created_at.
 *
 * Every "current publish" surface — above all the stable project
 * address — follows the newest publish. A reused deployment gets no
 * new row, so without this restamp the republish leaves no trace:
 * publish A, publish B, unpublish B, then republish A's exact
 * contents returned success while the newest-publish rule kept
 * taking its orders from the unpublished B and the stable address
 * stayed dark (Greptile, PR #1106).
 */
async function recordRepublish(store: DeploymentStore, deploymentId: string): Promise<void> {
  await store.update(deploymentId, { createdAt: new Date().toISOString() });
}

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

  // ── Hosting: LiTT Hosting must be configured before any work happens ──
  // The live URL is resolved from the actual infrastructure at publish
  // time — never from caller input. When hosting is not configured this
  // fails here, honestly, before any deployment row exists: there is no
  // fake "deployed" state to report.
  const hosting = request.hosting ?? getHostingBackend();
  const hostingCheck = hosting.isConfigured();
  if (!hostingCheck.ok) {
    return failure(null, new Error(hostingCheck.reason));
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

  // ── Publish gates: the single pre-publish choke point ──
  // Fabricated content, and any future checks other workers register,
  // fail the deploy here — before any snapshot is created or published.
  const gateResult = await runPublishGates({
    files: validation.files,
    projectId,
    userId,
  });
  if (!gateResult.ok) {
    return {
      ok: false,
      deploymentId: null,
      status: "failed",
      publicUrl: null,
      errorClass: "validation",
      // gateResult.message is written for the user, not the engineer:
      // non-technical, and it names the section to fix.
      message: gateResult.message || "A pre-publish check failed. Please review your site content and try again.",
      retryable: false,
    };
  }

  const contentHash = hashArtifact(validation.files);

  // ── Duplicate suppression ──
  // Identical content already live for THIS project is reused rather than
  // republished, so a model that calls the tool twice cannot double-deploy.
  const existing = await store.findReadyByContentHash(projectId, contentHash);
  if (existing && existing.publicUrl && existing.urlVerified) {
    // If the republish cannot be recorded, fail honestly rather
    // than report a publish the stable address will not honor.
    try {
      await recordRepublish(store, existing.id);
    } catch (err) {
      return failure(null, err);
    }
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

  // ── In-flight duplicate suppression ──
  // The ready check above can't see a deploy that is still building, so two
  // concurrent deploys of identical content would both publish. Attach to
  // the in-flight one instead: wait (bounded) for it to resolve, then
  // return its outcome. If it fails or the wait times out, fall through
  // and deploy fresh.
  const inFlight = await store.findInFlightByContentHash(projectId, contentHash);
  if (inFlight) {
    const resolved = await waitForDeploymentResolved(store, inFlight.id, 120_000);
    if (resolved && resolved.status === "ready" && resolved.publicUrl && resolved.urlVerified) {
      try {
        await recordRepublish(store, resolved.id);
      } catch (err) {
        return failure(null, err);
      }
      return {
        ok: true,
        deploymentId: resolved.id,
        status: "ready",
        publicUrl: resolved.publicUrl,
        urlVerified: true,
        target: resolved.target,
        projectId: resolved.projectId,
        workspaceId: resolved.workspaceId,
        fileCount: resolved.fileCount,
        totalBytes: resolved.totalBytes,
        reused: true,
      };
    }
  }

  // ── Resolve the live URL BEFORE any write ──
  // The URL comes from the actual infrastructure (never caller input,
  // never a guess), and resolving it is a live infrastructure call that
  // can fail — on 2026-11-04 the provider answered "Not Authorized".
  // It used to run AFTER the files were stored but BEFORE the update
  // that sets fileCount/publicUrl, so its failure left stored files
  // under a failed row claiming file_count 0 and no URL. Resolved here
  // — after the dedupe reads, before the first write — its failure
  // leaves no deployment row and no stored files behind.
  let baseUrl: string;
  try {
    baseUrl = (await hosting.resolveBaseUrl()).replace(/\/+$/, "");
  } catch (err) {
    return failure(null, err);
  }

  // ── Failed-publish repair ──
  // A same-content retry after a FAILED publish is the same logical
  // publish: repair the failed row (fresh verification token, cleared
  // error, snapshot rewritten by putFiles below, restamped as the
  // newest publish event) instead of minting a second row. Skipped
  // when an in-flight deployment was found above and fell through —
  // that row is a concurrent attempt, and falling through to a fresh
  // deploy there is the established behavior. Only the owner's own
  // row is ever repaired, and only ever the newest failed one.
  const verificationToken = randomBytes(24).toString("base64url");
  let record: DeploymentRecord | null = null;
  let repairing = false;
  if (!inFlight && store.findFailedByContentHash) {
    let failedRow: DeploymentRecord | null = null;
    try {
      failedRow = await store.findFailedByContentHash(projectId, contentHash);
    } catch {
      // A lookup failure must not block the publish — fall through to
      // a fresh create, exactly as if no failed row existed.
    }
    if (failedRow && failedRow.userId === userId) {
      try {
        record = await store.update(failedRow.id, {
          status: "building",
          verificationToken,
          publicUrl: null,
          urlVerified: false,
          fileCount: 0,
          totalBytes: 0,
          errorClass: null,
          errorMessage: null,
          createdAt: new Date().toISOString(),
        });
        repairing = true;
      } catch {
        record = null;
      }
    }
  }

  // ── Create the deployment and store the snapshot ──
  if (!record) {
    try {
      record = await store.create({
        userId,
        projectId,
        workspaceId: transport.workspaceId,
        status: "building",
        target: DEPLOY_TARGET,
        contentHash,
        verificationToken,
      });
    } catch (err) {
      return failure(null, err);
    }
  }

  const publicUrl = `${baseUrl}/sites/${record.id}/`;

  try {
    await store.putFiles(
      record.id,
      validation.files.map((file) => ({
        path: file.path,
        content: file.content,
        contentType: contentTypeFor(file.path),
        encoding: file.encoding ?? "utf-8",
        bytes: artifactBytes(file),
      })),
    );

    await store.update(record.id, {
      status: "deploying",
      publicUrl,
      fileCount: validation.files.length,
      totalBytes: validation.totalBytes,
    });

    // ── Verify BEFORE the deployment is marked ready ──
    // The serving route answers this `deploying` deployment only to
    // the verification token, so the public URL is proven servable
    // (and the artifact proven readable from storage) while nothing
    // unverified is publicly live. Bounded retries ride out the
    // propagation window that killed the 2026-09-13 publishes.
    const verification = await verifyDeploymentServing({
      store,
      deploymentId: record.id,
      publicUrl,
      fetchImpl,
      verificationToken,
    });
    if (!verification.ok) {
      await store.update(record.id, {
        status: "failed",
        urlVerified: false,
        errorClass: verification.errorClass,
        errorMessage: verification.message,
      });
      return {
        ok: false,
        deploymentId: record.id,
        status: "failed",
        publicUrl: null,
        errorClass: verification.errorClass,
        message: verification.message,
        retryable: verification.retryable,
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
      reused: repairing,
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

export interface UnpublishRequest {
  userId: string;
  projectId: string;
  deploymentId: string;
}

export interface UnpublishResult {
  ok: boolean;
  deploymentId: string | null;
  message: string;
}

/**
 * Unpublish a deployment — take a published site offline.
 *
 * Ownership is enforced: the caller must own the deployment's project.
 * Only `ready` deployments can be unpublished (transition ready → unpublished).
 * The serving route (`/sites/[deploymentId]`) only serves `ready` rows, so
 * flipping the status immediately stops public access. Files are retained
 * in the store for audit/history; republishing creates a new deployment.
 *
 * No subprocesses. No infrastructure calls. Pure database state change.
 */
export async function unpublishDeployment(
  request: UnpublishRequest,
  deps: DeployDeps,
): Promise<UnpublishResult> {
  const { store } = deps;
  const userId = (request.userId ?? "").trim();
  const projectId = (request.projectId ?? "").trim();
  const deploymentId = (request.deploymentId ?? "").trim();

  if (!userId) {
    return { ok: false, deploymentId: null, message: "Forbidden: no authenticated user." };
  }
  if (!projectId || !deploymentId) {
    return { ok: false, deploymentId: null, message: "Deployment not specified." };
  }

  let record: DeploymentRecord | null;
  try {
    record = await store.findById(deploymentId);
  } catch {
    return { ok: false, deploymentId: null, message: "Deployment lookup failed." };
  }
  if (!record) {
    return { ok: false, deploymentId: null, message: "Deployment not found." };
  }
  if (record.userId !== userId) {
    return { ok: false, deploymentId, message: "Forbidden: you do not own this deployment." };
  }
  if (record.projectId !== projectId) {
    return { ok: false, deploymentId, message: "Forbidden: project mismatch." };
  }
  if (record.status !== "ready") {
    return {
      ok: false,
      deploymentId,
      message: `Only live deployments can be unpublished (current status: ${record.status}).`,
    };
  }

  try {
    await store.update(deploymentId, { status: "unpublished" });
  } catch (err) {
    return {
      ok: false,
      deploymentId,
      message: `Failed to unpublish: ${err instanceof Error ? err.message : "storage error"}.`,
    };
  }

  return { ok: true, deploymentId, message: "Deployment unpublished. The public URL no longer serves content." };
}
