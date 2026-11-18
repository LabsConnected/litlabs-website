/**
 * Netlify deploy service — the second publish target for user projects.
 *
 * A sibling of deployUserProject (./deploy-service), deliberately shaped
 * the same way: same transport-identity authorization, same artifact
 * collection/validation/publish-gates pipeline, same content-hash
 * duplicate suppression, same deployment-record lifecycle, and the same
 * truth doctrine — `ready` is claimed only after the live URL is actually
 * fetched and answers. The differences are the target's nature:
 *
 * - The credential is the USER'S OWN Netlify token, resolved server-side
 *   from the caller's identity (a DeployDeps lookup). No credential →
 *   an honest connect-first failure BEFORE any deployment row exists,
 *   mirroring deployUserProject's hosting-unconfigured precedent.
 * - Files are published to Netlify, not stored as a snapshot here, so
 *   putFiles is never called (fileCount/totalBytes are still recorded).
 * - One Netlify site per project: resolved or created by deterministic
 *   name; the site id is recorded on the deployment row
 *   (externalSiteId) so re-deploys update the same site.
 * - Failures carry Netlify's own message — never a paraphrase that could
 *   hide what Netlify actually said.
 */

import {
  validateArtifact,
  describeDeploymentFailure,
  type DeploymentStatus,
} from "./user-deployment";
import { runPublishGates } from "../publish/publish-gates";
import {
  collectStaticArtifact,
  hashArtifact,
  waitForDeploymentResolved,
  type DeploymentRecord,
  type DeploymentStore,
  type DeployRequest,
  type DeployResult,
} from "./deploy-service";
import { NETLIFY_TARGET } from "./deploy-targets";
import {
  createNetlifyClient,
  resolveOrCreateSite,
  buildNetlifyFilesMap,
  artifactFileBytes,
  sha1Hex,
  NetlifyApiError,
  type NetlifyClient,
} from "./netlify-client";

export interface NetlifyDeployRequest extends Omit<DeployRequest, "hosting"> {
  /** Project display name, for the deterministic Netlify site name. */
  projectName?: string | null;
}

export interface NetlifyDeployDeps {
  store: DeploymentStore;
  /** Resolve the user's connected Netlify token. Null = not connected. */
  getToken: (userId: string) => Promise<{ token: string } | null>;
  /** Client factory (tests inject a mock-backed client). */
  createClient?: (token: string) => NetlifyClient;
  /** Verification fetches of the live URL. */
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  verifyAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function failure(
  deploymentId: string | null,
  errorClass: string,
  message: string,
  retryable: boolean,
): Extract<DeployResult, { ok: false }> {
  return {
    ok: false,
    deploymentId,
    status: "failed",
    publicUrl: null,
    errorClass,
    message,
    retryable,
  };
}

/** Map a Netlify API error onto the deployment failure vocabulary. */
function netlifyFailure(
  deploymentId: string | null,
  err: unknown,
): Extract<DeployResult, { ok: false }> {
  if (err instanceof NetlifyApiError) {
    if (err.status === 401 || err.status === 403) {
      return failure(
        deploymentId,
        "authorization",
        `Netlify rejected the connected token (HTTP ${err.status}): ${err.message}. Reconnect Netlify in Settings → Connections.`,
        false,
      );
    }
    if (err.status === 422 || err.status === 400 || err.status === 404) {
      return failure(deploymentId, "validation", `Netlify: ${err.message}`, false);
    }
    // 0 = network failure; 5xx = Netlify-side. Both may pass on retry.
    return failure(deploymentId, "transport", `Netlify: ${err.message}`, true);
  }
  const described = describeDeploymentFailure(err);
  return failure(
    deploymentId,
    described.errorClass,
    described.message,
    described.retryable,
  );
}

const TERMINAL_DEPLOY_STATES = new Set(["ready", "error"]);

export async function deployProjectToNetlify(
  request: NetlifyDeployRequest,
  deps: NetlifyDeployDeps,
): Promise<DeployResult> {
  const { store } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const { transport } = request;

  // ── Authorization: identical to deployUserProject ──
  const userId = (request.userId ?? "").trim();
  const projectId = (request.projectId ?? "").trim();

  if (!userId) {
    return failure(null, "authorization", "Forbidden: no authenticated user for deployment.", false);
  }
  if (!projectId) {
    return failure(null, "authorization", "Forbidden: no project specified for deployment.", false);
  }
  if (!transport?.userId || transport.userId !== userId) {
    return failure(null, "authorization", "Forbidden: deployment user does not own this workspace.", false);
  }
  if (!transport.projectId || transport.projectId !== projectId) {
    return failure(null, "authorization", "Forbidden: project mismatch between request and workspace.", false);
  }
  if (!transport.workspaceId) {
    return failure(null, "authorization", "Forbidden: workspace mismatch — no workspace bound to this project.", false);
  }

  // ── Credential: the user's own Netlify connection, or an honest stop ──
  // Fails BEFORE any deployment row exists, exactly like the LiTT path's
  // hosting-configuration check: there is no fake "deployed" state.
  let token: string;
  try {
    const credential = await deps.getToken(userId);
    if (!credential?.token) {
      return failure(
        null,
        "needs_connection",
        "Netlify is not connected for this account. Connect your Netlify account in Settings → Connections, then deploy again.",
        false,
      );
    }
    token = credential.token;
  } catch (err) {
    return netlifyFailure(null, err);
  }
  const clientFactory =
    deps.createClient ?? ((t: string) => createNetlifyClient({ token: t }));
  const client = clientFactory(token);

  // ── Build: collect and validate the artifact (shared pipeline) ──
  let artifact;
  try {
    artifact = await collectStaticArtifact(transport);
  } catch (err) {
    const described = describeDeploymentFailure(err);
    return failure(null, described.errorClass, described.message, described.retryable);
  }
  const validation = validateArtifact(artifact);
  if (!validation.ok) {
    return failure(null, "validation", validation.error, false);
  }

  // ── Publish gates: the same pre-publish choke point as LiTT ──
  const gateResult = await runPublishGates({
    files: validation.files,
    projectId,
    userId,
  });
  if (!gateResult.ok) {
    return failure(
      null,
      "validation",
      gateResult.message || "A pre-publish check failed. Please review your site content and try again.",
      false,
    );
  }

  const contentHash = hashArtifact(validation.files);

  // ── Duplicate suppression, scoped to THIS target ──
  // A ready LiTT deployment of identical content must never satisfy a
  // Netlify deploy — the record check filters on target.
  const existing = await store.findReadyByContentHash(projectId, contentHash);
  if (existing && existing.target === NETLIFY_TARGET && existing.publicUrl && existing.urlVerified) {
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
  const inFlight = await store.findInFlightByContentHash(projectId, contentHash);
  if (inFlight && inFlight.target === NETLIFY_TARGET) {
    const resolved = await waitForDeploymentResolved(store, inFlight.id, 120_000);
    if (resolved && resolved.status === "ready" && resolved.publicUrl && resolved.urlVerified) {
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

  // ── Resolve (or create) the project's Netlify site ──
  let site;
  try {
    site = await resolveOrCreateSite(client, request.projectName, projectId);
  } catch (err) {
    return netlifyFailure(null, err);
  }

  // ── Create the deployment record ──
  let record: DeploymentRecord;
  try {
    record = await store.create({
      userId,
      projectId,
      workspaceId: transport.workspaceId,
      status: "building",
      target: NETLIFY_TARGET,
      contentHash,
      externalSiteId: site.id,
    });
  } catch (err) {
    const described = describeDeploymentFailure(err);
    return failure(null, described.errorClass, described.message, described.retryable);
  }

  const markFailed = async (f: Extract<DeployResult, { ok: false }>) => {
    await store
      .update(record.id, {
        status: "failed",
        errorClass: f.errorClass,
        errorMessage: f.message,
        ...(f.publicUrl === null ? { publicUrl: null } : {}),
      })
      .catch(() => {
        // Best-effort status write — the returned result is still truthful.
      });
    return f;
  };

  try {
    // ── Digest deploy: create with the digest map, upload what's required ──
    const filesMap = buildNetlifyFilesMap(validation.files);
    const deploy = await client.createDeploy(site.id, filesMap);
    const required = new Set(deploy.required);
    if (required.size > 0) {
      for (const file of validation.files) {
        const bytes = artifactFileBytes(file);
        if (!required.has(sha1Hex(bytes))) continue;
        const path = file.path.startsWith("/") ? file.path : `/${file.path}`;
        await client.uploadDeployFile(deploy.id, path, bytes);
      }
    }

    await store.update(record.id, {
      status: "deploying",
      fileCount: validation.files.length,
      totalBytes: validation.totalBytes,
    });

    // ── Poll Netlify's real deploy state ──
    const pollTimeoutMs = deps.pollTimeoutMs ?? 120_000;
    const pollIntervalMs = deps.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + pollTimeoutMs;
    let latest = deploy;
    while (!TERMINAL_DEPLOY_STATES.has(latest.state)) {
      if (Date.now() >= deadline) {
        return await markFailed(
          failure(
            record.id,
            "transport",
            `Netlify deploy ${deploy.id} did not finish within ${Math.round(pollTimeoutMs / 1000)}s (last state: ${latest.state}). It may still complete on Netlify — check the site there before retrying.`,
            true,
          ),
        );
      }
      await sleep(pollIntervalMs);
      latest = await client.getDeploy(deploy.id);
    }

    if (latest.state === "error") {
      return await markFailed(
        failure(
          record.id,
          "transport",
          `Netlify deploy failed: ${latest.errorMessage ?? "Netlify reported an error without a message."}`,
          true,
        ),
      );
    }

    // ── Ready per Netlify — now verify the live URL before claiming it ──
    const publicUrl =
      latest.sslUrl ?? latest.deploySslUrl ?? site.sslUrl ?? site.url;
    if (!publicUrl) {
      return await markFailed(
        failure(record.id, "unknown", "Netlify reported the deploy ready but returned no URL.", false),
      );
    }

    const verifyAttempts = deps.verifyAttempts ?? 3;
    let verified = false;
    let lastVerifyError: unknown = null;
    for (let attempt = 0; attempt < verifyAttempts && !verified; attempt++) {
      if (attempt > 0) await sleep(1_500);
      try {
        const response = await fetchImpl(publicUrl, {
          method: "GET",
          redirect: "follow",
        });
        if (response.ok) {
          verified = true;
        } else {
          lastVerifyError = new Error(
            `Deployment verification failed: ${publicUrl} is not reachable (HTTP ${response.status}).`,
          );
        }
      } catch (err) {
        lastVerifyError = err;
      }
    }
    if (!verified) {
      const described = describeDeploymentFailure(
        lastVerifyError ?? new Error("Deployment verification failed."),
      );
      return await markFailed({
        ok: false,
        deploymentId: record.id,
        status: "failed",
        publicUrl: null,
        errorClass: "transport",
        message: described.message,
        retryable: true,
      });
    }

    await store.update(record.id, {
      status: "ready" as DeploymentStatus,
      publicUrl,
      urlVerified: true,
    });

    return {
      ok: true,
      deploymentId: record.id,
      status: "ready",
      publicUrl,
      urlVerified: true,
      target: NETLIFY_TARGET,
      projectId,
      workspaceId: transport.workspaceId,
      fileCount: validation.files.length,
      totalBytes: validation.totalBytes,
      reused: false,
    };
  } catch (err) {
    return await markFailed(netlifyFailure(record.id, err));
  }
}
