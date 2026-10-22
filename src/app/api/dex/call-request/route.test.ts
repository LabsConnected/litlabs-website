import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

const ORIGINAL_SECRET = process.env.DEX_BRIDGE_SECRET;

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("POST /api/dex/call-request", () => {
  beforeEach(() => {
    process.env.DEX_BRIDGE_SECRET = "a".repeat(32);
  });

  afterEach(() => {
    process.env.DEX_BRIDGE_SECRET = ORIGINAL_SECRET;
  });

  it("rejects a request with a bad signature", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({ phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 0 });
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
    const body = JSON.stringify({ phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 0 });
    const req = new Request("http://localhost/api/dex/call-request", { method: "POST", body });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("rejects a correctly-signed request if DEX_BRIDGE_SECRET is misconfigured (too short)", async () => {
    process.env.DEX_BRIDGE_SECRET = "too-short";
    const { POST } = await import("./route");
    const body = JSON.stringify({ phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 0 });
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
    const body = JSON.stringify({ phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 0 });
    const sig = sign(body, "b".repeat(32)); // wrong secret
    const req = new Request("http://localhost/api/dex/call-request", {
      method: "POST",
      body,
      headers: { "x-dex-signature": sig },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("denies when the kill switch is engaged (default state, no repo override)", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({ phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 0 });
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
    const body = JSON.stringify({ phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 0 });
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
