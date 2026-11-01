import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/* ── Mocks ─────────────────────────────────────────────────────────── */

vi.mock("@/lib/metrics", () => ({
  getMetrics: vi.fn(async () => "# HELP test_metric\n# TYPE test_metric counter\ntest_metric 1\n"),
}));

function getRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/metrics", {
    method: "GET",
    headers,
  });
}

describe("GET /metrics authorization (fail-closed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("METRICS_BEARER_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("denies when no token is configured (fail-closed)", async () => {
    // METRICS_BEARER_TOKEN empty → previously this endpoint was wide open.
    // Security fix 2026-10-08: must deny.
    const { GET } = await import("./route");
    const res = await GET(getRequest());

    expect(res.status).toBe(401);
  });

  it("denies when token is unset entirely", async () => {
    vi.stubEnv("METRICS_BEARER_TOKEN", undefined as unknown as string);
    const { GET } = await import("./route");
    const res = await GET(getRequest());

    expect(res.status).toBe(401);
  });

  it("denies with no Authorization header when token configured", async () => {
    vi.stubEnv("METRICS_BEARER_TOKEN", "secret-token");
    const { GET } = await import("./route");
    const res = await GET(getRequest());

    expect(res.status).toBe(401);
  });

  it("denies with wrong bearer token", async () => {
    vi.stubEnv("METRICS_BEARER_TOKEN", "secret-token");
    const { GET } = await import("./route");
    const res = await GET(getRequest({ authorization: "Bearer wrong-token" }));

    expect(res.status).toBe(401);
  });

  it("denies with malformed Authorization header", async () => {
    vi.stubEnv("METRICS_BEARER_TOKEN", "secret-token");
    const { GET } = await import("./route");
    const res = await GET(getRequest({ authorization: "secret-token" }));

    expect(res.status).toBe(401);
  });

  it("allows with valid bearer token", async () => {
    vi.stubEnv("METRICS_BEARER_TOKEN", "secret-token");
    const { GET } = await import("./route");
    const res = await GET(getRequest({ authorization: "Bearer secret-token" }));

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("test_metric");
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  it("is case-insensitive on the Bearer scheme", async () => {
    vi.stubEnv("METRICS_BEARER_TOKEN", "secret-token");
    const { GET } = await import("./route");
    const res = await GET(getRequest({ authorization: "bearer secret-token" }));

    expect(res.status).toBe(200);
  });
});
