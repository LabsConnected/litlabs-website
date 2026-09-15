// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "crypto";

/**
 * Regression coverage for the Meta webhook's signature/token verification.
 *
 * The original comparisons used `===`/`!==` (non-constant-time string
 * compares) for both the hub.challenge verify-token check and the
 * x-hub-signature-256 HMAC check. Hardened to timingSafeEqual — this test
 * proves that hardening didn't change accept/reject behavior: valid
 * requests still succeed, and forged/tampered/replayed-with-wrong-secret
 * requests still fail.
 */

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      })),
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
  },
}));

import { GET, POST } from "./route";

const APP_SECRET = "meta-app-secret-for-testing";
const VERIFY_TOKEN = "meta-verify-token-for-testing";

function sign(payload: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

describe("meta-developer webhook — GET verify-token challenge", () => {
  const originalToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  beforeEach(() => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
  });

  afterEach(() => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = originalToken;
  });

  it("accepts a valid verify token and echoes the challenge", async () => {
    const req = new NextRequest(
      `http://localhost/api/webhooks/meta-developer?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`,
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toBe(12345);
  });

  it("rejects an invalid verify token", async () => {
    const req = new NextRequest(
      `http://localhost/api/webhooks/meta-developer?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=12345`,
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("rejects when hub.mode is not subscribe even with the correct token", async () => {
    const req = new NextRequest(
      `http://localhost/api/webhooks/meta-developer?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`,
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("500s when the verify token is not configured server-side", async () => {
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;
    const req = new NextRequest(
      `http://localhost/api/webhooks/meta-developer?hub.mode=subscribe&hub.verify_token=anything&hub.challenge=1`,
    );
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});

describe("meta-developer webhook — POST signature verification", () => {
  const originalSecret = process.env.META_APP_SECRET;

  beforeEach(() => {
    process.env.META_APP_SECRET = APP_SECRET;
  });

  afterEach(() => {
    process.env.META_APP_SECRET = originalSecret;
  });

  it("accepts a validly-signed request", async () => {
    const body = JSON.stringify({ entry: [] });
    const req = new NextRequest("http://localhost/api/webhooks/meta-developer", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(body, APP_SECRET) },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  it("rejects a forged signature (wrong secret)", async () => {
    const body = JSON.stringify({ entry: [] });
    const req = new NextRequest("http://localhost/api/webhooks/meta-developer", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(body, "attacker-guessed-secret") },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects a tampered payload replayed with the original signature", async () => {
    const originalBody = JSON.stringify({ entry: [] });
    const validSignature = sign(originalBody, APP_SECRET);
    const tamperedBody = JSON.stringify({ entry: [{ id: "attacker-injected" }] });

    const req = new NextRequest("http://localhost/api/webhooks/meta-developer", {
      method: "POST",
      headers: { "x-hub-signature-256": validSignature },
      body: tamperedBody,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects a request with no signature header", async () => {
    const req = new NextRequest("http://localhost/api/webhooks/meta-developer", {
      method: "POST",
      body: JSON.stringify({ entry: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("500s when the app secret is not configured server-side", async () => {
    delete process.env.META_APP_SECRET;
    const body = JSON.stringify({ entry: [] });
    const req = new NextRequest("http://localhost/api/webhooks/meta-developer", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(body, APP_SECRET) },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
