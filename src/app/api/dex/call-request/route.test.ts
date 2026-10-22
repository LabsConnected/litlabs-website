import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

const ORIGINAL_SECRET = process.env.DEX_BRIDGE_SECRET;
const ORIGINAL_STAGING_FLAG = process.env.DEX_STAGING_REPO_ENABLED;

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function makeBody(overrides: Partial<Record<string, unknown>> = {}, requestId: string) {
  return JSON.stringify({
    phone: "+15551234567",
    requestedBy: "dex",
    estimatedCostCents: 0,
    requestId,
    timestamp: Date.now(),
    ...overrides,
  });
}

let idCounter = 0;
function freshRequestId(): string {
  idCounter += 1;
  return `test-req-${idCounter}-${Date.now()}`;
}

describe("POST /api/dex/call-request", () => {
  beforeEach(() => {
    process.env.DEX_BRIDGE_SECRET = "a".repeat(32);
    delete process.env.DEX_STAGING_REPO_ENABLED;
  });

  afterEach(() => {
    process.env.DEX_BRIDGE_SECRET = ORIGINAL_SECRET;
    process.env.DEX_STAGING_REPO_ENABLED = ORIGINAL_STAGING_FLAG;
  });

  it("rejects a request with a bad signature", async () => {
    const { POST } = await import("./route");
    const body = makeBody({}, freshRequestId());
    const req = new Request("http://localhost/api/dex/call-request", {
      method: "POST",
      body,
      headers: { "x-dex-signature": "wrong" },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("rejects a request with no signature header at all", async () => {
    const { POST } = await import("./route");
    const body = makeBody({}, freshRequestId());
    const req = new Request("http://localhost/api/dex/call-request", { method: "POST", body });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("rejects a correctly-signed request if DEX_BRIDGE_SECRET is misconfigured (too short)", async () => {
    process.env.DEX_BRIDGE_SECRET = "too-short";
    const { POST } = await import("./route");
    const body = makeBody({}, freshRequestId());
    const sig = sign(body, "too-short");
    const req = new Request("http://localhost/api/dex/call-request", {
      method: "POST",
      body,
      headers: { "x-dex-signature": sig },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("rejects a signature computed with a different secret (tampered/forged request)", async () => {
    const { POST } = await import("./route");
    const body = makeBody({}, freshRequestId());
    const sig = sign(body, "b".repeat(32)); // wrong secret
    const req = new Request("http://localhost/api/dex/call-request", {
      method: "POST",
      body,
      headers: { "x-dex-signature": sig },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("rejects a well-signed body missing requestId/timestamp with 400, not a silent pass", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({ phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 0 });
    const sig = sign(body, process.env.DEX_BRIDGE_SECRET!);
    const req = new Request("http://localhost/api/dex/call-request", {
      method: "POST",
      body,
      headers: { "x-dex-signature": sig },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("rejects a stale timestamp even with a valid signature", async () => {
    const { POST } = await import("./route");
    const body = makeBody({ timestamp: Date.now() - 10 * 60 * 1000 }, freshRequestId());
    const sig = sign(body, process.env.DEX_BRIDGE_SECRET!);
    const req = new Request("http://localhost/api/dex/call-request", {
      method: "POST",
      body,
      headers: { "x-dex-signature": sig },
    });
    const res = await POST(req as never);
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.reason).toBe("stale_timestamp");
  });

  it("rejects a replayed request: same requestId accepted once, rejected the second time", async () => {
    const { POST } = await import("./route");
    const requestId = freshRequestId();
    const body = makeBody({}, requestId);
    const sig = sign(body, process.env.DEX_BRIDGE_SECRET!);

    const req1 = new Request("http://localhost/api/dex/call-request", {
      method: "POST",
      body,
      headers: { "x-dex-signature": sig },
    });
    const res1 = await POST(req1 as never);
    expect(res1.status).toBe(403); // kill switch denies it, but it WAS processed once

    const req2 = new Request("http://localhost/api/dex/call-request", {
      method: "POST",
      body,
      headers: { "x-dex-signature": sig },
    });
    const res2 = await POST(req2 as never);
    const json2 = await res2.json();
    expect(res2.status).toBe(401);
    expect(json2.reason).toBe("replayed_request_id");
  });

  it("denies when the kill switch is engaged (default state, no repo override)", async () => {
    const { POST } = await import("./route");
    const body = makeBody({}, freshRequestId());
    const sig = sign(body, process.env.DEX_BRIDGE_SECRET!);
    const req = new Request("http://localhost/api/dex/call-request", {
      method: "POST",
      body,
      headers: { "x-dex-signature": sig },
    });
    const res = await POST(req as never);
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.allowed).toBe(false);
    expect(json.reason).toBe("kill_switch_engaged");
  });

  it("denies via the real (fail-closed) repo even when DEX_STAGING_REPO_ENABLED=true, since SUPABASE_SERVICE_ROLE_KEY isn't configured in tests", async () => {
    process.env.DEX_STAGING_REPO_ENABLED = "true";
    const { POST } = await import("./route");
    const body = makeBody({}, freshRequestId());
    const sig = sign(body, process.env.DEX_BRIDGE_SECRET!);
    const req = new Request("http://localhost/api/dex/call-request", {
      method: "POST",
      body,
      headers: { "x-dex-signature": sig },
    });
    const res = await POST(req as never);
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.allowed).toBe(false);
    expect(json.reason).toBe("kill_switch_engaged");
  });

  it("never calls the mock provider when authorization denies the request", async () => {
    const { POST, __test__mockProvider } = await import("./route");
    const before = __test__mockProvider.getCalls().length;
    const body = makeBody({}, freshRequestId());
    const sig = sign(body, process.env.DEX_BRIDGE_SECRET!);
    const req = new Request("http://localhost/api/dex/call-request", {
      method: "POST",
      body,
      headers: { "x-dex-signature": sig },
    });
    await POST(req as never);
    expect(__test__mockProvider.getCalls().length).toBe(before);
  });
});
