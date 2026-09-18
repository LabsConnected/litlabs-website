/**
 * Deployment orchestration for the LiTT launch flow.
 *
 * Railway is the deployment provider. There is no Vercel fallback: a
 * provider that is not configured is reported as unconfigured, never
 * silently substituted.
 *
 * Validates required credentials up front, triggers a Railway
 * deployment, polls for status, and verifies the production URL. All
 * failures surface the real cause — never a fake success message.
 */

import "server-only";

/** The deployment provider. Railway only — no fallbacks, no assumptions. */
export type DeployProvider = "railway";

export interface DeployEnvironmentConfig {
  provider: DeployProvider;
  token: string;
  /** Railway service ID. */
  projectId: string;
  /** Railway project ID (optional, for GraphQL context). */
  railwayProjectId?: string;
  /** Railway environment ID (optional). */
  environmentId?: string;
  /** The production URL to verify after deployment. */
  productionUrl?: string;
}

interface TriggerResult {
  id: string;
  status: string;
  url?: string;
}

export interface DeployResult {
  success: boolean;
  provider: DeployProvider;
  deploymentId?: string;
  status?: string;
  productionUrl?: string | null;
  error?: string;
  verification?: {
    url: string;
    success: boolean;
    detail: string;
  };
}

export interface DeployFlowOptions {
  config?: DeployEnvironmentConfig;
  productionUrl?: string;
  /** Polling configuration. */
  poll?: {
    intervalMs?: number;
    maxAttempts?: number;
  };
  signal?: AbortSignal;
  /** Override fetch for tests. */
  fetchFn?: typeof fetch;
}

const RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 36; // 6 minutes

/**
 * Resolve deployment configuration from environment variables.
 * Railway only. Returns a truthful error when Railway is not configured —
 * there is no fallback provider.
 */
export function resolveDeployConfig(
  env: Record<string, string | undefined> = process.env,
): { ok: true; config: DeployEnvironmentConfig } | { ok: false; error: string } {
  const railwayToken = env.RAILWAY_API_TOKEN;
  const railwayServiceId = env.RAILWAY_SERVICE_ID;
  const railwayEnvironmentId = env.RAILWAY_ENVIRONMENT_ID;

  if (railwayToken && railwayServiceId) {
    if (!railwayEnvironmentId) {
      return {
        ok: false,
        error:
          "Railway deployment is missing RAILWAY_ENVIRONMENT_ID. " +
          "Set RAILWAY_API_TOKEN, RAILWAY_SERVICE_ID, and RAILWAY_ENVIRONMENT_ID.",
      };
    }
    return {
      ok: true,
      config: {
        provider: "railway",
        token: railwayToken,
        projectId: railwayServiceId,
        railwayProjectId: env.RAILWAY_PROJECT_ID,
        environmentId: railwayEnvironmentId,
        productionUrl: env.DEPLOY_PRODUCTION_URL,
      },
    };
  }

  return {
    ok: false,
    error:
      "Railway deployment is not configured. " +
      "Set RAILWAY_API_TOKEN, RAILWAY_SERVICE_ID, and RAILWAY_ENVIRONMENT_ID.",
  };
}

function getFetch(fetchFn?: typeof fetch): typeof fetch {
  return fetchFn ?? fetch;
}

function redactToken(value: string): string {
  if (value.length <= 12) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error(`Cancelled: ${signal.reason ?? "deployment cancelled"}`);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Trigger a Railway deployment via the Railway GraphQL API.
 */
async function triggerRailwayDeployment(
  config: DeployEnvironmentConfig,
  fetchFn: typeof fetch,
): Promise<TriggerResult> {
  if (!config.environmentId) {
    throw new Error("Railway deployment requires environmentId in the deploy config");
  }

  const body = {
    query: `
      mutation DeployService($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
      }
    `,
    variables: { serviceId: config.projectId, environmentId: config.environmentId },
  };

  const resp = await fetchFn(RAILWAY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;

  if (!resp.ok) {
    const errors = Array.isArray(data.errors)
      ? (data.errors as { message?: string }[]).map((e) => e.message).join("; ")
      : "";
    throw new Error(`Railway deploy trigger failed (${resp.status}): ${errors || "Unknown error"}`);
  }

  const deploymentId = (data.data as Record<string, unknown> | undefined)?.serviceInstanceDeployV2 as
    | string
    | undefined;

  if (!deploymentId) {
    throw new Error("Railway deploy trigger did not return a deployment ID");
  }

  return { id: deploymentId, status: "QUEUED" };
}

/**
 * Poll Railway deployment status. Railway GraphQL is the source of truth.
 * Falls back to health verification if status polling cannot be parsed.
 */
async function pollRailwayDeployment(
  config: DeployEnvironmentConfig,
  deploymentId: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxAttempts = DEFAULT_MAX_POLL_ATTEMPTS,
): Promise<{ status: string; ok: boolean }> {
  const body = {
    query: `
      query DeploymentStatus($id: String!) {
        deployment(id: $id) {
          id
          status
        }
      }
    `,
    variables: { id: deploymentId },
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    checkSignal(signal);
    await sleep(pollIntervalMs);
    checkSignal(signal);

    const resp = await fetchFn(RAILWAY_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    const deployment = (data.data as Record<string, unknown> | undefined)?.deployment as
      | { id?: string; status?: string }
      | undefined;

    if (deployment?.status) {
      const status = deployment.status.toUpperCase();
      if (["SUCCESS", "LIVE", "COMPLETED"].includes(status)) {
        return { status, ok: true };
      }
      if (["FAILED", "CRASHED", "ERROR", "CANCELLED"].includes(status)) {
        return { status, ok: false };
      }
    }
  }

  return { status: "TIMEOUT", ok: false };
}

function deriveProductionUrl(config: DeployEnvironmentConfig, deploymentUrl?: string): string | undefined {
  if (deploymentUrl) {
    return deploymentUrl.startsWith("http") ? deploymentUrl : `https://${deploymentUrl}`;
  }
  if (config.productionUrl) {
    return config.productionUrl;
  }
  if (process.env.DEPLOY_PRODUCTION_URL) {
    return process.env.DEPLOY_PRODUCTION_URL;
  }
  return undefined;
}

export interface VerifyProductionUrlResult {
  success: boolean;
  detail: string;
  url: string;
}

/**
 * Verify the production URL by fetching it and optionally checking a
 * health endpoint.
 */
export async function verifyProductionUrl(
  url: string,
  options?: { expectedCommitSha?: string; fetchFn?: typeof fetch; timeoutMs?: number },
): Promise<VerifyProductionUrlResult> {
  const fetchFn = getFetch(options?.fetchFn);
  const timeoutMs = options?.timeoutMs ?? 30_000;

  async function tryFetch(target: string): Promise<{ ok: boolean; status: number; text: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("verification timeout"), timeoutMs);
    try {
      const resp = await fetchFn(target, { signal: controller.signal });
      const text = await resp.text().catch(() => "");
      return { ok: resp.ok, status: resp.status, text };
    } finally {
      clearTimeout(timeout);
    }
  }

  const candidates = [url];
  if (url.endsWith("/")) {
    candidates.push(`${url}api/health`);
  } else {
    candidates.push(`${url}/api/health`);
  }

  let lastResult: VerifyProductionUrlResult | null = null;
  for (const candidate of candidates) {
    try {
      const { ok, status, text } = await tryFetch(candidate);
      if (!ok) {
        lastResult = { success: false, detail: `GET ${candidate} returned HTTP ${status}`, url: candidate };
        continue;
      }

      if (options?.expectedCommitSha && !text.includes(options.expectedCommitSha)) {
        lastResult = {
          success: false,
          detail: `GET ${candidate} returned HTTP ${status} but the response did not contain the expected commit SHA`,
          url: candidate,
        };
        continue;
      }

      return { success: true, detail: `GET ${candidate} returned HTTP ${status}`, url: candidate };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastResult = { success: false, detail: `Could not reach ${candidate}: ${message}`, url: candidate };
    }
  }

  return lastResult ?? { success: false, detail: `Could not verify production URL ${url}`, url };
}

/**
 * Run the full deploy flow: trigger, poll, verify.
 */
export async function runDeployFlow(options: DeployFlowOptions = {}): Promise<DeployResult> {
  const envConfig = options.config ? { ok: true as const, config: options.config } : resolveDeployConfig();
  if (!envConfig.ok) {
    return {
      success: false,
      provider: "railway",
      error: envConfig.error,
    };
  }

  const config = envConfig.config;
  const fetchFn = getFetch(options.fetchFn);
  const signal = options.signal;
  const pollIntervalMs = options.poll?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = options.poll?.maxAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;

  try {
    checkSignal(signal);

    const triggered = await triggerRailwayDeployment(config, fetchFn);

    const pollResult = await pollRailwayDeployment(
      config,
      triggered.id,
      fetchFn,
      signal,
      pollIntervalMs,
      maxAttempts,
    );

    if (!pollResult.ok) {
      return {
        success: false,
        provider: config.provider,
        deploymentId: triggered.id,
        status: pollResult.status,
        error: `Deployment ${triggered.id} ended with status ${pollResult.status}`,
      };
    }

    const productionUrl = deriveProductionUrl(config, triggered.url);

    if (!productionUrl) {
      return {
        success: false,
        provider: config.provider,
        deploymentId: triggered.id,
        status: pollResult.status,
        error:
          "Deployment succeeded but no production URL is configured. " +
          "Set DEPLOY_PRODUCTION_URL to verify the result.",
      };
    }

    const verification = await verifyProductionUrl(productionUrl, { fetchFn });

    return {
      success: verification.success,
      provider: config.provider,
      deploymentId: triggered.id,
      status: pollResult.status,
      productionUrl,
      error: verification.success ? undefined : verification.detail,
      verification,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Never leak full tokens in error messages.
    const safe = message
      .split(config.token)
      .join(redactToken(config.token))
      .replace(/[a-f0-9]{32,}/gi, "<redacted-token-or-sha>");
    return {
      success: false,
      provider: config.provider,
      error: safe,
    };
  }
}
