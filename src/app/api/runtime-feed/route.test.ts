import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  userId: "user-123" as string | null,
  snapshot: { phase: "ready", heartbeat: { lastHeartbeatAt: Date.now() } } as unknown,
  snapshotError: null as Error | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: mocks.userId })),
}));

vi.mock("@/lib/terminal-internal-client", () => ({
  getRuntimeSnapshotInternal: vi.fn(() => {
    if (mocks.snapshotError) return Promise.reject(mocks.snapshotError);
    return Promise.resolve(mocks.snapshot);
  }),
}));

import { GET } from "./route";

function makeRequest(): NextRequest {
  return new NextRequest("https://www.litlabs.net/api/runtime-feed");
}

describe("GET /api/runtime-feed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userId = "user-123";
    mocks.snapshotError = null;
    mocks.snapshot = {
      phase: "ready",
      heartbeat: { lastHeartbeatAt: Date.now() },
    } as unknown;
  });

  it("relays the terminal-server snapshot for a signed-in user", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot).toEqual(mocks.snapshot);
    expect(typeof body.relayedAt).toBe("string");
  });

  it("returns 401 when signed out", async () => {
    mocks.userId = null;
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("returns honest 503 TERMINAL_UNREACHABLE when the terminal server is down", async () => {
    mocks.snapshotError = new Error("fetch failed");
    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("TERMINAL_UNREACHABLE");
    // Never leak infra details to the client
    expect(JSON.stringify(body)).not.toContain("127.0.0.1");
    expect(JSON.stringify(body)).not.toContain("INTERNAL_SERVICE_KEY");
  });

  it("returns honest 503 TERMINAL_NOT_CONFIGURED when the internal key is missing", async () => {
    mocks.snapshotError = new Error("TERMINAL_INTERNAL_SERVICE_KEY not configured");
    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("TERMINAL_NOT_CONFIGURED");
  });
});
