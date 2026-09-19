/**
 * Agent Browser Phase 2 — GET /api/litt/browser/status truthfulness tests.
 *
 * The Studio status chip's honesty contract: this endpoint is the single
 * source the chip polls, so its states must pass through exactly as the
 * live check reports them — "live" only when the manager says live.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: unknown) => handler,
}));

vi.mock("@/lib/litt-intelligence/browser-session-manager", () => ({
  getLiveSessionStatus: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { getLiveSessionStatus } from "@/lib/litt-intelligence/browser-session-manager";
import { GET } from "./route";

const mockAuth = vi.mocked(auth);
const mockStatus = vi.mocked(getLiveSessionStatus);

function req(url: string) {
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "owner_clerk_123" } as never);
});

describe("GET /api/litt/browser/status", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null } as never);
    const res = await GET(req("http://localhost/api/litt/browser/status"));
    expect(res.status).toBe(401);
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it("passes through a live state with the session id", async () => {
    mockStatus.mockResolvedValue({
      state: "live",
      sessionId: "session-1",
      controller: "agent",
      sessionStatus: "active",
      lastActivityAt: new Date().toISOString(),
    });
    const res = await GET(
      req("http://localhost/api/litt/browser/status?conversationId=conv-1"),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.state).toBe("live");
    expect(json.sessionId).toBe("session-1");
    expect(mockStatus).toHaveBeenCalledWith("owner_clerk_123", "conv-1");
  });

  it("passes through idle and disconnected states unchanged", async () => {
    for (const state of ["idle", "disconnected"] as const) {
      mockStatus.mockResolvedValue({
        state,
        sessionId: state === "idle" ? "session-2" : null,
        controller: null,
        sessionStatus: state === "idle" ? "paused" : null,
        lastActivityAt: null,
      });
      const res = await GET(req("http://localhost/api/litt/browser/status"));
      const json = await res.json();
      expect(json.state).toBe(state);
    }
  });

  it("scopes the probe to the authenticated user only", async () => {
    mockStatus.mockResolvedValue({
      state: "disconnected",
      sessionId: null,
      controller: null,
      sessionStatus: null,
      lastActivityAt: null,
    });
    await GET(req("http://localhost/api/litt/browser/status"));
    expect(mockStatus).toHaveBeenCalledWith("owner_clerk_123", undefined);
  });

  it("returns 500 (not a fake state) when the probe throws", async () => {
    mockStatus.mockRejectedValue(new Error("boom"));
    const res = await GET(req("http://localhost/api/litt/browser/status"));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.state).toBeUndefined();
  });
});
