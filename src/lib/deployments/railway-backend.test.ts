import { describe, it, expect, vi } from "vitest";

import { createRailwayHostingBackend } from "./railway-backend";

/**
 * Railway infrastructure adapter — the detail behind LiTT Hosting.
 *
 * The adapter resolves the real public base URL from the infrastructure
 * (service domains via the Railway GraphQL API). Failures surface the
 * real infrastructure error; credentials never leak into messages.
 */

const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  RAILWAY_API_TOKEN: "test-token",
  RAILWAY_SERVICE_ID: "svc_123",
  RAILWAY_ENVIRONMENT_ID: "env_123",
  // Force the GraphQL path in these tests — ambient public-URL env vars
  // (real on a deployed service) would otherwise take precedence.
  DEPLOY_PRODUCTION_URL: undefined,
  RAILWAY_PUBLIC_DOMAIN: undefined,
  NEXT_PUBLIC_SITE_URL: undefined,
};

function gqlResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), { status: 200 });
}

function domainsFetch(domain: string | null) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { query: string };
    if (body.query.includes("HostingServiceDomains")) {
      return gqlResponse({
        serviceInstance: {
          domains: {
            serviceDomains: domain ? [{ domain, deletedAt: null }] : [],
          },
        },
      });
    }
    if (body.query.includes("HostingServiceDomainCreate")) {
      return gqlResponse({ serviceDomainCreate: { domain: "new-service.up.railway.app" } });
    }
    throw new Error(`unexpected query: ${body.query.slice(0, 60)}`);
  });
}

describe("railway hosting backend", () => {
  describe("isConfigured", () => {
    it("reports unconfigured when credentials are missing", () => {
      const backend = createRailwayHostingBackend({} as unknown as NodeJS.ProcessEnv, vi.fn());
      const check = backend.isConfigured();
      expect(check.ok).toBe(false);
      if (!check.ok) {
        // User-safe: no env var names, no provider name.
        expect(check.reason).toContain("LiTT Hosting");
        expect(check.reason).not.toMatch(/RAILWAY_|railway|vercel/i);
      }
    });

    it("reports configured when all credentials are present", () => {
      const backend = createRailwayHostingBackend(ENV, vi.fn());
      expect(backend.isConfigured()).toEqual({ ok: true });
    });
  });

  describe("resolveBaseUrl", () => {
    it("resolves the live service domain from the infrastructure", async () => {
      const fetchImpl = domainsFetch("my-service.up.railway.app");
      const backend = createRailwayHostingBackend(ENV, fetchImpl as unknown as typeof fetch);
      await expect(backend.resolveBaseUrl()).resolves.toBe("https://my-service.up.railway.app");
      // The request carried auth and the right variables — but never the
      // token in a loggable place here.
      const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-token");
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body.variables).toEqual({ serviceId: "svc_123", environmentId: "env_123" });
    });

    it("creates a service domain when none exists", async () => {
      const fetchImpl = domainsFetch(null);
      const backend = createRailwayHostingBackend(ENV, fetchImpl as unknown as typeof fetch);
      await expect(backend.resolveBaseUrl()).resolves.toBe("https://new-service.up.railway.app");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("throws the real infrastructure error when the API fails", async () => {
      const fetchImpl = vi.fn(async () =>
        new Response(JSON.stringify({ errors: [{ message: "service not found" }] }), { status: 200 }),
      );
      const backend = createRailwayHostingBackend(ENV, fetchImpl as unknown as typeof fetch);
      await expect(backend.resolveBaseUrl()).rejects.toThrow("service not found");
    });

    it("throws a truthful error on HTTP failure", async () => {
      const fetchImpl = vi.fn(async () => new Response("bad gateway", { status: 502 }));
      const backend = createRailwayHostingBackend(ENV, fetchImpl as unknown as typeof fetch);
      await expect(backend.resolveBaseUrl()).rejects.toThrow("HTTP 502");
    });

    it("throws the user-safe reason when unconfigured", async () => {
      const backend = createRailwayHostingBackend({} as unknown as NodeJS.ProcessEnv, vi.fn());
      await expect(backend.resolveBaseUrl()).rejects.toThrow("LiTT Hosting isn't set up");
    });

    it("never leaks the credential into error text", async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error("network down");
      });
      const backend = createRailwayHostingBackend(ENV, fetchImpl as unknown as typeof fetch);
      try {
        await backend.resolveBaseUrl();
        expect.unreachable();
      } catch (err) {
        expect(String(err)).not.toContain("test-token");
      }
    });
  });

  describe("server-resolved public-URL env", () => {
    const NO_CREDS = {
      DEPLOY_PRODUCTION_URL: undefined,
      RAILWAY_PUBLIC_DOMAIN: undefined,
      NEXT_PUBLIC_SITE_URL: undefined,
    } as unknown as NodeJS.ProcessEnv;

    it("is configured from DEPLOY_PRODUCTION_URL alone — no Railway credentials needed", async () => {
      const fetchImpl = vi.fn();
      const backend = createRailwayHostingBackend(
        { ...NO_CREDS, DEPLOY_PRODUCTION_URL: "https://www.litlabs.net" } as NodeJS.ProcessEnv,
        fetchImpl as unknown as typeof fetch,
      );
      expect(backend.isConfigured()).toEqual({ ok: true });
      await expect(backend.resolveBaseUrl()).resolves.toBe("https://www.litlabs.net");
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("uses the env URL even when Railway credentials are also set", async () => {
      const fetchImpl = domainsFetch("my-service.up.railway.app");
      const backend = createRailwayHostingBackend(
        { ...ENV, DEPLOY_PRODUCTION_URL: "https://www.litlabs.net" } as NodeJS.ProcessEnv,
        fetchImpl as unknown as typeof fetch,
      );
      await expect(backend.resolveBaseUrl()).resolves.toBe("https://www.litlabs.net");
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("falls back to RAILWAY_PUBLIC_DOMAIN (bare host gets https) when DEPLOY_PRODUCTION_URL is absent", async () => {
      const backend = createRailwayHostingBackend(
        { ...NO_CREDS, RAILWAY_PUBLIC_DOMAIN: "app.litlabs.net" } as NodeJS.ProcessEnv,
        vi.fn() as unknown as typeof fetch,
      );
      await expect(backend.resolveBaseUrl()).resolves.toBe("https://app.litlabs.net");
    });

    it("falls back to NEXT_PUBLIC_SITE_URL when neither deploy var is set", async () => {
      const backend = createRailwayHostingBackend(
        { ...NO_CREDS, NEXT_PUBLIC_SITE_URL: "https://www.litlabs.net" } as NodeJS.ProcessEnv,
        vi.fn() as unknown as typeof fetch,
      );
      await expect(backend.resolveBaseUrl()).resolves.toBe("https://www.litlabs.net");
    });

    it("normalizes the URL to its origin (trailing path and slash dropped)", async () => {
      const backend = createRailwayHostingBackend(
        { ...NO_CREDS, DEPLOY_PRODUCTION_URL: "https://www.litlabs.net/some/path/" } as NodeJS.ProcessEnv,
        vi.fn() as unknown as typeof fetch,
      );
      await expect(backend.resolveBaseUrl()).resolves.toBe("https://www.litlabs.net");
    });

    it("skips malformed values and non-http schemes, falling through to the next candidate", async () => {
      const backend = createRailwayHostingBackend(
        {
          ...NO_CREDS,
          DEPLOY_PRODUCTION_URL: "not a url at all ::",
          RAILWAY_PUBLIC_DOMAIN: "javascript:alert(1)",
          NEXT_PUBLIC_SITE_URL: "https://fallback.litlabs.net",
        } as NodeJS.ProcessEnv,
        vi.fn() as unknown as typeof fetch,
      );
      await expect(backend.resolveBaseUrl()).resolves.toBe("https://fallback.litlabs.net");
    });

    it("still reports unconfigured with no credentials and no env URL", async () => {
      const backend = createRailwayHostingBackend(NO_CREDS, vi.fn() as unknown as typeof fetch);
      const check = backend.isConfigured();
      expect(check.ok).toBe(false);
      if (!check.ok) {
        expect(check.reason).toContain("LiTT Hosting");
        expect(check.reason).not.toMatch(/RAILWAY_|railway|vercel/i);
      }
      await expect(backend.resolveBaseUrl()).rejects.toThrow("LiTT Hosting isn't set up");
    });
  });
});
