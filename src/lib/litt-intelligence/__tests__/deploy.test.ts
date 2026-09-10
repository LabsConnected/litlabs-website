import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runDeployFlow, resolveDeployConfig, verifyProductionUrl } from "@/lib/litt-intelligence/deploy";

describe("Deploy: resolveDeployConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("missing configuration fails closed", () => {
    delete process.env.RAILWAY_API_TOKEN;
    delete process.env.RAILWAY_SERVICE_ID;
    delete process.env.RAILWAY_ENVIRONMENT_ID;
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_PROJECT_ID;

    const result = resolveDeployConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Deployment is not configured");
    }
  });

  it("prefers Railway when both Railway and Vercel envs are present", () => {
    process.env.RAILWAY_API_TOKEN = "railway-token";
    process.env.RAILWAY_SERVICE_ID = "svc-1";
    process.env.RAILWAY_ENVIRONMENT_ID = "env-1";
    process.env.VERCEL_TOKEN = "vercel-token";
    process.env.VERCEL_PROJECT_ID = "prj-1";

    const result = resolveDeployConfig();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.provider).toBe("railway");
      expect(result.config.token).toBe("railway-token");
      expect(result.config.projectId).toBe("svc-1");
      expect(result.config.environmentId).toBe("env-1");
    }
  });

  it("falls back to Vercel when Railway is not configured", () => {
    delete process.env.RAILWAY_API_TOKEN;
    delete process.env.RAILWAY_SERVICE_ID;
    process.env.VERCEL_TOKEN = "vercel-token";
    process.env.VERCEL_PROJECT_ID = "prj-1";

    const result = resolveDeployConfig();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.provider).toBe("vercel");
      expect(result.config.token).toBe("vercel-token");
      expect(result.config.projectId).toBe("prj-1");
    }
  });

  it("fails closed when Railway environment id is missing", () => {
    process.env.RAILWAY_API_TOKEN = "railway-token";
    process.env.RAILWAY_SERVICE_ID = "svc-1";
    delete process.env.RAILWAY_ENVIRONMENT_ID;

    const result = resolveDeployConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("RAILWAY_ENVIRONMENT_ID");
    }
  });
});

describe("Deploy: runDeployFlow", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("missing configuration fails closed", async () => {
    delete process.env.RAILWAY_API_TOKEN;
    delete process.env.RAILWAY_SERVICE_ID;
    delete process.env.RAILWAY_ENVIRONMENT_ID;
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_PROJECT_ID;

    const result = await runDeployFlow();
    expect(result.success).toBe(false);
    expect(result.error).toContain("Deployment is not configured");
  });

  it("Railway successful deploy and verify", async () => {
    process.env.RAILWAY_API_TOKEN = "test-token";
    process.env.RAILWAY_SERVICE_ID = "svc-123";
    process.env.RAILWAY_ENVIRONMENT_ID = "env-123";
    process.env.DEPLOY_PRODUCTION_URL = "https://example.litlabs.net";

    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { serviceInstanceDeployV2: "dep-1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { deployment: { id: "dep-1", status: "SUCCESS" } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "ok",
      });

    const result = await runDeployFlow({ fetchFn, poll: { intervalMs: 10, maxAttempts: 2 } });

    expect(result.success).toBe(true);
    expect(result.deploymentId).toBe("dep-1");
    expect(result.productionUrl).toBe("https://example.litlabs.net");
    expect(result.verification?.success).toBe(true);
  });

  it("Railway failed deploy", async () => {
    process.env.RAILWAY_API_TOKEN = "test-token";
    process.env.RAILWAY_SERVICE_ID = "svc-123";
    process.env.RAILWAY_ENVIRONMENT_ID = "env-123";

    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { serviceInstanceDeployV2: "dep-2" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { deployment: { id: "dep-2", status: "FAILED" } } }),
      });

    const result = await runDeployFlow({ fetchFn, poll: { intervalMs: 10, maxAttempts: 2 } });

    expect(result.success).toBe(false);
    expect(result.error).toContain("dep-2");
    expect(result.error).toContain("FAILED");
  });

  it("Vercel successful deploy", async () => {
    process.env.VERCEL_TOKEN = "test-token";
    process.env.VERCEL_PROJECT_ID = "prj-123";
    process.env.DEPLOY_PRODUCTION_URL = "https://example.vercel.app";

    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "dep-v1", url: "https://example.vercel.app", state: "READY" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: "READY" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "ok",
      });

    const result = await runDeployFlow({ fetchFn, poll: { intervalMs: 10, maxAttempts: 1 } });

    expect(result.success).toBe(true);
    expect(result.deploymentId).toBe("dep-v1");
    expect(result.productionUrl).toBe("https://example.vercel.app");
  });

  it("Vercel failed deploy", async () => {
    process.env.VERCEL_TOKEN = "test-token";
    process.env.VERCEL_PROJECT_ID = "prj-123";

    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: "Unauthorized" } }),
    });

    const result = await runDeployFlow({ fetchFn });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unauthorized");
  });

  it("token never appears in returned errors", async () => {
    process.env.VERCEL_TOKEN = "supersecret-token-xyz";
    process.env.VERCEL_PROJECT_ID = "prj-123";

    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "supersecret-token-xyz is invalid" } }),
    });

    const result = await runDeployFlow({ fetchFn });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain("supersecret-token-xyz");
    expect(result.error).toMatch(/\.\.\./);
  });

  it("timeout", async () => {
    process.env.RAILWAY_API_TOKEN = "test-token";
    process.env.RAILWAY_SERVICE_ID = "svc-123";
    process.env.RAILWAY_ENVIRONMENT_ID = "env-123";

    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { serviceInstanceDeployV2: "dep-t" } }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { deployment: { id: "dep-t", status: "PENDING" } } }),
      });

    const result = await runDeployFlow({ fetchFn, poll: { intervalMs: 10, maxAttempts: 3 } });

    expect(result.success).toBe(false);
    expect(result.error).toContain("TIMEOUT");
  });

  it("cancelled deployment", async () => {
    process.env.RAILWAY_API_TOKEN = "test-token";
    process.env.RAILWAY_SERVICE_ID = "svc-123";
    process.env.RAILWAY_ENVIRONMENT_ID = "env-123";

    const controller = new AbortController();
    controller.abort("stop");

    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    const result = await runDeployFlow({ fetchFn, signal: controller.signal });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cancelled");
  });

  it("deployment succeeds but no production URL", async () => {
    process.env.RAILWAY_API_TOKEN = "test-token";
    process.env.RAILWAY_SERVICE_ID = "svc-123";
    process.env.RAILWAY_ENVIRONMENT_ID = "env-123";

    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { serviceInstanceDeployV2: "dep-3" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { deployment: { id: "dep-3", status: "SUCCESS" } } }),
      });

    const result = await runDeployFlow({ fetchFn, poll: { intervalMs: 10, maxAttempts: 2 } });

    expect(result.success).toBe(false);
    expect(result.error).toContain("no production URL");
  });
});

describe("Deploy: verifyProductionUrl", () => {
  it("production URL verification succeeds", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "ok" });
    const result = await verifyProductionUrl("https://example.litlabs.net", { fetchFn, timeoutMs: 100 });

    expect(result.success).toBe(true);
    expect(result.detail).toContain("HTTP 200");
  });

  it("production URL verification fails on non-2xx", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "error" });
    const result = await verifyProductionUrl("https://example.litlabs.net", { fetchFn, timeoutMs: 100 });

    expect(result.success).toBe(false);
    expect(result.detail).toContain("HTTP 500");
  });

  it("production URL verification falls back to /api/health", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "not found" })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "ok" });

    const result = await verifyProductionUrl("https://example.litlabs.net", { fetchFn, timeoutMs: 100 });

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://example.litlabs.net/api/health");
  });

  it("production URL verification fails when every candidate fails", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "down" });
    const result = await verifyProductionUrl("https://example.litlabs.net/", { fetchFn, timeoutMs: 100 });

    expect(result.success).toBe(false);
    expect(result.detail).toContain("HTTP 503");
  });
});
