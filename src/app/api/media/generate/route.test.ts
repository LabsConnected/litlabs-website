// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests for the provider-error transport contract.
 *
 * Production bug (2026-09-18): /api/media/generate mapped PROVIDER_ERROR to
 * HTTP 502 and NO_PROVIDER to 503. Those are gateway statuses — the
 * Cloudflare/Railway edge interprets an app-emitted 5xx gateway code as
 * "origin unreachable" and substitutes its own branded HTML error page.
 * The structured { success:false, code, error } body never reached the
 * client (verified: edge 502 responses carried cf-ray but no
 * x-railway-request-id, i.e. the edge generated them).
 *
 * Contract under test: every handled failure code maps to a status the
 * edge forwards with the JSON body intact — never 502/503/504 — and the
 * response body remains the canonical structured error.
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: any) => handler,
}));

vi.mock("@/lib/generation/image-service", () => ({
  generateImage: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { generateImage } from "@/lib/generation/image-service";
import { POST } from "./route";

const GATEWAY_STATUSES = new Set([502, 503, 504]);

function req(body: Record<string, unknown>): NextRequest {
  return new NextRequest("https://www.litlabs.net/api/media/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function failure(code: string) {
  return {
    success: false,
    requestId: "req-1",
    providerId: "together",
    code,
    error: `${code} detail`,
    retryable: false,
    durationMs: 10,
  };
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ userId: "user_test" } as any);
});

describe("POST /api/media/generate — error transport contract", () => {
  it("provider auth/failure responses return structured JSON, never a gateway status", async () => {
    vi.mocked(generateImage).mockResolvedValue(failure("PROVIDER_ERROR") as any);
    const res = await POST(req({ prompt: "x", providerId: "together", requestId: "r1" }));
    expect(res.status).toBe(422);
    expect(GATEWAY_STATUSES.has(res.status)).toBe(false);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: "PROVIDER_ERROR", requestId: "req-1" });
  });

  it("provider rate-limit/quota responses map to 429 with structured JSON", async () => {
    vi.mocked(generateImage).mockResolvedValue(failure("QUOTA_EXCEEDED") as any);
    const res = await POST(req({ prompt: "x", requestId: "r2" }));
    expect(res.status).toBe(429);
    expect(GATEWAY_STATUSES.has(res.status)).toBe(false);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: "QUOTA_EXCEEDED" });
  });

  it("missing-provider responses also keep the structured body reachable", async () => {
    vi.mocked(generateImage).mockResolvedValue(failure("NO_PROVIDER") as any);
    const res = await POST(req({ prompt: "x", requestId: "r3" }));
    expect(GATEWAY_STATUSES.has(res.status)).toBe(false);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: "NO_PROVIDER" });
  });

  it("insufficient funds stays a structured 402 (pre-flight, no provider call)", async () => {
    vi.mocked(generateImage).mockResolvedValue(failure("INSUFFICIENT_FUNDS") as any);
    const res = await POST(req({ prompt: "x", requestId: "r4" }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: "INSUFFICIENT_FUNDS" });
  });

  it("success returns 200 with the generation payload", async () => {
    vi.mocked(generateImage).mockResolvedValue({
      success: true,
      requestId: "r5",
      providerId: "pollinations",
      downloadUrl: "data:image/png;base64,abc",
      cost: 0,
      free: true,
    } as any);
    const res = await POST(req({ prompt: "x", requestId: "r5" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, providerId: "pollinations" });
  });
});
