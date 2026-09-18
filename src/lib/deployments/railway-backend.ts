/**
 * Railway infrastructure adapter behind LiTT Hosting.
 *
 * INTERNAL DETAIL — nothing outside src/lib/deployments may import this
 * module directly. Callers use getHostingBackend() from ./litt-hosting and
 * only ever see "LiTT Hosting". The provider name must never leak into UI
 * copy, API responses, or user-facing errors.
 *
 * How it works: user sites are served by LiTT's own hosting infrastructure
 * as static snapshots under /sites/<deploymentId>/. This adapter resolves
 * the real public base URL from the infrastructure itself — the service's
 * public domains, read live from the Railway GraphQL API — creating a
 * service domain when none exists. The deploy service then persists,
 * verifies (HTTP 2xx), and displays that URL.
 *
 * GraphQL shapes verified against the live API schema (2026-09-18):
 *   query serviceInstance(environmentId: String!, serviceId: String!)
 *   mutation serviceDomainCreate(input: { serviceId, environmentId })
 *   ServiceInstance.domains -> AllDomains.serviceDomains[] { domain, deletedAt }
 */

import type { HostingBackend, HostingConfigCheck } from "./litt-hosting";

const RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * User-safe: names no env vars and no provider. The deploy pipeline hands
 * this string to the model and the client when publishing cannot run.
 */
const UNCONFIGURED_REASON =
  "LiTT Hosting isn't set up on this workspace yet, so publishing is unavailable. " +
  "Ask your administrator to finish the hosting setup and try again.";

interface RailwayEnv {
  token?: string;
  serviceId?: string;
  environmentId?: string;
}

interface ServiceDomain {
  domain?: string | null;
  deletedAt?: string | null;
}

function readEnv(env: NodeJS.ProcessEnv): RailwayEnv {
  return {
    token: env.RAILWAY_API_TOKEN,
    serviceId: env.RAILWAY_SERVICE_ID,
    environmentId: env.RAILWAY_ENVIRONMENT_ID,
  };
}

function checkConfigured(railway: RailwayEnv): HostingConfigCheck {
  if (!railway.token || !railway.serviceId || !railway.environmentId) {
    return { ok: false, reason: UNCONFIGURED_REASON };
  }
  return { ok: true };
}

/** Error text safe to surface: Railway's message, never our credential. */
function railwayErrorMessage(status: number, body: unknown): string {
  const errors = (body as { errors?: Array<{ message?: string }> } | null)?.errors;
  const detail =
    Array.isArray(errors) && errors.length > 0
      ? errors
          .map((e) => e?.message)
          .filter(Boolean)
          .join("; ")
      : "";
  return `Hosting infrastructure request failed (HTTP ${status})${detail ? `: ${detail}` : ""}.`;
}

async function railwayGraphql<T>(
  railway: Required<RailwayEnv>,
  fetchImpl: typeof fetch,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("hosting backend timeout"), REQUEST_TIMEOUT_MS);
  try {
    // Railway sits behind Cloudflare, which can 403 non-browser user agents.
    const resp = await fetchImpl(RAILWAY_GRAPHQL_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${railway.token}`,
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await resp.json().catch(() => ({}))) as unknown;
    if (!resp.ok) {
      throw new Error(railwayErrorMessage(resp.status, body));
    }
    const errors = (body as { errors?: Array<{ message?: string }> } | null)?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const detail = errors
        .map((e) => e?.message)
        .filter(Boolean)
        .join("; ");
      throw new Error(`Hosting infrastructure error: ${detail || "unknown error"}.`);
    }
    return (body as { data: T }).data;
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(`Hosting infrastructure request failed: ${String(err)}.`);
  } finally {
    clearTimeout(timeout);
  }
}

const SERVICE_DOMAINS_QUERY = `
  query HostingServiceDomains($serviceId: String!, $environmentId: String!) {
    serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
      domains {
        serviceDomains {
          domain
          deletedAt
        }
      }
    }
  }
`;

const SERVICE_DOMAIN_CREATE_MUTATION = `
  mutation HostingServiceDomainCreate($serviceId: String!, $environmentId: String!) {
    serviceDomainCreate(input: { serviceId: $serviceId, environmentId: $environmentId }) {
      domain
    }
  }
`;

interface ServiceDomainsData {
  serviceInstance?: {
    domains?: {
      serviceDomains?: ServiceDomain[] | null;
    } | null;
  } | null;
}

interface ServiceDomainCreateData {
  serviceDomainCreate?: { domain?: string | null } | null;
}

async function resolveServiceDomain(
  railway: Required<RailwayEnv>,
  fetchImpl: typeof fetch,
): Promise<string> {
  const data = await railwayGraphql<ServiceDomainsData>(
    railway,
    fetchImpl,
    SERVICE_DOMAINS_QUERY,
    { serviceId: railway.serviceId, environmentId: railway.environmentId },
  );
  const domains = data?.serviceInstance?.domains?.serviceDomains ?? [];
  const live = domains.find((d) => d?.domain && !d.deletedAt);
  if (live?.domain) return live.domain;

  // No public domain on the service yet — create one. This is a
  // provider-side idempotent-ish step: Railway issues a fresh
  // <service>.up.railway.app style domain.
  const created = await railwayGraphql<ServiceDomainCreateData>(
    railway,
    fetchImpl,
    SERVICE_DOMAIN_CREATE_MUTATION,
    { serviceId: railway.serviceId, environmentId: railway.environmentId },
  );
  const domain = created?.serviceDomainCreate?.domain;
  if (!domain) {
    throw new Error(
      "Hosting infrastructure did not return a public domain for the service.",
    );
  }
  return domain;
}

/**
 * Create the Railway-backed HostingBackend.
 *
 * `env` and `fetchImpl` are injectable so tests can drive the adapter
 * without credentials or network. Production callers use the defaults.
 */
export function createRailwayHostingBackend(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): HostingBackend {
  const railway = readEnv(env);
  return {
    isConfigured() {
      return checkConfigured(railway);
    },
    async resolveBaseUrl() {
      const check = checkConfigured(railway);
      if (!check.ok) throw new Error(check.reason);
      const domain = await resolveServiceDomain(railway as Required<RailwayEnv>, fetchImpl);
      return `https://${domain}`;
    },
  };
}
