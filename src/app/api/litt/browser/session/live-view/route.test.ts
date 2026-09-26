// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Production-style wiring test for
 * GET /api/litt/browser/session/live-view.
 *
 * Pins the HTTP contract the Studio chat panel depends on:
 *  - 401 without a signed-in user
 *  - 400 without sessionId/conversationId
 *  - 404 for unknown or non-owned sessions (identical response)
 *  - 200 probe shape; the embedUrl capability URL is present ONLY
 *    when available=true, never leaked on the not-live path.
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: "user-owner" })),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: unknown) => handler,
}));

const liveViewMocks = vi.hoisted(() => ({
  getConversationLiveView: vi.fn(),
  getSessionLiveView: vi.fn(),
}));
vi.mock("@/lib/browser-session-live-view", () => liveViewMocks);

import { auth } from "@/lib/auth";
import { GET } from "./route";

const LIVE_INFO = {
  available: true,
  reason: "live",
  embedUrl: "https://debug.example/sess?fullscreen=1",
  openUrl: "https://dashboard.example/sess",
  sessionId: "sess-1",
  sessionStatus: "active",
  checkedAt: new Date().toISOString(),
};

const NOT_LIVE_INFO = {
  ...LIVE_INFO,
  available: false,
  reason: "session_closed",
  embedUrl: null,
};

function req(path: string) {
  return new NextRequest(`http://localhost:3000${path}`);
}

describe("GET /api/litt/browser/session/live-view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-owner" } as never);
    liveViewMocks.getConversationLiveView.mockResolvedValue(LIVE_INFO);
    liveViewMocks.getSessionLiveView.mockResolvedValue(LIVE_INFO);
  });

  it("returns 401 when not signed in", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await GET(req("/api/litt/browser/session/live-view?conversationId=c1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when neither sessionId nor conversationId is given", async () => {
    const res = await GET(req("/api/litt/browser/session/live-view"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown or non-owned session", async () => {
    liveViewMocks.getConversationLiveView.mockResolvedValue(null);
    const res = await GET(req("/api/litt/browser/session/live-view?conversationId=c1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Session not found");
  });

  it("returns the probe with embedUrl when the session is live", async () => {
    const res = await GET(req("/api/litt/browser/session/live-view?conversationId=c1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.reason).toBe("live");
    expect(body.embedUrl).toBe("https://debug.example/sess?fullscreen=1");
    expect(body.sessionId).toBe("sess-1");
    expect(body.checkedAt).toBeTruthy();
  });

  it("never leaks embedUrl when the session is not live", async () => {
    liveViewMocks.getConversationLiveView.mockResolvedValue(NOT_LIVE_INFO);
    const res = await GET(req("/api/litt/browser/session/live-view?conversationId=c1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.reason).toBe("session_closed");
    expect(body.embedUrl).toBeNull();
  });

  it("prefers sessionId when both params are given", async () => {
    const res = await GET(
      req("/api/litt/browser/session/live-view?conversationId=c1&sessionId=sess-9"),
    );
    expect(res.status).toBe(200);
    expect(liveViewMocks.getSessionLiveView).toHaveBeenCalledWith("sess-9", "user-owner");
    expect(liveViewMocks.getConversationLiveView).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the authenticated user", async () => {
    await GET(req("/api/litt/browser/session/live-view?conversationId=c1"));
    expect(liveViewMocks.getConversationLiveView).toHaveBeenCalledWith("c1", "user-owner");
  });
});
