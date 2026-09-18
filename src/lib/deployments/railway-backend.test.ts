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
});
