// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isOwnerClerkId: vi.fn(),
  sweepIdleBrowserSessions: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/owner", () => ({ isOwnerClerkId: mocks.isOwnerClerkId }));
vi.mock("@/lib/litt-intelligence/browser-session-manager", () => ({
  sweepIdleBrowserSessions: mocks.sweepIdleBrowserSessions,
}));

import { GET, POST } from "./route";

const SECRET = "cron-secret-for-tests";
const savedSecret = process.env.CRON_SECRET;

const SWEEP_RESULT = {
  inspected: 3,
  expired: 1,
  closed: 1,
  localClosed: 0,
  dbClosed: 1,
  settledBits: 945,
  billingSettled: 1,
  providerCleanupFailed: 0,
  runtimeReconciled: 1,
  runtimeReconcileFailed: 0,
};

function request(method: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/litt/browser/sessions/sweep", {
    method,
    headers,
  });
}

describe("/api/litt/browser/sessions/sweep auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    mocks.auth.mockResolvedValue({ userId: null });
    mocks.isOwnerClerkId.mockReturnValue(false);
    mocks.sweepIdleBrowserSessions.mockResolvedValue(SWEEP_RESULT);
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedSecret;
  });

  it("rejects an unauthenticated non-owner caller", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(401);
    expect(mocks.sweepIdleBrowserSessions).not.toHaveBeenCalled();
  });

  it("rejects a wrong cron secret", async () => {
    const response = await POST(request("POST", { "x-cron-secret": "wrong-secret" }));
    expect(response.status).toBe(401);
    expect(mocks.sweepIdleBrowserSessions).not.toHaveBeenCalled();
  });

  it("accepts a valid x-cron-secret header", async () => {
    const response = await POST(request("POST", { "x-cron-secret": SECRET }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.sweepId).toMatch(/^sweep-/);
    expect(body.closed).toBe(1);
    expect(mocks.sweepIdleBrowserSessions).toHaveBeenCalledTimes(1);
  });

  it("accepts a valid Bearer secret", async () => {
    const response = await POST(request("POST", { authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);
    expect(mocks.sweepIdleBrowserSessions).toHaveBeenCalledTimes(1);
  });

  it("accepts the platform owner's Clerk session without a secret", async () => {
    mocks.auth.mockResolvedValue({ userId: "owner-clerk-id" });
    mocks.isOwnerClerkId.mockReturnValue(true);

    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect(mocks.isOwnerClerkId).toHaveBeenCalledWith("owner-clerk-id");
  });

  it("rejects a non-owner Clerk session without a secret", async () => {
    mocks.auth.mockResolvedValue({ userId: "regular-user" });
    mocks.isOwnerClerkId.mockReturnValue(false);

    const response = await POST(request("POST"));
    expect(response.status).toBe(401);
    expect(mocks.sweepIdleBrowserSessions).not.toHaveBeenCalled();
  });

  it("refuses everything when CRON_SECRET is unset and the caller is not the owner", async () => {
    delete process.env.CRON_SECRET;
    mocks.auth.mockResolvedValue({ userId: "regular-user" });
    mocks.isOwnerClerkId.mockReturnValue(false);

    const response = await POST(request("POST", { "x-cron-secret": SECRET }));
    expect(response.status).toBe(401);
    expect(mocks.sweepIdleBrowserSessions).not.toHaveBeenCalled();
  });

  it("supports GET for Vercel Cron with the same Bearer authorization", async () => {
    const response = await GET(request("GET", { authorization: `Bearer ${SECRET}` }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.sweepIdleBrowserSessions).toHaveBeenCalledTimes(1);
  });

  it("rejects GET without authorization too", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(401);
    expect(mocks.sweepIdleBrowserSessions).not.toHaveBeenCalled();
  });

  it("returns a safe failure with a correlation id when the sweep throws", async () => {
    mocks.sweepIdleBrowserSessions.mockRejectedValue(new Error("provider blew up: bb_key_abc123"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request("POST", { "x-cron-secret": SECRET }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("BROWSER_SESSION_SWEEP_FAILED");
    expect(body.sweepId).toMatch(/^sweep-/);
    expect(JSON.stringify(body)).not.toContain("bb_key_abc123");
    expect(errorSpy).toHaveBeenCalledWith(
      "[browser-session-sweep] failed",
      expect.objectContaining({ sweepId: expect.stringMatching(/^sweep-/) }),
    );
    errorSpy.mockRestore();
  });
});
