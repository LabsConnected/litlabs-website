import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/* ── Mocks ─────────────────────────────────────────────────────────── */

// Mock the generation service so tests never touch MiniMax or Supabase.
const processPendingGenerationsMock = vi.fn(async () => ({
  processed: 0,
  recovered: 0,
}));
vi.mock("@/lib/music/generation-service", () => ({
  processPendingGenerations: () => processPendingGenerationsMock(),
}));

function postRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/music/worker", {
    method: "POST",
    headers,
  });
}

function getRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/music/worker", {
    method: "GET",
    headers,
  });
}

describe("POST /api/music/worker authorization (fail-closed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("MUSIC_WORKER_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("denies when no secrets are configured (fail-closed)", async () => {
    // Both env vars empty → previously this returned true (open).
    // Security fix 2026-10-08: must deny.
    const { POST } = await import("./route");
    const res = await POST(postRequest());

    expect(res.status).toBe(401);
    expect(processPendingGenerationsMock).not.toHaveBeenCalled();
  });

  it("denies when secrets are unset entirely", async () => {
    vi.stubEnv("MUSIC_WORKER_SECRET", undefined as unknown as string);
    vi.stubEnv("CRON_SECRET", undefined as unknown as string);
    const { POST } = await import("./route");
    const res = await POST(postRequest());

    expect(res.status).toBe(401);
    expect(processPendingGenerationsMock).not.toHaveBeenCalled();
  });

  it("denies with wrong worker secret", async () => {
    vi.stubEnv("MUSIC_WORKER_SECRET", "correct-secret");
    const { POST } = await import("./route");
    const res = await POST(postRequest({ "x-worker-secret": "wrong-secret" }));

    expect(res.status).toBe(401);
    expect(processPendingGenerationsMock).not.toHaveBeenCalled();
  });

  it("denies with wrong bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "correct-cron");
    const { POST } = await import("./route");
    const res = await POST(
      postRequest({ authorization: "Bearer wrong-cron" }),
    );

    expect(res.status).toBe(401);
    expect(processPendingGenerationsMock).not.toHaveBeenCalled();
  });

  it("denies with no credentials when secrets are configured", async () => {
    vi.stubEnv("MUSIC_WORKER_SECRET", "correct-secret");
    vi.stubEnv("CRON_SECRET", "correct-cron");
    const { POST } = await import("./route");
    const res = await POST(postRequest());

    expect(res.status).toBe(401);
    expect(processPendingGenerationsMock).not.toHaveBeenCalled();
  });

  it("allows with valid x-worker-secret", async () => {
    vi.stubEnv("MUSIC_WORKER_SECRET", "correct-secret");
    const { POST } = await import("./route");
    const res = await POST(postRequest({ "x-worker-secret": "correct-secret" }));

    expect(res.status).toBe(200);
    expect(processPendingGenerationsMock).toHaveBeenCalledTimes(1);
  });

  it("allows with valid Bearer CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "correct-cron");
    const { POST } = await import("./route");
    const res = await POST(
      postRequest({ authorization: "Bearer correct-cron" }),
    );

    expect(res.status).toBe(200);
    expect(processPendingGenerationsMock).toHaveBeenCalledTimes(1);
  });

  it("allows with legacy x-vercel-cron-auth-token", async () => {
    vi.stubEnv("CRON_SECRET", "correct-cron");
    const { POST } = await import("./route");
    const res = await POST(
      postRequest({ "x-vercel-cron-auth-token": "correct-cron" }),
    );

    expect(res.status).toBe(200);
    expect(processPendingGenerationsMock).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/music/worker (removed)", () => {
  it("does not export a GET handler", async () => {
    // Security fix 2026-10-08: GET was removed — no legitimate caller uses it.
    const route = await import("./route");
    expect(route.GET).toBeUndefined();
    expect(route.POST).toBeDefined();
  });

  it("GET requests are not handled even with valid credentials", async () => {
    // Without a GET export, Next.js returns 405. Verify the handler
    // itself would still reject (defense in depth via the missing export).
    vi.stubEnv("MUSIC_WORKER_SECRET", "correct-secret");
    const route = await import("./route");
    expect(typeof route.GET).not.toBe("function");
    vi.unstubAllEnvs();
  });
});
